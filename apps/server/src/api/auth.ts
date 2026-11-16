import { ChangePasswordInput, LoginInput, UpdateMeInput } from '@spm/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { LoginLimiter } from '../auth/limiter.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import type { SessionStore } from '../auth/sessions.js';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { toMe } from './dto.js';
import { ApiError, parse } from './errors.js';

export async function authRoutes(app: FastifyInstance, { db, sessions }: { db: Db; sessions: SessionStore }) {
  const limiter = new LoginLimiter();

  app.post('/api/auth/login', { config: { public: true } }, async (request, reply) => {
    const input = parse(LoginInput, request.body);
    const username = input.username.toLowerCase();
    const wait = limiter.wait(username, request.ip);
    if (wait > 0) throw new ApiError(429, 'too_many_attempts', 'Too many attempts', { retryAfter: Math.ceil(wait / 1000) });
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.username, username), eq(users.kind, 'staff')))
      .limit(1);
    const ok = await verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !ok || !user.active) {
      limiter.fail(username, request.ip);
      throw new ApiError(401, 'invalid_credentials');
    }
    limiter.succeed(username, request.ip);
    await sessions.create(reply, user.id);
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    return toMe(user);
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (request, reply) => {
    await sessions.destroy(request, reply);
    return { ok: true };
  });

  app.get('/api/me', async (request) => toMe(request.user));

  app.patch('/api/me', async (request) => {
    const input = parse(UpdateMeInput, request.body);
    const [user] = await db
      .update(users)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.language !== undefined && { language: input.language }),
      })
      .where(eq(users.id, request.user.id))
      .returning();
    return toMe(user!);
  });

  app.post('/api/me/password', async (request) => {
    const input = parse(ChangePasswordInput, request.body);
    const user = request.user;
    if (user.kind !== 'staff') throw new ApiError(403, 'forbidden');
    if (!(await verifyPassword(user.passwordHash, input.current))) throw new ApiError(400, 'wrong_password');
    if (input.current === input.password) throw new ApiError(400, 'password_unchanged');
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password), mustChangePassword: false })
      .where(eq(users.id, user.id));
    // Other devices have to log in again with the new password.
    await sessions.destroyAll(user.id, request);
    return { ok: true };
  });
}
