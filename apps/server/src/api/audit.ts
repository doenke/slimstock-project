import { rightsOf, type AuditRow } from '@spm/shared';
import { and, desc, eq, inArray, lt, like, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { auditLog, users } from '../db/schema.js';
import { chainOf, levelsForUser, loadTree } from './access.js';
import { notFound } from './errors.js';

const AREAS: Record<string, string[]> = {
  project: ['project.', 'member.', 'link.'],
  plan: ['plan.', 'version.', 'effort.'],
  tasks: ['task.'],
};

/** Fields customers must not learn about, not even that they changed. */
const INTERNAL_FIELDS = new Set(['esynergyName']);

function publicDetails(details: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(details.fields)) return details;
  return { ...details, fields: (details.fields as string[]).filter((f) => !INTERNAL_FIELDS.has(f)) };
}

/** The change log of a project (and its subprojects), newest first, 100 at a time. */
export async function auditRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get<{ Params: { id: string }; Querystring: { before?: string; area?: string } }>('/api/projects/:id/audit', async (request) => {
    const tree = await loadTree(db);
    if (!tree.has(request.params.id)) throw notFound();
    const levels = await levelsForUser(db, request.user, tree);
    if (!levels.has(request.params.id)) throw notFound();
    const rootId = chainOf(tree, request.params.id).at(-1)!;
    const scope = [...tree.keys()].filter((id) => chainOf(tree, id).includes(request.params.id) && levels.has(id));
    const internalOk = [...levels.values()].some((l) => rightsOf(l).viewInternal);
    const prefixes = AREAS[request.query.area ?? ''];
    const rows = await db
      .select({ a: auditLog, userName: users.name, userKind: users.kind })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .where(
        and(
          eq(auditLog.rootId, rootId),
          inArray(auditLog.projectId, scope),
          internalOk ? undefined : eq(auditLog.internal, false),
          request.query.before ? lt(auditLog.at, new Date(request.query.before)) : undefined,
          prefixes ? or(...prefixes.map((p) => like(auditLog.action, `${p}%`))) : undefined,
        ),
      )
      .orderBy(desc(auditLog.at))
      .limit(100);
    return rows.map(({ a, userName, userKind }): AuditRow => ({
      id: a.id,
      at: a.at.toISOString(),
      action: a.action,
      userName,
      userKind,
      projectId: a.projectId,
      details: internalOk ? a.details : publicDetails(a.details),
    }));
  });
}
