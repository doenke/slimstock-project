import { randomUUID } from 'node:crypto';
import {
  CreatePlanItemInput,
  MovePlanRowInput,
  PlanSettingsInput,
  PlanTree,
  UpdatePlanItemInput,
  allowedDepTypes,
  computeEffort,
  computePlan,
  diffPlans,
  planByUnit,
  unitBudgets,
  type EffortEntry,
  type EffortRow,
  type EffortView,
  type UnitBudget,
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
  type PlanVersionInfo,
} from '@spm/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SessionUser } from '../auth/sessions.js';
import type { Db, DbOrTx } from '../db/index.js';
import {
  effortEntries,
  memberRoles,
  memberships,
  planComments,
  planItems,
  planVersions,
  projectRoles,
  projects,
  tasks,
  users,
  versionReviews,
} from '../db/schema.js';
import { chainOf, levelsForUser, loadTree, type ProjectNode } from './access.js';
import { audit, versionLabel } from '../audit.js';
import { ApiError, forbidden, notFound, parse } from './errors.js';

export type VersionRow = typeof planVersions.$inferSelect;
type ItemRow = typeof planItems.$inferSelect;

/** The top-level project of a project. */
function rootOf(tree: Map<string, ProjectNode>, projectId: string): string {
  const chain = chainOf(tree, projectId);
  return chain[chain.length - 1]!;
}

/** All subprojects below a root, any depth. */
export function subprojectIds(tree: Map<string, ProjectNode>, rootId: string): string[] {
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
  efforts: r.efforts ?? {},
  remaining: r.remaining ?? {},
  rev: r.rev,
});

export interface Context {
  rootId: string;
  root: typeof projects.$inferSelect;
  tree: Map<string, ProjectNode>;
  levels: Map<string, PermissionLevel>;
  rootLevel: PermissionLevel | null;
}

export async function context(db: DbOrTx, user: SessionUser, projectId: string): Promise<Context> {
  const tree = await loadTree(db);
  if (!tree.has(projectId)) throw notFound();
  const levels = await levelsForUser(db, user, tree);
  if (!levels.has(projectId)) throw notFound();
  const rootId = rootOf(tree, projectId);
  const [root] = await db.select().from(projects).where(eq(projects.id, rootId));
  return { rootId, root: root!, tree, levels, rootLevel: levels.get(rootId) ?? null };
}

export async function loadSubprojects(db: DbOrTx, ctx: Context, version: VersionRow): Promise<PlanSubproject[]> {
  const ids = subprojectIds(ctx.tree, ctx.rootId);
  if (!ids.length) return [];
  const rows = await db.select().from(projects).where(inArray(projects.id, ids)).orderBy(asc(projects.sort), asc(projects.name));
  const layout = version.layout.subprojects ?? {};
  return rows.map((p, i) => ({ id: p.id, parentId: p.parentId, name: p.name, sort: layout[p.id] ?? 1_000_000 + i * 1024 }));
}

/** A version's data and its computed plan (always on the full data; filtering comes after). */
export async function computeVersion(db: DbOrTx, ctx: Context, version: VersionRow) {
  const subprojects = await loadSubprojects(db, ctx, version);
  const items = await allItems(db, version.id);
  const settings = planSettingsOf(ctx.root.settings);
  const rolesOfUser = settings.durationFromEffort ? await memberRolesOf(db, ctx) : undefined;
  return { items, subprojects, settings, plan: computePlan(items, subprojects, ctx.rootId, settings, ctx.root.startDate, rolesOfUser) };
}

/** Project roles of every person on the project (any project of the tree). */
export async function memberRolesOf(db: DbOrTx, ctx: Context): Promise<Map<string, string[]>> {
  const tree = [ctx.rootId, ...subprojectIds(ctx.tree, ctx.rootId)];
  const rows = await db
    .select({ userId: memberships.userId, roleId: memberRoles.roleId })
    .from(memberRoles)
    .innerJoin(memberships, eq(memberships.id, memberRoles.membershipId))
    .where(inArray(memberships.projectId, tree));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.userId, [...new Set([...(out.get(r.userId) ?? []), r.roleId])]);
  return out;
}

