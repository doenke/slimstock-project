import { randomUUID } from 'node:crypto';
import {
  CreatePlanItemInput,
  MovePlanRowInput,
  PlanSettingsInput,
  PlanTree,
  UpdatePlanItemInput,
  allowedDepTypes,
  computePlan,
  hasCycle,
  insertPosition,
  moveInTree,
  planSettingsOf,
  rightsOf,
  type PermissionLevel,
  type PlanItem,
  type PlanPayload,
  type PlanPm,
  type PlanSubproject,
} from '@spm/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SessionUser } from '../auth/sessions.js';
import type { Db, DbOrTx } from '../db/index.js';
import { memberships, planItems, planVersions, projects, users } from '../db/schema.js';
import { chainOf, levelsForUser, loadTree, type ProjectNode } from './access.js';
import { ApiError, forbidden, notFound, parse } from './errors.js';

type VersionRow = typeof planVersions.$inferSelect;
type ItemRow = typeof planItems.$inferSelect;

/** The top-level project of a project. */
function rootOf(tree: Map<string, ProjectNode>, projectId: string): string {
  const chain = chainOf(tree, projectId);
  return chain[chain.length - 1]!;
}

/** All subprojects below a root, any depth. */
function subprojectIds(tree: Map<string, ProjectNode>, rootId: string): string[] {
  return [...tree.keys()].filter((id) => id !== rootId && rootOf(tree, id) === rootId);
}

/** The working version of a plan, created on first use. */
export async function workingVersion(db: DbOrTx, rootId: string, userId: string | null): Promise<VersionRow> {
  const find = () =>
    db
      .select()
      .from(planVersions)
      .where(and(eq(planVersions.projectId, rootId), eq(planVersions.kind, 'working')));
  const [existing] = await find();
  if (existing) return existing;
  await db.insert(planVersions).values({ projectId: rootId, kind: 'working', createdBy: userId }).onConflictDoNothing();
  return (await find())[0]!;
}

const toItem = (r: ItemRow): PlanItem => ({
  key: r.key,
  parentKey: r.parentKey,
  subprojectId: r.subprojectId,
  title: r.title,
  sort: r.sort,
  pm: { ...r.pm, deps: r.pm.deps ?? {} },
  progress: r.progress,
  actualStart: r.actualStart,
  actualEnd: r.actualEnd,
  assignees: r.assignees,
  internal: r.internal,
  rev: r.rev,
});

interface Context {
  rootId: string;
  root: typeof projects.$inferSelect;
  tree: Map<string, ProjectNode>;
  levels: Map<string, PermissionLevel>;
  rootLevel: PermissionLevel | null;
}

async function context(db: DbOrTx, user: SessionUser, projectId: string): Promise<Context> {
  const tree = await loadTree(db);
  if (!tree.has(projectId)) throw notFound();
  const levels = await levelsForUser(db, user, tree);
  if (!levels.has(projectId)) throw notFound();
  const rootId = rootOf(tree, projectId);
  const [root] = await db.select().from(projects).where(eq(projects.id, rootId));
  return { rootId, root: root!, tree, levels, rootLevel: levels.get(rootId) ?? null };
}

async function loadSubprojects(db: DbOrTx, ctx: Context, version: VersionRow): Promise<PlanSubproject[]> {
  const ids = subprojectIds(ctx.tree, ctx.rootId);
  if (!ids.length) return [];
  const rows = await db.select().from(projects).where(inArray(projects.id, ids)).orderBy(asc(projects.sort), asc(projects.name));
  const layout = version.layout.subprojects ?? {};
  return rows.map((p, i) => ({ id: p.id, parentId: p.parentId, name: p.name, sort: layout[p.id] ?? 1_000_000 + i * 1024 }));
}

/** Loads a version, checks the user may see it and builds what the user gets to see. */
async function payload(db: DbOrTx, user: SessionUser, ctx: Context, version: VersionRow): Promise<PlanPayload> {
  const rootRights = rightsOf(ctx.rootLevel);
  const internalOk = [...ctx.levels.values()].some((l) => rightsOf(l).viewInternal);
  // Customers see a plan only once Slimstock shares it (stage 5 adds the switch).
  if (!internalOk && !version.customerVisible) throw new ApiError(403, 'plan_not_shared');
  const subprojects = await loadSubprojects(db, ctx, version);
  const items = (await db.select().from(planItems).where(eq(planItems.versionId, version.id))).map(toItem);
  const settings = planSettingsOf(ctx.root.settings);
  const computed = computePlan(items, subprojects, ctx.rootId, settings, ctx.root.startDate);

  // What this user may see: everything of the root, or only the subprojects they are on; internal rows only for Slimstock.
  const visibleSubs = rootRights.view ? subprojects : subprojects.filter((s) => ctx.levels.has(s.id));
  const subIds = new Set(visibleSubs.map((s) => s.id));
  const visible = items.filter((i) => {
    if (i.internal && !internalOk) return false;
    if (rootRights.view) return true;
    const sub = computed.tree.subOf(i);
    // Inside a visible subproject (or one of its children).
    let s = sub;
    while (s) {
      if (subIds.has(s)) return true;
      s = subprojects.find((x) => x.id === s)?.parentId ?? null;
    }
    return false;
  });
  const keys = new Set(visible.map((i) => i.key));
  for (const i of visible) {
    // Never reveal hidden rows through links or parents.
    i.pm = { ...i.pm, deps: Object.fromEntries(Object.entries(i.pm.deps).filter(([k]) => keys.has(k))) };
  }
  const rowIds = new Set([...keys, ...visibleSubs.map((s) => `sub:${s.id}`)]);
  const computedOut = Object.fromEntries([...computed.byRow].filter(([id]) => rowIds.has(id)));

  // People on the project (for the "who" column): members of the root and its subprojects.
  const tree = [ctx.rootId, ...subprojectIds(ctx.tree, ctx.rootId)];
  const people = await db
    .selectDistinct({ userId: users.id, name: users.name, kind: users.kind })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.projectId, tree));

  return {
    project: { id: ctx.rootId, name: ctx.root.name, startDate: ctx.root.startDate },
    version: { id: version.id, kind: version.kind, name: version.name, status: version.status },
    settings,
    subprojects: visibleSubs,
    items: visible,
    computed: computedOut,
    total: rootRights.view ? computed.total : null,
    projectStart: computed.projectStart,
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    rights: { edit: rootRights.editPlan && isEditable(version), editSettings: rootRights.editProject },
  };
}

