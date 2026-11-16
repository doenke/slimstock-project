import { BillingInput, EffortEntryInput, UpdateEffortEntryInput, planByUnit, rightsOf } from '@spm/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SessionUser } from '../auth/sessions.js';
import type { Db, DbOrTx } from '../db/index.js';
import { effortEntries, memberships, planItems, planVersions, projectRoles } from '../db/schema.js';
import { audit, versionLabel } from '../audit.js';
import { ApiError, forbidden, notFound, parse } from './errors.js';
import { computeVersion, context, effortRoles, isEditable, payload, subprojectIds, type Context } from './plan.js';

/** Bookings are actual work: the Slimstock team of the project records them. */
async function forBooking(db: DbOrTx, user: SessionUser, projectId: string): Promise<Context> {
  const ctx = await context(db, user, projectId);
  if (!rightsOf(ctx.rootLevel).editPlan) throw forbidden();
  return ctx;
}

async function checkEntry(db: DbOrTx, ctx: Context, e: { itemKey?: string; userId?: string; roleId?: string }) {
  if (e.itemKey) {
    // The task exists in some version of this plan (bookings hold across versions).
    const [found] = await db
      .select({ id: planItems.id })
      .from(planItems)
      .innerJoin(planVersions, eq(planVersions.id, planItems.versionId))
      .where(and(eq(planVersions.projectId, ctx.rootId), eq(planItems.key, e.itemKey)))
      .limit(1);
    if (!found) throw new ApiError(400, 'unknown_item');
  }
  if (e.userId) {
    const tree = [ctx.rootId, ...subprojectIds(ctx.tree, ctx.rootId)];
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, e.userId), inArray(memberships.projectId, tree)))
      .limit(1);
    if (!m) throw new ApiError(400, 'assignee_not_member');
  }
  if (e.roleId) {
    const [r] = await db.select().from(projectRoles).where(eq(projectRoles.id, e.roleId));
    if (!r || !r.calculated) throw new ApiError(400, 'unknown_role');
  }
}

export async function effortRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.post<{ Params: { id: string } }>('/api/projects/:id/effort-entries', async (request, reply) => {
    const ctx = await forBooking(db, request.user, request.params.id);
    const input = parse(EffortEntryInput, request.body);
    await checkEntry(db, ctx, input);
    const [row] = await db
      .insert(effortEntries)
      .values({ ...input, projectId: ctx.rootId, createdBy: request.user.id })
      .returning({ id: effortEntries.id });
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: 'effort.booked',
      details: { minutes: input.minutes, date: input.date },
    });
    return reply.code(201).send(row);
  });

  app.patch<{ Params: { eid: string } }>('/api/effort-entries/:eid', async (request) => {
    const [entry] = await db.select().from(effortEntries).where(eq(effortEntries.id, request.params.eid));
    if (!entry) throw notFound();
    const ctx = await forBooking(db, request.user, entry.projectId);
    const input = parse(UpdateEffortEntryInput, request.body);
    await checkEntry(db, ctx, input);
    await db.update(effortEntries).set(input).where(eq(effortEntries.id, entry.id));
    await audit(db, { rootId: ctx.rootId, userId: request.user.id, action: 'effort.changed', details: { date: input.date ?? entry.date } });
    return { ok: true };
  });

  app.delete<{ Params: { eid: string } }>('/api/effort-entries/:eid', async (request) => {
    const [entry] = await db.select().from(effortEntries).where(eq(effortEntries.id, request.params.eid));
    if (!entry) throw notFound();
    const ctx = await forBooking(db, request.user, entry.projectId);
    await db.delete(effortEntries).where(eq(effortEntries.id, entry.id));
    await audit(db, {
      rootId: ctx.rootId,
      userId: request.user.id,
      action: 'effort.deleted',
      details: { minutes: entry.minutes, date: entry.date },
    });
    return { ok: true };
  });

  /**
   * Billing of a unit (subproject or project-level part). Fixed price in the working version takes the
   * current plan as budget at once; in a draft the budget is set when the draft is accepted.
   */
  app.post<{ Params: { vid: string } }>('/api/plan-versions/:vid/billing', async (request) => {
    const [version] = await db.select().from(planVersions).where(eq(planVersions.id, request.params.vid));
    if (!version) throw notFound();
    const ctx = await context(db, request.user, version.projectId);
    if (!rightsOf(ctx.rootLevel).manageVersions) throw forbidden();
    if (!isEditable(version)) throw new ApiError(409, 'version_locked');
    const { unitId, billing } = parse(BillingInput, request.body);
    if (unitId !== ctx.rootId && !subprojectIds(ctx.tree, ctx.rootId).includes(unitId)) throw new ApiError(400, 'unknown_subproject');
    const terms = { ...version.terms };
    const current = terms[unitId];
    if (billing === 'tm') terms[unitId] = { billing: 'tm' };
    else if (current?.billing !== 'fixed') {
      let budget = null;
      if (version.kind === 'working') {
        const slimstock = new Set((await effortRoles(db)).filter((r) => r.side === 'slimstock').map((r) => r.id));
        budget = planByUnit((await computeVersion(db, ctx, version)).plan.tree, slimstock).get(unitId) ?? {};
      }
      terms[unitId] = { billing: 'fixed', budget };
    }
    await db.update(planVersions).set({ terms }).where(eq(planVersions.id, version.id));
    await audit(db, {
      rootId: ctx.rootId,
      projectId: unitId,
      userId: request.user.id,
      action: 'effort.billing',
      details: { billing, version: versionLabel(version) },
    });
    version.terms = terms;
    return payload(db, request.user, ctx, version, (request.query as { compare?: string }).compare);
  });
}