/** Calculated roles in column order (Slimstock first), plus inactive ones that still carry effort. */
export async function effortRoles(db: DbOrTx): Promise<(typeof projectRoles.$inferSelect)[]> {
  const rows = await db.select().from(projectRoles).orderBy(asc(projectRoles.sort));
  return rows.filter((r) => r.calculated).sort((a, b) => (a.side === b.side ? a.sort - b.sort : a.side === 'slimstock' ? -1 : 1));
}

/** Bookings of a project with the person's name. */
export async function loadEntries(db: DbOrTx, rootId: string): Promise<(EffortEntry & { userName: string })[]> {
  const rows = await db
    .select({ e: effortEntries, userName: users.name })
    .from(effortEntries)
    .innerJoin(users, eq(users.id, effortEntries.userId))
    .where(eq(effortEntries.projectId, rootId))
    .orderBy(asc(effortEntries.date), asc(effortEntries.createdAt));
  return rows.map(({ e, userName }) => ({
    id: e.id,
    itemKey: e.itemKey,
    userId: e.userId,
    roleId: e.roleId,
    date: e.date,
    minutes: e.minutes,
    note: e.note,
    userName,
  }));
}

/** Whether the user sees internal content somewhere in this plan (Slimstock people). */
const seesInternal = (ctx: Context) => [...ctx.levels.values()].some((l) => rightsOf(l).viewInternal);

/** Customers only see versions Slimstock shared with them. */
export function canSeeVersion(ctx: Context, version: VersionRow): boolean {
  return seesInternal(ctx) || version.customerVisible;
}

export async function versionInfo(db: DbOrTx, version: VersionRow, end: string | null): Promise<PlanVersionInfo> {
  const ids = [version.createdBy, version.acceptedBy].filter((x): x is string => !!x);
  const names = ids.length
    ? new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]))
    : new Map();
  let basedOn: PlanVersionInfo['basedOn'] = null;
  if (version.basedOnVersionId) {
    const [b] = await db
      .select({ id: planVersions.id, no: planVersions.no })
      .from(planVersions)
      .where(eq(planVersions.id, version.basedOnVersionId));
    basedOn = b ?? null;
  }
  return {
    id: version.id,
    no: version.no,
    kind: version.kind,
    status: version.status,
    name: version.name,
    description: version.description,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy ? (names.get(version.createdBy) ?? null) : null,
    basedOn,
    acceptedAt: version.acceptedAt?.toISOString() ?? null,
    acceptedBy: version.acceptedBy ? (names.get(version.acceptedBy) ?? null) : null,
    replacedAt: version.replacedAt?.toISOString() ?? null,
    customerVisible: version.customerVisible,
    end,
    reviews: (
      await db
        .select({ r: versionReviews, userName: users.name })
        .from(versionReviews)
        .innerJoin(users, eq(users.id, versionReviews.userId))
        .where(eq(versionReviews.versionId, version.id))
        .orderBy(asc(versionReviews.createdAt))
    ).map(({ r, userName }) => ({
      userId: r.userId,
      userName,
      verdict: r.verdict,
      comment: r.comment,
      at: r.createdAt.toISOString(),
      stale: r.stale,
    })),
  };
}

/** Which item keys and subprojects of a computed plan this user may see. */
function visibility(ctx: Context, items: PlanItem[], subprojects: PlanSubproject[], tree: PlanTree) {
  const rootView = rightsOf(ctx.rootLevel).view;
  const internalOk = seesInternal(ctx);
  const visibleSubs = rootView ? subprojects : subprojects.filter((s) => ctx.levels.has(s.id));
  const subIds = new Set(visibleSubs.map((s) => s.id));
  const keys = new Set(
    items
      .filter((i) => {
        if (i.internal && !internalOk) return false;
        if (rootView) return true;
        // Inside a visible subproject (or one of its children).
        let s = tree.subOf(i);
        while (s) {
          if (subIds.has(s)) return true;
          s = subprojects.find((x) => x.id === s)?.parentId ?? null;
        }
        return false;
      })
      .map((i) => i.key),
  );
  const rowIds = new Set([...keys, ...visibleSubs.map((s) => `sub:${s.id}`)]);
  return { visibleSubs, keys, rowIds, rootView };
}