const isEditable = (v: VersionRow) => v.kind === 'working' || (v.kind === 'draft' && v.status === 'editing');

/** For changes: the version, the root context, and the right to edit it. */
async function forEdit(db: DbOrTx, user: SessionUser, versionId: string) {
  const [version] = await db.select().from(planVersions).where(eq(planVersions.id, versionId));
  if (!version) throw notFound();
  const ctx = await context(db, user, version.projectId);
  if (!rightsOf(ctx.rootLevel).editPlan) throw forbidden();
  if (!isEditable(version)) throw new ApiError(409, 'version_locked');
  return { version, ctx };
}

async function allItems(db: DbOrTx, versionId: string): Promise<PlanItem[]> {
  return (await db.select().from(planItems).where(eq(planItems.versionId, versionId))).map(toItem);
}

/** Applies a pm patch (null removes a field). */
function patchPm(pm: PlanPm, patch: Record<string, unknown>): PlanPm {
  const out: Record<string, unknown> = { ...pm };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'milestone') {
      if (v) out.milestone = true;
      else delete out.milestone;
    } else if (v === null) delete out[k];
    else out[k] = v;
  }
  if (out.milestone) {
    delete out.dur;
    delete out.end;
  }
  return out as unknown as PlanPm;
}

export async function planRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/projects/:id/plan', async (request) => {
    const ctx = await context(db, request.user, request.params.id);
    let version: VersionRow | undefined;
    if (request.query.version) {
      [version] = await db
        .select()
        .from(planVersions)
        .where(and(eq(planVersions.id, request.query.version), eq(planVersions.projectId, ctx.rootId)));
      if (!version) throw notFound();
    } else {
      version = await workingVersion(db, ctx.rootId, request.user.id);
    }
    return payload(db, request.user, ctx, version);
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id/plan/settings', async (request) => {
    const ctx = await context(db, request.user, request.params.id);
    if (!rightsOf(ctx.rootLevel).editProject) throw forbidden();
    const input = parse(PlanSettingsInput, request.body);
    const next = { ...planSettingsOf(ctx.root.settings), ...input };
    await db
      .update(projects)
      .set({ settings: { ...ctx.root.settings, ...next } })
      .where(eq(projects.id, ctx.rootId));
    const fresh = await context(db, request.user, request.params.id);
    return payload(db, request.user, fresh, await workingVersion(db, ctx.rootId, request.user.id));
  });

  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/items', async (request, reply) => {
    const { version, ctx } = await forEdit(db, request.user, request.params.vid);
    const input = parse(CreatePlanItemInput, request.body);
    const items = await allItems(db, version.id);
    const tree = new PlanTree(items, await loadSubprojects(db, ctx, version), ctx.rootId);
    if (input.anchor?.kind === 'item' && !tree.items.has(input.anchor.key)) throw new ApiError(400, 'unknown_item');
    if (input.anchor?.kind === 'subproject' && !tree.subs.has(input.anchor.id)) throw new ApiError(400, 'unknown_subproject');
    const pos = insertPosition(tree, input.anchor);
    const key = randomUUID();
    await db.insert(planItems).values({
      versionId: version.id,
      key,
      ...pos,
      title: input.title,
      pm: input.milestone ? { milestone: true, deps: {} } : { deps: {} },
      updatedBy: request.user.id,
    });
    return reply.code(201).send({ key, plan: await payload(db, request.user, ctx, version) });
  });

  app.patch<{ Params: { vid: string; key: string } }>('/api/plan-versions/:vid/items/:key', async (request) => {
    const { version, ctx } = await forEdit(db, request.user, request.params.vid);
    const input = parse(UpdatePlanItemInput, request.body);
    await db.transaction(async (tx) => {
      // Lock the version's items so concurrent link changes cannot build a circle together.
      await tx.execute(sql`SELECT id FROM plan_items WHERE version_id = ${version.id} FOR UPDATE`);
      const items = await allItems(tx, version.id);
      const current = items.find((i) => i.key === request.params.key);
      if (!current) throw notFound();
      if (current.rev !== input.rev) throw new ApiError(409, 'conflict', 'Changed in the meantime', { current });
      const next: PlanItem = { ...current };
      if (input.title !== undefined) next.title = input.title;
      if (input.progress !== undefined) next.progress = input.progress;
      if (input.actualStart !== undefined) next.actualStart = input.actualStart;
      if (input.actualEnd !== undefined) next.actualEnd = input.actualEnd;
      if (input.internal !== undefined) next.internal = input.internal;
      if (input.assignees !== undefined) {
        const ids = [...new Set(input.assignees)];
        if (ids.length) {
          const tree = [ctx.rootId, ...subprojectIds(ctx.tree, ctx.rootId)];
          const known = await tx
            .selectDistinct({ userId: memberships.userId })
            .from(memberships)
            .where(and(inArray(memberships.projectId, tree), inArray(memberships.userId, ids)));
          if (known.length !== ids.length) throw new ApiError(400, 'assignee_not_member');
        }
        next.assignees = ids;
      }
      if (input.pm) {
        next.pm = patchPm(current.pm, input.pm);
        if (input.pm.deps) {
          const subs = await loadSubprojects(tx, ctx, version);
          const tree = new PlanTree(items, subs, ctx.rootId);
          for (const [pred, dep] of Object.entries(input.pm.deps)) {
            if (pred === current.key || !tree.items.has(pred)) throw new ApiError(400, 'unknown_item');
            if (!allowedDepTypes(tree, pred, current.key).includes(dep.type)) throw new ApiError(400, 'dependency_type');
          }
          if (
            hasCycle(
              items.map((i) => (i.key === current.key ? next : i)),
              subs,
              ctx.rootId,
            )
          )
            throw new ApiError(400, 'dependency_cycle');
        }
      }
      await tx
        .update(planItems)
        .set({
          title: next.title,
          pm: next.pm,
          progress: next.progress,
          actualStart: next.actualStart,
          actualEnd: next.actualEnd,
          assignees: next.assignees,
          internal: next.internal,
          rev: current.rev + 1,
          updatedAt: new Date(),
          updatedBy: request.user.id,
        })
        .where(and(eq(planItems.versionId, version.id), eq(planItems.key, current.key)));
    });
    return payload(db, request.user, ctx, version);
  });

  app.delete<{ Params: { vid: string; key: string } }>('/api/plan-versions/:vid/items/:key', async (request) => {
    const { version, ctx } = await forEdit(db, request.user, request.params.vid);
    await db.transaction(async (tx) => {
      const items = await allItems(tx, version.id);
      const tree = new PlanTree(items, await loadSubprojects(tx, ctx, version), ctx.rootId);
      if (!tree.items.has(request.params.key)) throw notFound();
      // The item with everything inside it; links to them go away.
      const gone = new Set([request.params.key, ...tree.descendants(request.params.key).map((d) => d.key)]);
      await tx.delete(planItems).where(and(eq(planItems.versionId, version.id), inArray(planItems.key, [...gone])));
      for (const i of items) {
        if (gone.has(i.key) || !Object.keys(i.pm.deps).some((k) => gone.has(k))) continue;
        const deps = Object.fromEntries(Object.entries(i.pm.deps).filter(([k]) => !gone.has(k)));
        await tx
          .update(planItems)
          .set({ pm: { ...i.pm, deps }, rev: i.rev + 1 })
          .where(and(eq(planItems.versionId, version.id), eq(planItems.key, i.key)));
      }
    });
    return payload(db, request.user, ctx, version);
  });

  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/move', async (request) => {
    const { version, ctx } = await forEdit(db, request.user, request.params.vid);
    const input = parse(MovePlanRowInput, request.body);
    await db.transaction(async (tx) => {
      const items = await allItems(tx, version.id);
      const tree = new PlanTree(items, await loadSubprojects(tx, ctx, version), ctx.rootId);
      const changes = moveInTree(tree, input.target, input.direction);
      if (!changes) return;
      for (const c of changes.items) {
        const before = tree.items.get(c.key)!;
        await tx
          .update(planItems)
          .set({ parentKey: c.parentKey, subprojectId: c.subprojectId, sort: c.sort, rev: before.rev + 1 })
          .where(and(eq(planItems.versionId, version.id), eq(planItems.key, c.key)));
      }
      if (changes.subprojects.length) {
        const layout = { ...(version.layout.subprojects ?? {}) };
        for (const s of tree.subs.values()) layout[s.id] ??= s.sort;
        for (const c of changes.subprojects) layout[c.id] = c.sort;
        await tx
          .update(planVersions)
          .set({ layout: { ...version.layout, subprojects: layout } })
          .where(eq(planVersions.id, version.id));
        version.layout = { ...version.layout, subprojects: layout };
      }
    });
    return payload(db, request.user, ctx, version);
  });
}
