import type { PlanItem, PlanTree } from './plan.js';
import type { Side } from './permissions.js';

/**
 * Effort estimation in days per project role and task (no money). Planned effort sits on the tasks of a
 * version; actual effort is booked by hand per task key (independent of versions); remaining effort is an
 * estimate per task and role. Everything in minutes, 1 day = 480.
 */

export type RoleMinutes = Record<string, number>;

export interface EffortEntry {
  id: string;
  itemKey: string;
  userId: string;
  roleId: string;
  date: string;
  minutes: number;
  note: string | null;
}

export interface EffortRow {
  plan: RoleMinutes;
  actual: RoleMinutes;
  remaining: RoleMinutes;
  /** actual + remaining */
  forecast: RoleMinutes;
}

export const BILLINGS = ['tm', 'fixed'] as const;
export type Billing = (typeof BILLINGS)[number];

/** How a subproject (or the project-level part) is billed. Stored per version. */
export interface BillingTerms {
  billing: Billing;
  /** Fixed price: the agreed Slimstock effort per role; null = taken from the plan when the version is accepted. */
  budget?: RoleMinutes | null;
}

export function addRoles(into: RoleMinutes, from: RoleMinutes): RoleMinutes {
  for (const [r, m] of Object.entries(from)) into[r] = (into[r] ?? 0) + m;
  return into;
}

export const totalOf = (m: RoleMinutes, roleIds?: Set<string>) =>
  Object.entries(m).reduce((s, [r, v]) => s + (!roleIds || roleIds.has(r) ? v : 0), 0);

const emptyRow = (): EffortRow => ({ plan: {}, actual: {}, remaining: {}, forecast: {} });

/** Actual effort per task key and role. */
export function actualByKey(entries: EffortEntry[]): Map<string, RoleMinutes> {
  const out = new Map<string, RoleMinutes>();
  for (const e of entries) {
    const m = out.get(e.itemKey) ?? {};
    m[e.roleId] = (m[e.roleId] ?? 0) + e.minutes;
    out.set(e.itemKey, m);
  }
  return out;
}

/** Effort of one task: plan, actual, remaining (given, else plan − actual; done tasks 0), forecast. */
export function taskEffort(item: PlanItem, actual: RoleMinutes = {}): EffortRow {
  const row = emptyRow();
  row.plan = { ...item.efforts };
  row.actual = { ...actual };
  for (const r of new Set([...Object.keys(item.efforts), ...Object.keys(actual), ...Object.keys(item.remaining)])) {
    const rem = item.remaining[r] ?? (item.progress >= 100 ? 0 : Math.max(0, (item.efforts[r] ?? 0) - (actual[r] ?? 0)));
    if (rem) row.remaining[r] = rem;
    const f = (actual[r] ?? 0) + rem;
    if (f) row.forecast[r] = f;
  }
  return row;
}

export interface EffortResult {
  /** Per row id (task key, "sub:<id>"). */
  byRow: Map<string, EffortRow>;
  total: EffortRow;
  /** Bookings on tasks that are not in this version (counted in the total only). */
  orphanActual: RoleMinutes;
}

/** Effort per row: tasks, then phases and subprojects as sums of what is inside. */
export function computeEffort(tree: PlanTree, entries: EffortEntry[]): EffortResult {
  const actual = actualByKey(entries);
  const byRow = new Map<string, EffortRow>();
  for (const r of tree.rows) if (r.kind === 'item' && !r.summary) byRow.set(r.id, taskEffort(r.item, actual.get(r.id)));
  const children = new Map<string, string[]>();
  for (const r of tree.rows) if (r.parentRow) children.set(r.parentRow, [...(children.get(r.parentRow) ?? []), r.id]);
  const sum = (ids: string[]) => {
    const out = emptyRow();
    for (const id of ids) {
      const c = byRow.get(id);
      if (!c) continue;
      addRoles(out.plan, c.plan);
      addRoles(out.actual, c.actual);
      addRoles(out.remaining, c.remaining);
      addRoles(out.forecast, c.forecast);
    }
    return out;
  };
  for (const r of [...tree.rows].reverse()) if (r.summary) byRow.set(r.id, sum(children.get(r.id) ?? []));
  const total = sum(tree.rows.filter((r) => !r.parentRow).map((r) => r.id));
  const orphanActual: RoleMinutes = {};
  for (const [key, m] of actual) {
    if (tree.items.has(key)) continue;
    addRoles(orphanActual, m);
    addRoles(total.actual, m);
    addRoles(total.forecast, m);
  }
  return { byRow, total, orphanActual };
}

