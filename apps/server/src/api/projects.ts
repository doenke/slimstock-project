import {
  AddMemberInput,
  CreateProjectInput,
  UpdateMemberInput,
  UpdateProjectInput,
  levelsForSide,
  rank,
  type Member,
  type PermissionLevel,
  type ProjectDetail,
  type ProjectSummary,
  type Side,
} from '@spm/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db, DbOrTx } from '../db/index.js';
import { customers, memberRoles, memberships, projectRoles, projects, users } from '../db/schema.js';
import type { SessionUser } from '../auth/sessions.js';
import { chainOf, levelsForUser, loadTree, membershipLevel, requireAdmin, requireRight } from './access.js';
import { ApiError, forbidden, notFound, parse } from './errors.js';

type ProjectRow = typeof projects.$inferSelect & { customerName: string };

const sideOf = (kind: 'staff' | 'customer'): Side => (kind === 'staff' ? 'slimstock' : 'customer');

async function projectRows(db: DbOrTx, ids?: string[]): Promise<ProjectRow[]> {
  const rows = await db
    .select({ project: projects, customerName: customers.name })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .where(ids ? inArray(projects.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined)
    .orderBy(asc(projects.sort), asc(projects.name));
  return rows.map((r) => ({ ...r.project, customerName: r.customerName }));
}

function toSummary(p: ProjectRow, level: PermissionLevel | null, all: ProjectRow[]): ProjectSummary {
  return {
    id: p.id,
    parentId: p.parentId,
    customerId: p.customerId,
    customerName: p.customerName,
    name: p.name,
    code: p.code,
    status: p.status,
    language: p.language,
    startDate: p.startDate,
    endDate: p.endDate,
    permission: level,
    subprojectCount: all.filter((c) => c.parentId === p.id).length,
  };
}

/** Roles must exist, be active and belong to the person's side. */
async function checkRoles(db: DbOrTx, roleIds: string[], side: Side): Promise<void> {
  if (roleIds.length === 0) return;
  const rows = await db.select().from(projectRoles).where(inArray(projectRoles.id, roleIds));
  if (rows.length !== new Set(roleIds).size) throw new ApiError(400, 'unknown_role');
  if (rows.some((r) => r.side !== side)) throw new ApiError(400, 'role_not_for_side');
  if (rows.some((r) => !r.active)) throw new ApiError(400, 'role_inactive');
}

function checkOverride(level: PermissionLevel | null | undefined, side: Side, actor: PermissionLevel): void {
  if (!level) return;
  if (!levelsForSide(side).includes(level)) throw new ApiError(400, 'permission_not_for_side');
  // Customer project leads cannot hand out more than they have themselves.
  if (actor === 'pl_customer' && level === 'pl_customer') return;
  if (actor !== 'pl_slimstock' && level !== 'reader' && level !== 'team_customer') throw forbidden();
}

/** Customer project leads only manage customer people. */
function checkManages(actor: PermissionLevel, target: { kind: 'staff' | 'customer' }): void {
  if (actor !== 'pl_slimstock' && target.kind !== 'customer') throw forbidden();
}

async function setRoles(db: DbOrTx, membershipId: string, roleIds: string[]): Promise<void> {
  await db.delete(memberRoles).where(eq(memberRoles.membershipId, membershipId));
  const unique = [...new Set(roleIds)];
  if (unique.length) await db.insert(memberRoles).values(unique.map((roleId) => ({ membershipId, roleId })));
}

async function listMembers(db: DbOrTx, projectId: string): Promise<Member[]> {
  const tree = await loadTree(db);
  const chain = chainOf(tree, projectId);
  const rows = await db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.projectId, chain));
  const roleRows = rows.length
    ? await db
        .select({ membershipId: memberRoles.membershipId, roleId: memberRoles.roleId, level: projectRoles.defaultPermission })
        .from(memberRoles)
        .innerJoin(projectRoles, eq(projectRoles.id, memberRoles.roleId))
        .where(
          inArray(
            memberRoles.membershipId,
            rows.map((r) => r.membership.id),
          ),
        )
    : [];
  const names = new Map((await projectRows(db, chain)).map((p) => [p.id, p.name]));
  const byUser = new Map<string, Member>();
  for (const { membership, user } of rows) {
    const roles = roleRows.filter((r) => r.membershipId === membership.id);
    const own = membership.projectId === projectId;
    const m = byUser.get(user.id) ?? {
      userId: user.id,
      name: user.name,
      email: user.email,
      kind: user.kind,
      membershipId: null,
      roleIds: [],
      permissionOverride: null,
      inheritedRoleIds: [],
      inheritedFrom: [],
      effectivePermission: null,
    };
    if (own) {
      m.membershipId = membership.id;
      m.roleIds = roles.map((r) => r.roleId);
      m.permissionOverride = membership.permissionOverride;
    } else {
      m.inheritedRoleIds.push(...roles.map((r) => r.roleId).filter((id) => !m.inheritedRoleIds.includes(id)));
      m.inheritedFrom.push({ id: membership.projectId, name: names.get(membership.projectId) ?? '' });
    }
    const level = membershipLevel(
      membership.permissionOverride,
      roles.map((r) => r.level),
    );
    if (!m.effectivePermission || rank(level) > rank(m.effectivePermission)) m.effectivePermission = level;
    byUser.set(user.id, m);
  }
  return [...byUser.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'staff' ? -1 : 1));
}

