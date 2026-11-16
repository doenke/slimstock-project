import {
  CreateUserInput,
  CustomerInput,
  ReorderRolesInput,
  ResetPasswordInput,
  RoleInput,
  UpdateRoleInput,
  UpdateUserInput,
  levelsForSide,
} from '@spm/shared';
import { asc, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../auth/password.js';
import type { Notifier } from '../mail.js';
import type { SessionStore } from '../auth/sessions.js';
import type { Db } from '../db/index.js';
import { customers, projectRoles, users } from '../db/schema.js';
import { requireAdmin, requireStaff } from './access.js';
import { toRole, toUserRow } from './dto.js';
import { ApiError, notFound, parse } from './errors.js';

export async function adminRoutes(
  app: FastifyInstance,
  { db, sessions, notifier }: { db: Db; sessions: SessionStore; notifier: Notifier },
) {
  /** Sends a test mail to the admin's own address. */
  app.post('/api/admin/test-mail', async (request) => {
    requireAdmin(request.user);
    if (!notifier.enabled) throw new ApiError(400, 'mail_not_configured');
    if (!request.user.email) throw new ApiError(400, 'no_email');
    try {
      await notifier.test(request.user.email, request.user.language ?? 'de');
    } catch (e) {
      throw new ApiError(502, 'mail_failed', (e as Error).message);
    }
    return { ok: true, to: request.user.email };
  });

  // --- Users (Slimstock staff) ---

  app.get('/api/admin/users', async (request) => {
    requireAdmin(request.user);
    const rows = await db.select().from(users).where(eq(users.kind, 'staff')).orderBy(asc(users.name));
    return rows.map(toUserRow);
  });

  /** Staff for the member picker (all Slimstock people may see their colleagues). */
  app.get('/api/staff', async (request) => {
    requireStaff(request.user);
    const rows = await db.select().from(users).where(eq(users.kind, 'staff')).orderBy(asc(users.name));
    return rows.filter((u) => u.active).map(toUserRow);
  });

  app.post('/api/admin/users', async (request, reply) => {
    requireAdmin(request.user);
    const input = parse(CreateUserInput, request.body);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username));
    if (existing) throw new ApiError(409, 'username_taken');
    const [user] = await db
      .insert(users)
      .values({
        kind: 'staff',
        username: input.username,
        name: input.name,
        email: input.email,
        isAdmin: input.isAdmin,
        passwordHash: await hashPassword(input.password),
        mustChangePassword: true,
      })
      .returning();
    return reply.code(201).send(toUserRow(user!));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (request) => {
    requireAdmin(request.user);
    const input = parse(UpdateUserInput, request.body);
    if (request.params.id === request.user.id && (input.isAdmin === false || input.active === false)) {
      throw new ApiError(400, 'cannot_demote_self');
    }
    const [user] = await db.update(users).set(input).where(eq(users.id, request.params.id)).returning();
    if (!user || user.kind !== 'staff') throw notFound();
    if (input.active === false) await sessions.destroyAll(user.id);
    return toUserRow(user);
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/password', async (request) => {
    requireAdmin(request.user);
    const input = parse(ResetPasswordInput, request.body);
    const [user] = await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password), mustChangePassword: true })
      .where(eq(users.id, request.params.id))
      .returning();
    if (!user || user.kind !== 'staff') throw notFound();
    await sessions.destroyAll(user.id);
    return { ok: true };
  });

  // --- Project roles ---

  app.get('/api/roles', async () => {
    const rows = await db.select().from(projectRoles).orderBy(asc(projectRoles.sort));
    return rows.map(toRole);
  });

  app.post('/api/admin/roles', async (request, reply) => {
    requireAdmin(request.user);
    const input = parse(RoleInput, request.body);
    if (!levelsForSide(input.side).includes(input.defaultPermission)) throw new ApiError(400, 'permission_not_for_side');
    const [last] = await db.select({ sort: max(projectRoles.sort) }).from(projectRoles);
    const [role] = await db
      .insert(projectRoles)
      .values({ ...input, sort: (last?.sort ?? -1) + 1 })
      .returning();
    return reply.code(201).send(toRole(role!));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/roles/:id', async (request) => {
    requireAdmin(request.user);
    const input = parse(UpdateRoleInput, request.body);
    const [current] = await db.select().from(projectRoles).where(eq(projectRoles.id, request.params.id));
    if (!current) throw notFound();
    if (input.defaultPermission && !levelsForSide(current.side).includes(input.defaultPermission)) {
      throw new ApiError(400, 'permission_not_for_side');
    }
    const [role] = await db.update(projectRoles).set(input).where(eq(projectRoles.id, current.id)).returning();
    return toRole(role!);
  });

  app.post('/api/admin/roles/order', async (request) => {
    requireAdmin(request.user);
    const { ids } = parse(ReorderRolesInput, request.body);
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(projectRoles).set({ sort: i }).where(eq(projectRoles.id, id));
    });
    const rows = await db.select().from(projectRoles).orderBy(asc(projectRoles.sort));
    return rows.map(toRole);
  });

  // --- Customers ---

  app.get('/api/customers', async (request) => {
    requireStaff(request.user);
    return db.select({ id: customers.id, name: customers.name }).from(customers).orderBy(asc(customers.name));
  });

  app.post('/api/admin/customers', async (request, reply) => {
    requireAdmin(request.user);
    const input = parse(CustomerInput, request.body);
    const [row] = await db.insert(customers).values(input).returning({ id: customers.id, name: customers.name });
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { id: string } }>('/api/admin/customers/:id', async (request) => {
    requireAdmin(request.user);
    const input = parse(CustomerInput, request.body);
    const [row] = await db
      .update(customers)
      .set(input)
      .where(eq(customers.id, request.params.id))
      .returning({ id: customers.id, name: customers.name });
    if (!row) throw notFound();
    return row;
  });
}
