import {
  ACTUAL_FIELDS,
  AcceptInput,
  CommentInput,
  CreateDraftInput,
  ReviewInput,
  VisibilityInput,
  planByUnit,
  totalOf,
  type PlanTree,
  type RoleMinutes,
  computePlan,
  UpdateVersionInput,
  VersionStatusInput,
  diffPlans,
  rightsOf,
  type AcceptPreview,
  type PlanItem,
  type PlanVersionInfo,
} from '@spm/shared';
import { and, asc, eq, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SessionUser } from '../auth/sessions.js';
import type { Db, DbOrTx } from '../db/index.js';
import { planComments, planItems, planVersions, versionReviews } from '../db/schema.js';
import { audit, versionLabel } from '../audit.js';
import type { Notifier } from '../mail.js';
import { ApiError, forbidden, notFound, parse } from './errors.js';
import {
  allItems,
  canSeeVersion,
  computeVersion,
  context,
  effortRoles,
  payload,
  versionInfo,
  workingVersion,
  type Context,
  type VersionRow,
} from './plan.js';

async function versionFor(db: DbOrTx, user: SessionUser, versionId: string): Promise<{ version: VersionRow; ctx: Context }> {
  const [version] = await db.select().from(planVersions).where(eq(planVersions.id, versionId));
  if (!version) throw notFound();
  const ctx = await context(db, user, version.projectId);
  if (!canSeeVersion(ctx, version)) throw notFound();
  return { version, ctx };
}

/** Copies the items of one version into another (same keys, so links and comparisons keep working). */
async function copyItems(tx: DbOrTx, from: PlanItem[], toVersionId: string, userId: string): Promise<void> {
  if (!from.length) return;
  await tx.insert(planItems).values(
    from.map((i) => ({
      versionId: toVersionId,
      key: i.key,
      parentKey: i.parentKey,
      subprojectId: i.subprojectId,
      title: i.title,
      sort: i.sort,
      pm: i.pm,
      progress: i.progress,
      actualStart: i.actualStart,
      actualEnd: i.actualEnd,
      assignees: i.assignees,
      internal: i.internal,
      efforts: i.efforts,
      remaining: i.remaining,
      updatedBy: userId,
    })),
  );
}

/** Progress and actual dates the working version has for the draft's tasks. */
function carryOver(working: PlanItem[], draft: PlanItem[]) {
  const byKey = new Map(working.map((i) => [i.key, i]));
  const out: { item: PlanItem; fields: string[]; values: Partial<PlanItem> }[] = [];
  for (const d of draft) {
    const w = byKey.get(d.key);
    if (!w) continue;
    const fields = ACTUAL_FIELDS.filter((f) => JSON.stringify(w[f]) !== JSON.stringify(d[f]));
    if (fields.length) out.push({ item: d, fields, values: Object.fromEntries(fields.map((f) => [f, w[f]])) });
  }
  return out;
}

/** Fixed-price units of a version without a budget yet, or whose planned Slimstock effort differs from it. */
async function fixedPriceChanges(db: DbOrTx, version: VersionRow, tree: PlanTree) {
  const slimstock = new Set((await effortRoles(db)).filter((r) => r.side === 'slimstock').map((r) => r.id));
  const plans = planByUnit(tree, slimstock);
  const out: { unitId: string; budget: RoleMinutes | null; plan: RoleMinutes }[] = [];
  for (const [unitId, t] of Object.entries(version.terms)) {
    if (t.billing !== 'fixed') continue;
    const plan = plans.get(unitId) ?? {};
    if (!t.budget || totalOf(t.budget, slimstock) !== totalOf(plan, slimstock)) out.push({ unitId, budget: t.budget ?? null, plan });
  }
  return out;
}

