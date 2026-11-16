import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';

export const SESSION_COOKIE = 'spm_sid';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export type SessionUser = typeof users.$inferSelect;

export class SessionStore {
  constructor(
    private db: Db,
    private secure: boolean,
  ) {}

  async create(reply: FastifyReply, userId: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) });
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      signed: true,
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
  }

  /** The logged-in, active user, or null. Extends the session when it is used (sliding expiry). */
  async resolve(request: FastifyRequest): Promise<SessionUser | null> {
    const token = this.token(request);
    if (!token) return null;
    const now = new Date();
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
      .limit(1);
    if (!row || !row.user.active) return null;
    if (row.session.expiresAt.getTime() - now.getTime() < (SESSION_DAYS - 1) * DAY) {
      await this.db
        .update(sessions)
        .set({ expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY) })
        .where(eq(sessions.id, row.session.id));
    }
    if (!row.user.lastSeenAt || now.getTime() - row.user.lastSeenAt.getTime() > 5 * 60_000) {
      await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id));
    }
    return row.user;
  }

  async destroy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = this.token(request);
    if (token) await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Ends every session of a user, optionally except the current one. */
  async destroyAll(userId: string, keep?: FastifyRequest): Promise<void> {
    const token = keep && this.token(keep);
    const all = await this.db.select({ id: sessions.id, tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
    for (const s of all) {
      if (token && s.tokenHash === sha256(token)) continue;
      await this.db.delete(sessions).where(eq(sessions.id, s.id));
    }
  }

  async prune(): Promise<void> {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }

  private token(request: FastifyRequest): string | null {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const unsigned = request.unsignCookie(raw);
    return unsigned.valid ? unsigned.value : null;
  }
}