/** Loads a version, checks the user may see it and builds what the user gets to see. */
export async function payload(db: DbOrTx, user: SessionUser, ctx: Context, version: VersionRow, compareId?: string): Promise<PlanPayload> {
  const rootRights = rightsOf(ctx.rootLevel);
  if (!canSeeVersion(ctx, version)) throw new ApiError(403, 'plan_not_shared');
  const { items, subprojects, settings, plan: computed } = await computeVersion(db, ctx, version);
  const { visibleSubs, keys, rowIds, rootView } = visibility(ctx, items, subprojects, computed.tree);
  const visible = items
    .filter((i) => keys.has(i.key))
    // Never reveal hidden rows through links.
    .map((i) => ({ ...i, pm: { ...i.pm, deps: Object.fromEntries(Object.entries(i.pm.deps).filter(([k]) => keys.has(k))) } }));
  const computedOut = Object.fromEntries([...computed.byRow].filter(([id]) => rowIds.has(id)));

  // Effort: Slimstock sees everything; customers what the project setting allows, on the rows they see.
  const internalOk = seesInternal(ctx);
  const view: EffortView = internalOk ? 'full' : settings.effortView;
  const roles = await effortRoles(db);
  const shownRoles = roles.filter((r) => (view === 'customer' ? r.side === 'customer' : view !== 'none'));
  const shownRoleIds = new Set(shownRoles.map((r) => r.id));
  const pick = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([r]) => shownRoleIds.has(r)));
  const withActual = view === 'full';
  for (const i of visible) {
    i.efforts = pick(i.efforts);
    i.remaining = withActual ? pick(i.remaining) : {};
  }
  let effort: PlanPayload['effort'] = null;
  if (view !== 'none') {
    const visTree = internalOk && rootView ? computed.tree : new PlanTree(visible, visibleSubs, ctx.rootId);
    const allEntries = withActual ? await loadEntries(db, ctx.rootId) : [];
    const entries = allEntries.filter((e) => shownRoleIds.has(e.roleId) && (internalOk && rootView ? true : keys.has(e.itemKey)));
    const result = computeEffort(visTree, entries);
    const strip = (r: EffortRow): EffortRow =>
      withActual
        ? { plan: pick(r.plan), actual: pick(r.actual), remaining: pick(r.remaining), forecast: pick(r.forecast) }
        : { plan: pick(r.plan), actual: {}, remaining: {}, forecast: {} };
    const slimstockRoles = new Set(roles.filter((r) => r.side === 'slimstock').map((r) => r.id));
    let budgets: UnitBudget[] = [];
    if (withActual) {
      const working =
        version.kind === 'working'
          ? computed.tree
          : (await computeVersion(db, ctx, await workingVersion(db, ctx.rootId, user.id))).plan.tree;
      budgets = unitBudgets({
        tree: visTree,
        entries,
        terms: version.terms,
        slimstockRoles,
        workingPlan: planByUnit(working, slimstockRoles),
        warnPct: settings.warnPct,
        critPct: settings.critPct,
      }).filter((b) => (b.unitId === ctx.rootId ? rootView : visibleSubs.some((s) => s.id === b.unitId)));
    }
    const usedRoles = new Set([...Object.keys(result.total.plan), ...Object.keys(result.total.actual)]);
    effort = {
      roleIds: shownRoles.filter((r) => r.active || usedRoles.has(r.id)).map((r) => r.id),
      byRow: Object.fromEntries([...result.byRow].filter(([id]) => rowIds.has(id)).map(([id, r]) => [id, strip(r)])),
      total: strip(result.total),
      withActual,
      entries: internalOk ? entries : [],
      budgets,
      terms: Object.fromEntries(Object.entries(version.terms).map(([u, t]) => [u, { billing: t.billing, budget: t.budget ?? null }])),
    };
  }

  let compare: PlanPayload['compare'] = null;
  if (compareId && compareId !== version.id) {
    const [other] = await db
      .select()
      .from(planVersions)
      .where(and(eq(planVersions.id, compareId), eq(planVersions.projectId, ctx.rootId)));
    if (!other || !canSeeVersion(ctx, other)) throw notFound();
    const base = (await computeVersion(db, ctx, other)).plan;
    const baseVis = visibility(ctx, [...base.tree.items.values()], [...base.tree.subs.values()], base.tree);
    const diff = diffPlans(base, computed, settings.workDays);
    diff.rows = diff.rows.filter((r) => (r.kind === 'removed' ? baseVis.keys.has(r.key) : keys.has(r.key)));
    if (!rootView) diff.end = { from: null, to: null, shift: null };
    // Effort changes only as far as the user may see effort.
    diff.effort = view === 'none' || !rootView ? { from: {}, to: {} } : { from: pick(diff.effort.from), to: pick(diff.effort.to) };
    for (const r of diff.rows) {
      r.effortDelta = view === 'none' ? {} : pick(r.effortDelta);
      if (!Object.keys(r.effortDelta).length) r.fields = r.fields.filter((f) => f !== 'effort');
    }
    diff.rows = diff.rows.filter((r) => r.kind !== 'changed' || r.fields.length);
    compare = {
      version: await versionInfo(db, other, base.total?.end ?? null),
      computed: Object.fromEntries(
        [...base.byRow]
          .filter(([id]) => baseVis.rowIds.has(id))
          .map(([id, r]) => [id, { start: r.start, end: r.end, milestone: r.milestone }]),
      ),
      diff,
    };
  }

  // People on the project (for the "who" column): members of the root and its subprojects.
  const tree = [ctx.rootId, ...subprojectIds(ctx.tree, ctx.rootId)];
  const people = await db
    .selectDistinct({ userId: users.id, name: users.name, kind: users.kind })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.projectId, tree));

  return {
    project: { id: ctx.rootId, name: ctx.root.name, startDate: ctx.root.startDate },
    version: await versionInfo(db, version, rootView ? (computed.total?.end ?? null) : null),
    settings,
    subprojects: visibleSubs,
    items: visible,
    computed: computedOut,
    total: rootView ? computed.total : null,
    projectStart: computed.projectStart,
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    rights: {
      edit: rootRights.editPlan && isEditable(version),
      editSettings: rootRights.editProject,
      createDraft: rootRights.editPlan,
      manageVersions: rootRights.manageVersions,
      review: rootRights.reviewDrafts && version.kind === 'draft' && version.status === 'in_review' && version.customerVisible,
      comment: [...ctx.levels.values()].some((l) => rightsOf(l).comment) && version.kind !== 'history',
    },
    comments: (
      await db
        .select({ c: planComments, userName: users.name, kind: users.kind })
        .from(planComments)
        .innerJoin(users, eq(users.id, planComments.userId))
        .where(eq(planComments.versionId, version.id))
        .orderBy(asc(planComments.createdAt))
    )
      .filter(({ c }) => (internalOk || !c.internal) && (!c.itemKey || keys.has(c.itemKey)))
      .map(({ c, userName, kind }) => ({
        id: c.id,
        itemKey: c.itemKey,
        userId: c.userId,
        userName,
        kind,
        text: c.text,
        internal: c.internal,
        at: c.createdAt.toISOString(),
      })),
    linkedTasks: (
      await db
        .select({
          id: tasks.id,
          title: tasks.title,
          done: tasks.done,
          planItemKey: tasks.planItemKey,
          projectId: tasks.projectId,
          internal: tasks.internal,
        })
        .from(tasks)
        .where(and(eq(tasks.rootId, ctx.rootId), sql`${tasks.planItemKey} IS NOT NULL`))
    )
      .filter((t) => keys.has(t.planItemKey!) && ctx.levels.has(t.projectId) && (internalOk || !t.internal))
      .map(({ internal: _i, ...t }) => ({ ...t, planItemKey: t.planItemKey! })),
    effort,
    compare,
  };
}