export async function versionRoutes(app: FastifyInstance, { db, notifier }: { db: Db; notifier: Notifier }) {
  /** All versions of a project's plan the user may see: working version, drafts, history. */
  app.get<{ Params: { id: string } }>('/api/projects/:id/plan/versions', async (request): Promise<PlanVersionInfo[]> => {
    const ctx = await context(db, request.user, request.params.id);
    await workingVersion(db, ctx.rootId, request.user.id);
    const rows = await db.select().from(planVersions).where(eq(planVersions.projectId, ctx.rootId)).orderBy(asc(planVersions.no));
    const out: PlanVersionInfo[] = [];
    for (const v of rows.filter((r) => canSeeVersion(ctx, r))) {
      const end = rightsOf(ctx.rootLevel).view ? ((await computeVersion(db, ctx, v)).plan.total?.end ?? null) : null;
      out.push(await versionInfo(db, v, end));
    }
    const order = { working: 0, draft: 1, history: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind] || b.no - a.no);
  });

  /** A new draft: a copy of the working version (or of another version). */
  app.post<{ Params: { id: string } }>('/api/projects/:id/plan/versions', async (request, reply) => {
    const ctx = await context(db, request.user, request.params.id);
    if (!rightsOf(ctx.rootLevel).editPlan) throw forbidden();
    const input = parse(CreateDraftInput, request.body);
    const id = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM plan_versions WHERE project_id = ${ctx.rootId} FOR UPDATE`);
      let base: VersionRow;
      if (input.fromVersionId) {
        const [b] = await tx
          .select()
          .from(planVersions)
          .where(and(eq(planVersions.id, input.fromVersionId), eq(planVersions.projectId, ctx.rootId)));
        if (!b) throw new ApiError(400, 'unknown_version');
        base = b;
      } else {
        base = await workingVersion(tx, ctx.rootId, request.user.id);
      }
      const items = await allItems(tx, base.id);
      const [last] = await tx
        .select({ no: max(planVersions.no) })
        .from(planVersions)
        .where(eq(planVersions.projectId, ctx.rootId));
      const [draft] = await tx
        .insert(planVersions)
        .values({
          projectId: ctx.rootId,
          no: (last?.no ?? 0) + 1,
          kind: 'draft',
          status: 'editing',
          name: input.name,
          description: input.description,
          basedOnVersionId: base.id,
          baseSnapshot: items,
          layout: base.layout,
          terms: base.terms,
          createdBy: request.user.id,
        })
        .returning({ id: planVersions.id });
      await copyItems(tx, items, draft!.id, request.user.id);
      return draft!.id;
    });
    const [version] = await db.select().from(planVersions).where(eq(planVersions.id, id));
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: 'version.created',
      details: { version: versionLabel(version!) },
    });
    return reply.code(201).send(await versionInfo(db, version!, null));
  });

  app.patch<{ Params: { vid: string } }>('/api/plan-versions/:vid', async (request) => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    if (!rightsOf(ctx.rootLevel).editPlan) throw forbidden();
    if (version.kind !== 'draft') throw new ApiError(409, 'version_locked');
    const input = parse(UpdateVersionInput, request.body);
    const [next] = await db.update(planVersions).set(input).where(eq(planVersions.id, version.id)).returning();
    await audit(db, { rootId: ctx.rootId, userId: request.user.id, action: 'version.renamed', details: { version: versionLabel(next!) } });
    return versionInfo(db, next!, null);
  });

  /**
   * Draft status: hand it over for review (locked), take it back to editing, discard it (it stays in the
   * list) or bring a discarded one back.
   */
  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/status', async (request) => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    const { status } = parse(VersionStatusInput, request.body);
    const rights = rightsOf(ctx.rootLevel);
    if (version.kind !== 'draft') throw new ApiError(409, 'version_locked');
    const own = version.createdBy === request.user.id && rights.editPlan;
    const allowed =
      (status === 'in_review' && version.status === 'editing' && rights.manageVersions) ||
      (status === 'editing' && version.status === 'in_review' && rights.manageVersions) ||
      (status === 'editing' && version.status === 'discarded' && (rights.manageVersions || own)) ||
      (status === 'discarded' && (version.status === 'editing' || version.status === 'in_review') && (rights.manageVersions || own));
    if (!allowed) throw rights.editPlan ? new ApiError(409, 'status_not_allowed') : forbidden();
    // Handing over shows the draft to the customer; taking it back hides it and voids the reviews given so far.
    const visibility =
      status === 'in_review' ? { customerVisible: true } : version.status === 'in_review' ? { customerVisible: false } : {};
    const [next] = await db
      .update(planVersions)
      .set({ status, ...visibility })
      .where(eq(planVersions.id, version.id))
      .returning();
    if (version.status === 'in_review')
      await db.update(versionReviews).set({ stale: true }).where(eq(versionReviews.versionId, version.id));
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: `version.${status}`,
      details: { version: versionLabel(next!) },
      // The customer sees that a draft came for review or went back.
      internal: !(status === 'in_review' || version.status === 'in_review'),
    });
    if (status === 'in_review') notifier.reviewRequested(version.id, request.user.id);
    return versionInfo(db, next!, null);
  });

  /** Whether the customer sees this version (any kind: working version, draft, history). */
  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/visibility', async (request) => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    if (!rightsOf(ctx.rootLevel).manageVersions) throw forbidden();
    const { customerVisible } = parse(VisibilityInput, request.body);
    const [next] = await db.update(planVersions).set({ customerVisible }).where(eq(planVersions.id, version.id)).returning();
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: customerVisible ? 'version.shared' : 'version.unshared',
      details: { version: versionLabel(next!) },
      internal: !customerVisible,
    });
    return versionInfo(db, next!, null);
  });

  /** The customer's project lead approves or rejects a draft in review (a new verdict replaces the last one). */
  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/review', async (request) => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    if (!rightsOf(ctx.rootLevel).reviewDrafts) throw forbidden();
    if (version.kind !== 'draft' || version.status !== 'in_review' || !version.customerVisible)
      throw new ApiError(409, 'status_not_allowed');
    const input = parse(ReviewInput, request.body);
    if (input.verdict === 'reject' && !input.comment) throw new ApiError(400, 'reason_required');
    await db.transaction(async (tx) => {
      await tx
        .delete(versionReviews)
        .where(and(eq(versionReviews.versionId, version.id), eq(versionReviews.userId, request.user.id), eq(versionReviews.stale, false)));
      await tx
        .insert(versionReviews)
        .values({ versionId: version.id, userId: request.user.id, verdict: input.verdict, comment: input.comment });
    });
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: `version.${input.verdict}d`,
      details: { version: versionLabel(version) },
      internal: false,
    });
    notifier.reviewed(version.id, request.user.id, input.verdict, input.comment);
    return versionInfo(db, version, null);
  });

  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/comments', async (request, reply) => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    if (![...ctx.levels.values()].some((l) => rightsOf(l).comment) || version.kind === 'history') throw forbidden();
    const input = parse(CommentInput, request.body);
    const internal = input.internal && request.user.kind === 'staff';
    if (input.itemKey) {
      const [item] = await db
        .select({ internal: planItems.internal })
        .from(planItems)
        .where(and(eq(planItems.versionId, version.id), eq(planItems.key, input.itemKey)));
      if (!item || (item.internal && request.user.kind !== 'staff')) throw new ApiError(400, 'unknown_item');
    }
    const [row] = await db
      .insert(planComments)
      .values({ versionId: version.id, itemKey: input.itemKey, userId: request.user.id, text: input.text, internal })
      .returning({ id: planComments.id });
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: 'version.commented',
      details: { version: versionLabel(version) },
      internal: internal || !version.customerVisible,
    });
    return reply.code(201).send(row);
  });

  /** Own comments can be deleted; the Slimstock project lead may delete any. */
  app.delete<{ Params: { cid: string } }>('/api/plan-comments/:cid', async (request) => {
    const [comment] = await db.select().from(planComments).where(eq(planComments.id, request.params.cid));
    if (!comment) throw notFound();
    const { ctx } = await versionFor(db, request.user, comment.versionId);
    if (comment.userId !== request.user.id && !rightsOf(ctx.rootLevel).manageVersions) throw forbidden();
    await db.delete(planComments).where(eq(planComments.id, comment.id));
    return { ok: true };
  });

  /** What accepting would do: actual data taken over, changes in the working version that get lost. */
  app.get<{ Params: { vid: string } }>('/api/plan-versions/:vid/accept-preview', async (request): Promise<AcceptPreview> => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    if (!rightsOf(ctx.rootLevel).manageVersions) throw forbidden();
    if (version.kind !== 'draft' || version.status === 'discarded') throw new ApiError(409, 'status_not_allowed');
    const working = await workingVersion(db, ctx.rootId, request.user.id);
    const w = await computeVersion(db, ctx, working);
    const d = await computeVersion(db, ctx, version);
    const lost: AcceptPreview['lost'] = [];
    if (version.basedOnVersionId === working.id && version.baseSnapshot) {
      // Planning changes made in the working version after the draft was copied from it.
      const base = computePlan(version.baseSnapshot, w.subprojects, ctx.rootId, w.settings, ctx.root.startDate);
      lost.push(...diffPlans(base, w.plan, w.settings.workDays).rows);
    }
    return {
      carried: carryOver(w.items, d.items).map((c) => ({ key: c.item.key, title: c.item.title, fields: c.fields })),
      lost,
      diff: diffPlans(w.plan, d.plan, w.settings.workDays),
      fixedPrice: (await fixedPriceChanges(db, version, d.plan.tree)).map(({ unitId, budget, plan }) => ({
        unitId,
        budget: budget && totalOf(budget),
        plan: totalOf(plan),
      })),
    };
  });

  /** The draft becomes the working version; the old one goes to the history. */
  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/accept', async (request) => {
    const { version, ctx } = await versionFor(db, request.user, request.params.vid);
    if (!rightsOf(ctx.rootLevel).manageVersions) throw forbidden();
    const { changeRequests } = parse(AcceptInput, request.body ?? {});
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM plan_versions WHERE project_id = ${ctx.rootId} FOR UPDATE`);
      const [draft] = await tx.select().from(planVersions).where(eq(planVersions.id, version.id));
      if (!draft || draft.kind !== 'draft' || draft.status === 'discarded') throw new ApiError(409, 'status_not_allowed');
      const working = await workingVersion(tx, ctx.rootId, request.user.id);
      // What happened in reality goes along: progress and actual dates.
      for (const c of carryOver(await allItems(tx, working.id), await allItems(tx, draft.id))) {
        await tx
          .update(planItems)
          .set({ ...c.values, rev: c.item.rev + 1 })
          .where(and(eq(planItems.versionId, draft.id), eq(planItems.key, c.item.key)));
      }
      // Fixed price: a new fixed price gets its budget now; a changed effort raises it only as a change request.
      const terms = { ...draft.terms };
      let isChangeRequest = false;
      const draftTree = (await computeVersion(tx, ctx, draft)).plan.tree;
      for (const c of await fixedPriceChanges(tx, draft, draftTree)) {
        if (!c.budget || changeRequests[c.unitId]) {
          terms[c.unitId] = { billing: 'fixed', budget: c.plan };
          if (c.budget) isChangeRequest = true;
        }
      }
      const now = new Date();
      await tx.update(planVersions).set({ kind: 'history', replacedAt: now }).where(eq(planVersions.id, working.id));
      await tx
        .update(planVersions)
        .set({ kind: 'working', status: 'accepted', acceptedAt: now, acceptedBy: request.user.id, terms, isChangeRequest })
        .where(eq(planVersions.id, draft.id));
    });
    const [accepted] = await db.select().from(planVersions).where(eq(planVersions.id, version.id));
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: 'version.accepted',
      details: { version: versionLabel(accepted!), changeRequest: accepted!.isChangeRequest },
      internal: !accepted!.customerVisible,
    });
    return payload(db, request.user, ctx, accepted!);
  });
}