export async function projectRoutes(app: FastifyInstance, { db, config }: { db: Db; config: Config }) {
  app.get('/api/projects', async (request) => {
    const levels = await levelsForUser(db, request.user);
    const all = await projectRows(db);
    return all.filter((p) => levels.has(p.id)).map((p) => toSummary(p, levels.get(p.id)!, all));
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request): Promise<ProjectDetail> => {
    const { level, rights } = await requireRight(db, request.user, request.params.id, 'view');
    const levels = await levelsForUser(db, request.user);
    const all = await projectRows(db);
    const p = all.find((x) => x.id === request.params.id)!;
    const tree = new Map(all.map((x) => [x.id, { id: x.id, parentId: x.parentId }]));
    const path = chainOf(tree, p.id)
      .slice(1)
      .reverse()
      .map((id) => ({ id, name: all.find((x) => x.id === id)!.name }));
    return {
      ...toSummary(p, level, all),
      description: p.description,
      path,
      subprojects: all.filter((c) => c.parentId === p.id).map((c) => toSummary(c, levels.get(c.id) ?? null, all)),
      rights,
    };
  });

  app.post('/api/projects', async (request, reply) => {
    const input = parse(CreateProjectInput, request.body);
    const user = request.user;
    let customerId: string;
    let language = input.language;
    if (input.parentId) {
      await requireRight(db, user, input.parentId, 'createSubproject');
      const [parent] = await db.select().from(projects).where(eq(projects.id, input.parentId));
      customerId = parent!.customerId;
      language ??= parent!.language;
    } else {
      requireAdmin(user);
      if (input.customerId) {
        const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId));
        if (!c) throw new ApiError(400, 'unknown_customer');
        customerId = c.id;
      } else if (input.customerName) {
        const [c] = await db.insert(customers).values({ name: input.customerName }).returning({ id: customers.id });
        customerId = c!.id;
      } else {
        throw new ApiError(400, 'customer_required');
      }
    }
    const id = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({
          customerId,
          parentId: input.parentId ?? null,
          name: input.name,
          code: input.code,
          description: input.description,
          language: language ?? config.DEFAULT_LANGUAGE,
          startDate: input.startDate,
          endDate: input.endDate,
          createdBy: user.id,
        })
        .returning({ id: projects.id });
      // Whoever creates a top-level project leads it (and shows up in the member list).
      if (!input.parentId && user.kind === 'staff') {
        const [lead] = await tx
          .select()
          .from(projectRoles)
          .where(and(eq(projectRoles.key, 'ss_pl'), eq(projectRoles.active, true)));
        const [m] = await tx
          .insert(memberships)
          .values({ projectId: created!.id, userId: user.id, invitedBy: user.id, permissionOverride: lead ? null : 'pl_slimstock' })
          .returning({ id: memberships.id });
        if (lead) await setRoles(tx, m!.id, [lead.id]);
      }
      return created!.id;
    });
    const all = await projectRows(db);
    const levels = await levelsForUser(db, user);
    return reply.code(201).send(
      toSummary(
        all.find((p) => p.id === id)!,
        levels.get(id) ?? null,
        all,
      ),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    await requireRight(db, request.user, request.params.id, 'editProject');
    const input = parse(UpdateProjectInput, request.body);
    await db.update(projects).set(input).where(eq(projects.id, request.params.id));
    const all = await projectRows(db);
    const levels = await levelsForUser(db, request.user);
    return toSummary(
      all.find((p) => p.id === request.params.id)!,
      levels.get(request.params.id) ?? null,
      all,
    );
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    // Deleting is for mistakes right after creating; finished projects are archived via status.
    requireAdmin(request.user);
    const [p] = await db.delete(projects).where(eq(projects.id, request.params.id)).returning({ id: projects.id });
    if (!p) throw notFound();
    return { ok: true };
  });

  // --- Members ---

  app.get<{ Params: { id: string } }>('/api/projects/:id/members', async (request) => {
    await requireRight(db, request.user, request.params.id, 'view');
    return listMembers(db, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/members', async (request, reply) => {
    const projectId = request.params.id;
    const { level: actor } = await requireRight(db, request.user, projectId, 'manageMembers');
    const input = parse(AddMemberInput, request.body);
    await db.transaction(async (tx) => {
      let target: SessionUser | undefined;
      if (input.userId) {
        [target] = await tx.select().from(users).where(eq(users.id, input.userId));
        if (!target || !target.active) throw new ApiError(400, 'unknown_user');
      } else {
        // A new customer person – or one we already know by e-mail (same person, several projects).
        if (input.email)
          [target] = await tx
            .select()
            .from(users)
            .where(and(eq(users.email, input.email), eq(users.kind, 'customer')));
        target ??= (await tx.insert(users).values({ kind: 'customer', name: input.name!, email: input.email }).returning())[0];
      }
      checkManages(actor, target!);
      const side = sideOf(target!.kind);
      await checkRoles(tx, input.roleIds, side);
      checkOverride(input.permissionOverride, side, actor);
      const [exists] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.projectId, projectId), eq(memberships.userId, target!.id)));
      if (exists) throw new ApiError(409, 'already_member');
      const [m] = await tx
        .insert(memberships)
        .values({ projectId, userId: target!.id, permissionOverride: input.permissionOverride, invitedBy: request.user.id })
        .returning({ id: memberships.id });
      await setRoles(tx, m!.id, input.roleIds);
    });
    return reply.code(201).send(await listMembers(db, projectId));
  });

  app.patch<{ Params: { id: string; membershipId: string } }>('/api/projects/:id/members/:membershipId', async (request) => {
    const projectId = request.params.id;
    const { level: actor } = await requireRight(db, request.user, projectId, 'manageMembers');
    const input = parse(UpdateMemberInput, request.body);
    const [row] = await db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, request.params.membershipId), eq(memberships.projectId, projectId)));
    if (!row) throw notFound();
    checkManages(actor, row.user);
    const side = sideOf(row.user.kind);
    await db.transaction(async (tx) => {
      if (input.roleIds) {
        await checkRoles(tx, input.roleIds, side);
        await setRoles(tx, row.membership.id, input.roleIds);
      }
      if (input.permissionOverride !== undefined) {
        checkOverride(input.permissionOverride, side, actor);
        await tx.update(memberships).set({ permissionOverride: input.permissionOverride }).where(eq(memberships.id, row.membership.id));
      }
    });
    return listMembers(db, projectId);
  });

  app.delete<{ Params: { id: string; membershipId: string } }>('/api/projects/:id/members/:membershipId', async (request) => {
    const projectId = request.params.id;
    const { level: actor } = await requireRight(db, request.user, projectId, 'manageMembers');
    const [row] = await db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.id, request.params.membershipId), eq(memberships.projectId, projectId)));
    if (!row) throw notFound();
    checkManages(actor, row.user);
    await db.delete(memberships).where(eq(memberships.id, row.membership.id));
    return listMembers(db, projectId);
  });
}