export const isEditable = (v: VersionRow) => v.kind === 'working' || (v.kind === 'draft' && v.status === 'editing');

/** For changes: the version, the root context, and the right to edit it. */
async function forEdit(db: DbOrTx, user: SessionUser, versionId: string) {
  const [version] = await db.select().from(planVersions).where(eq(planVersions.id, versionId));
  if (!version) throw notFound();
  const ctx = await context(db, user, version.projectId);
  if (!rightsOf(ctx.rootLevel).editPlan) throw forbidden();
  if (!isEditable(version)) throw new ApiError(409, 'version_locked');
  return { version, ctx };
}

export async function allItems(db: DbOrTx, versionId: string): Promise<PlanItem[]> {
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

/** Changes answer with the plan as the client shows it (with its comparison, if any). */
const compareOf = (request: { query: unknown }) => (request.query as { compare?: string } | undefined)?.compare;

/** Plan changes are visible to the customer only in a shared version and on tasks that are not internal. */
const planEntry = (version: VersionRow, internalItem: boolean) => ({ internal: !version.customerVisible || internalItem });

/** Changed planning fields in the words of the change log. */
function changedFields(input: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(input)) {
    if (k === 'rev' || v === undefined) continue;
    if (k === 'pm')
      for (const f of Object.keys(v as object))
        out.add(f === 'deps' ? 'deps' : f === 'milestone' ? 'milestone' : f === 'deadline' ? 'deadline' : 'dates');
    else out.add(k);
  }
  return [...out];
}

