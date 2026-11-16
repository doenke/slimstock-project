import { maxLevel, rightsOf, type PermissionLevel, type Rights } from '@spm/shared';
import { eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';
import { memberRoles, memberships, projectRoles, projects } from '../db/schema.js';
import type { SessionUser } from '../auth/sessions.js';
import { ApiError, forbidden, notFound } from './errors.js';

export interface ProjectNode {
  id: string;
  parentId: string | null;
}

/** The project and its ancestors, nearest first. */
export function chainOf(nodes: Map<string, ProjectNode>, projectId: string): string[] {
  const chain: string[] = [];
  let current = nodes.get(projectId);
  while (current && !chain.includes(current.id)) {
    chain.push(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return chain;
}

export async function loadTree(db: DbOrTx): Promise<Map<string, ProjectNode>> {
  const rows = await db.select({ id: projects.id, parentId: projects.parentId }).from(projects);
  return new Map(rows.map((r) => [r.id, r]));
}

/** A membership's level: its override, else the highest default of its roles, else reader. */
export function membershipLevel(override: PermissionLevel | null, roleDefaults: PermissionLevel[]): PermissionLevel {
  return override ?? maxLevel(roleDefaults) ?? 'reader';
}

/**
 * Effective permission levels of one user for every project: memberships count for the project and
 * all its subprojects. Admins are project leads everywhere.
 */
export async function levelsForUser(db: DbOrTx, user: SessionUser, tree?: Map<string, ProjectNode>): Promise<Map<string, PermissionLevel>> {
  const nodes = tree ?? (await loadTree(db));
  const result = new Map<string, PermissionLevel>();
  if (user.isAdmin && user.kind === 'staff') {
    for (const id of nodes.keys()) result.set(id, 'pl_slimstock');
    return result;
  }
  const own = await db
    .select({ id: memberships.id, projectId: memberships.projectId, override: memberships.permissionOverride })
    .from(memberships)
    .where(eq(memberships.userId, user.id));
  if (own.length === 0) return result;
  const roleRows = await db
    .select({ membershipId: memberRoles.membershipId, level: projectRoles.defaultPermission })
    .from(memberRoles)
    .innerJoin(projectRoles, eq(projectRoles.id, memberRoles.roleId))
    .where(
      inArray(
        memberRoles.membershipId,
        own.map((m) => m.id),
      ),
    );
  const direct = new Map<string, PermissionLevel>();
  for (const m of own) {
    const defaults = roleRows.filter((r) => r.membershipId === m.id).map((r) => r.level);
    direct.set(m.projectId, membershipLevel(m.override, defaults));
  }
  for (const id of nodes.keys()) {
    const level = maxLevel(chainOf(nodes, id).map((p) => direct.get(p)));
    if (level) result.set(id, level);
  }
  return result;
}

export async function levelFor(db: DbOrTx, user: SessionUser, projectId: string): Promise<PermissionLevel | null> {
  const tree = await loadTree(db);
  if (!tree.has(projectId)) throw notFound();
  return (await levelsForUser(db, user, tree)).get(projectId) ?? null;
}

/** Throws 404 when the user may not see the project (no hint that it exists), 403 when the right is missing. */
export async function requireRight(
  db: DbOrTx,
  user: SessionUser,
  projectId: string,
  right: keyof Rights,
): Promise<{ level: PermissionLevel; rights: Rights }> {
  const level = await levelFor(db, user, projectId);
  if (!level) throw notFound();
  const rights = rightsOf(level);
  if (!rights[right]) throw forbidden();
  return { level, rights };
}

export function requireStaff(user: SessionUser) {
  if (user.kind !== 'staff') throw forbidden();
}

export function requireAdmin(user: SessionUser) {
  if (user.kind !== 'staff' || !user.isAdmin) throw new ApiError(403, 'admin_only');
}