// ---------------------------------------------------------------------------------------------------------
// Budget per billing unit (each subproject, plus the project-level part)

export type BudgetLevel = 'ok' | 'warn' | 'crit';

export interface UnitBudget {
  /** Subproject id, or the root project id for the project-level part. */
  unitId: string;
  billing: Billing;
  /** Fixed price waiting for its budget (set on accepting the draft). */
  pending: boolean;
  /** Slimstock minutes: budget, plan of this version, actual, remaining, forecast. */
  budget: number;
  plan: number;
  actual: number;
  remaining: number;
  forecast: number;
  /** Forecast − budget (minutes) and in percent of the budget. */
  deviation: number;
  deviationPct: number | null;
  level: BudgetLevel;
}

/** The unit a task is billed in: its subproject, else the project-level part (the root id). */
export const unitOf = (tree: PlanTree, item: PlanItem) => tree.subOf(item) ?? tree.rootId;

/** Slimstock effort per unit and role (plan of the given items). */
export function planByUnit(tree: PlanTree, slimstockRoles: Set<string>): Map<string, RoleMinutes> {
  const out = new Map<string, RoleMinutes>();
  for (const item of tree.items.values()) {
    if (tree.isSummary(item.key)) continue;
    const u = unitOf(tree, item);
    const m = out.get(u) ?? {};
    for (const [r, v] of Object.entries(item.efforts)) if (slimstockRoles.has(r)) m[r] = (m[r] ?? 0) + v;
    out.set(u, m);
  }
  return out;
}

/**
 * Budget figures per unit (Slimstock days only). Time and material: the budget is the plan of the working
 * version; fixed price: the agreed budget.
 */
export function unitBudgets(opts: {
  tree: PlanTree;
  entries: EffortEntry[];
  terms: Record<string, BillingTerms>;
  slimstockRoles: Set<string>;
  /** Plan of the working version per unit (the budget under time and material). */
  workingPlan: Map<string, RoleMinutes>;
  warnPct: number;
  critPct: number;
}): UnitBudget[] {
  const { tree, entries, terms, slimstockRoles } = opts;
  const actual = actualByKey(entries);
  const units = [tree.rootId, ...tree.subs.keys()];
  const sums = new Map(units.map((u) => [u, { plan: 0, actual: 0, remaining: 0, forecast: 0 }]));
  for (const item of tree.items.values()) {
    if (tree.isSummary(item.key)) continue;
    const s = sums.get(unitOf(tree, item))!;
    const e = taskEffort(item, actual.get(item.key));
    s.plan += totalOf(e.plan, slimstockRoles);
    s.actual += totalOf(e.actual, slimstockRoles);
    s.remaining += totalOf(e.remaining, slimstockRoles);
    s.forecast += totalOf(e.forecast, slimstockRoles);
  }
  return units
    .map((unitId) => {
      const s = sums.get(unitId)!;
      const t = terms[unitId] ?? { billing: 'tm' };
      const pending = t.billing === 'fixed' && !t.budget;
      const budget =
        t.billing === 'fixed'
          ? t.budget
            ? totalOf(t.budget, slimstockRoles)
            : s.plan
          : totalOf(opts.workingPlan.get(unitId) ?? {}, slimstockRoles);
      const deviation = s.forecast - budget;
      const deviationPct = budget > 0 ? Math.round((deviation / budget) * 1000) / 10 : null;
      const level: BudgetLevel =
        deviation <= 0 ? 'ok' : deviationPct === null || deviationPct > opts.critPct ? 'crit' : deviationPct > opts.warnPct ? 'warn' : 'ok';
      return { unitId, billing: t.billing, pending, budget, ...s, deviation, deviationPct, level };
    })
    .filter((u) => u.unitId === tree.rootId || u.budget || u.plan || u.actual || terms[u.unitId]);
}

/** Splits role minutes into Slimstock and customer sums. */
export function bySide(m: RoleMinutes, sideOf: (roleId: string) => Side | undefined): Record<Side, number> {
  const out = { slimstock: 0, customer: 0 };
  for (const [r, v] of Object.entries(m)) {
    const s = sideOf(r);
    if (s) out[s] += v;
  }
  return out;
}