export async function planRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get<{ Params: { id: string }; Querystring: { version?: string; compare?: string } }>('/api/projects/:id/plan', async (request) => {
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
      // Customers who may not see the working version get the most relevant version shared with them.
      if (!canSeeVersion(ctx, version)) {
        const shared = await db
          .select()
          .from(planVersions)
          .where(and(eq(planVersions.projectId, ctx.rootId), eq(planVersions.customerVisible, true)));
        const pick = shared.sort(
          (a, b) =>
            Number(b.status === 'in_review') - Number(a.status === 'in_review') ||
            Number(b.kind === 'working') - Number(a.kind === 'working') ||
            b.no - a.no,
        )[0];
        if (pick) version = pick;
      }
    }
    return payload(db, request.user, ctx, version, request.query.compare);
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
    await audit(db, { rootId: ctx.rootId, userId: request.user.id, action: 'plan.settings', details: { fields: Object.keys(input) } });
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
    await audit(db, {
      rootId: ctx.rootId,
      projectId: pos.subprojectId ?? ctx.rootId,
      userId: request.user.id,
      action: 'plan.itemCreated',
      details: { title: input.title, version: versionLabel(version) },
      ...planEntry(version, false),
    });
    return reply.code(201).send({ key, plan: await payload(db, request.user, ctx, version, compareOf(request)) });
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
      for (const field of ['efforts', 'remaining'] as const) {
        const patch = input[field];
        if (!patch) continue;
        const roleIds = Object.keys(patch);
        if (roleIds.length) {
          const known = await tx.select({ id: projectRoles.id }).from(projectRoles).where(inArray(projectRoles.id, roleIds));
          if (known.length !== roleIds.length) throw new ApiError(400, 'unknown_role');
        }
        const map = { ...next[field] };
        for (const [r, v] of Object.entries(patch)) {
          if (v === null || (field === 'efforts' && v === 0)) delete map[r];
          else map[r] = v;
        }
        next[field] = map;
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
          efforts: next.efforts,
          remaining: next.remaining,
          rev: current.rev + 1,
          updatedAt: new Date(),
          updatedBy: request.user.id,
        })
        .where(and(eq(planItems.versionId, version.id), eq(planItems.key, current.key)));
      await audit(tx, {
        rootId: ctx.rootId,
        projectId: current.subprojectId ?? ctx.rootId,
        userId: request.user.id,
        action: 'plan.itemUpdated',
        details: { title: next.title, version: versionLabel(version), fields: changedFields(input) },
        // Effort and remaining are internal details unless the customer sees the estimate anyway.
        ...planEntry(version, next.internal || current.internal),
      });
    });
    return payload(db, request.user, ctx, version, compareOf(request));
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
      const item = tree.items.get(request.params.key)!;
      await audit(tx, {
        rootId: ctx.rootId,
        projectId: tree.subOf(item) ?? ctx.rootId,
        userId: request.user.id,
        action: 'plan.itemDeleted',
        details: { title: item.title, version: versionLabel(version), inside: gone.size - 1 },
        ...planEntry(version, item.internal),
      });
    });
    return payload(db, request.user, ctx, version, compareOf(request));
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
      const moved = input.target.kind === 'item' ? tree.items.get(input.target.key) : undefined;
      await audit(tx, {
        rootId: ctx.rootId,
        userId: request.user.id,
        action: 'plan.moved',
        details: {
          title: moved?.title ?? (input.target.kind === 'subproject' ? tree.subs.get(input.target.id)?.name : ''),
          version: versionLabel(version),
        },
        ...planEntry(version, moved?.internal ?? false),
      });
    });
    return payload(db, request.user, ctx, version, compareOf(request));
  });
}
