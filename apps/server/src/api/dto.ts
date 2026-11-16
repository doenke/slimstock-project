import type { Me, Role, UserRow } from '@spm/shared';
import type { projectRoles, users } from '../db/schema.js';

export function toMe(u: typeof users.$inferSelect): Me {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    kind: u.kind,
    isAdmin: u.isAdmin,
    language: u.language ?? null,
    mustChangePassword: u.mustChangePassword,
    notify: u.notify,
  };
}

export function toUserRow(u: typeof users.$inferSelect): UserRow {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    kind: u.kind,
    isAdmin: u.isAdmin,
    active: u.active,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
  };
}

export function toRole(r: typeof projectRoles.$inferSelect): Role {
  return {
    id: r.id,
    side: r.side,
    names: r.names,
    calculated: r.calculated,
    defaultPermission: r.defaultPermission,
    active: r.active,
    sort: r.sort,
  };
}
