import { rightsOf, type MemberLink } from '@spm/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LoginLimiter } from '../auth/limiter.js';
import { LinkBox } from '../auth/links.js';
import type { SessionStore } from '../auth/sessions.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { memberships, users } from '../db/schema.js';
import { audit } from '../audit.js';
import { chainOf, loadTree, requireRight } from './access.js';
import { ApiError, forbidden, notFound } from './errors.js';

/**
 * Customer access: a personal link per person and project. Opening it logs the person in (a normal
 * session cookie), so a bookmark or the installed app is enough – no password.
 */
export async function linkRoutes(app: FastifyInstance, { db, config, sessions }: { db: Db; config: Config; sessions: SessionStore }) {
  const box = new LinkBox(config.LINK_KEY ?? config.SESSION_KEY);
  const limiter = new LoginLimiter();
  const urlOf = (token: string) => `${config.PUBLIC_URL}/k/${token}`;

  /** The membership of a customer person in this project, if the caller may manage it. */
  async function managed(user: Parameters<typeof requireRight>[1], projectId: string, membershipId: string) {
    const { level } = await requireRight(db, user, projectId, 'manageMembers');
    const [row] = await db
      .select({ m: memberships, kind: users.kind, active: users.active })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, membershipId), eq(memberships.projectId, projectId)));
    if (!row) throw notFound();
    if (row.kind !== 'customer') throw new ApiError(400, 'link_only_for_customers');
    // Customer project leads manage their own people – customers anyway.
    if (!rightsOf(level).manageMembers) throw forbidden();
    return row.m;
  }

  async function issue(membershipId: string): Promise<MemberLink> {
    const token = LinkBox.newToken();
    const now = new Date();
    await db
      .update(memberships)
      .set({ linkTokenHash: LinkBox.hash(token), linkTokenEnc: box.encrypt(token), linkCreatedAt: now, linkLastUsedAt: null })
      .where(eq(memberships.id, membershipId));
    return { url: urlOf(token), createdAt: now.toISOString(), lastUsedAt: null };
  }

  app.get<{ Params: { id: string; mid: string } }>('/api/projects/:id/members/:mid/link', async (request): Promise<MemberLink> => {
    const m = await managed(request.user, request.params.id, request.params.mid);
    const token = m.linkTokenEnc ? box.decrypt(m.linkTokenEnc) : null;
    if (!token) return issue(m.id);
    return { url: urlOf(token), createdAt: m.linkCreatedAt?.toISOString() ?? null, lastUsedAt: m.linkLastUsedAt?.toISOString() ?? null };
  });

  /** A new link; the old one stops working at once and the person's sessions end. */
  app.post<{ Params: { id: string; mid: string } }>('/api/projects/:id/members/:mid/link/renew', async (request): Promise<MemberLink> => {
    const m = await managed(request.user, request.params.id, request.params.mid);
    const link = await issue(m.id);
    await sessions.destroyAll(m.userId);
    const ctx = await loadTree(db);
    const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, m.userId));
    await audit(db, {
      rootId: chainOf(ctx, m.projectId).at(-1)!,
      projectId: m.projectId,
      userId: request.user.id,
      action: 'link.renewed',
      details: { name: person?.name },
    });
    return link;
  });

  app.get<{ Params: { token: string }; Querystring: { next?: string } }>('/k/:token', async (request, reply) => {
    const wait = limiter.wait('link', request.ip);
    if (wait > 0)
      return reply
        .code(429)
        .header('Retry-After', Math.ceil(wait / 1000))
        .send('Too many attempts');
    const [row] = await db
      .select({ m: memberships, active: users.active })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.linkTokenHash, LinkBox.hash(request.params.token)));
    if (!row || !row.active) {
      limiter.fail('link', request.ip);
      return reply.redirect('/?link=invalid');
    }
    await sessions.create(reply, row.m.userId);
    const now = new Date();
    await db.update(memberships).set({ linkLastUsedAt: now }).where(eq(memberships.id, row.m.id));
    await db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.m.userId));
    // Links in mails point at a page (plan version, task); only project pages of this app are allowed.
    const next = request.query.next;
    const target = next && /^\/projects\/[0-9a-f-]{36}(\?[\w=&%.-]*)?$/.test(next) ? next : `/projects/${row.m.projectId}`;
    return reply.header('Cache-Control', 'no-store').redirect(target);
  });
}
