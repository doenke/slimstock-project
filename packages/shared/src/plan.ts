import {
  calendarOf,
  daysToMinutes,
  isDate,
  schedule,
  today,
  type DepType,
  type PmConflict,
  type PmDep,
  type PmValue,
  type ScheduledTask,
  type ScheduleTask,
} from './schedule.js';

/**
 * The project plan: one plan per (top-level) project, covering all subprojects. Items form a tree:
 * - project-level items and the subprojects sit at the top (subprojects are summary rows of their own),
 * - inside a subproject its items and its child subprojects,
 * - an item with children is a phase (summary task): its dates come from its children.
 * Dependencies reference items by their `key`, which stays the same in every version of the plan.
 */

export interface PlanPm {
  start?: PmValue<string>;
  end?: PmValue<string>;
  dur?: PmValue<number>;
  milestone?: boolean;
  notBefore?: string;
  deadline?: string;
  /** Predecessors by key. On phases only "after the end" (FS) links are allowed. */
  deps: Record<string, PmDep>;
}

export interface PlanItem {
  key: string;
  parentKey: string | null;
  subprojectId: string | null;
  title: string;
  sort: number;
  pm: PlanPm;
  /** 0–100; 100 = done. */
  progress: number;
  actualStart: string | null;
  actualEnd: string | null;
  /** User ids of the people working on it. */
  assignees: string[];
  internal: boolean;
  /** Planned effort per project role id, in minutes (1 day = 480). Part of the version. */
  efforts: Record<string, number>;
  /** Estimated remaining effort per role (minutes); missing = plan − actual. Actual data like progress. */
  remaining: Record<string, number>;
  /** Optimistic locking: every change raises it. */
  rev: number;
}

export interface PlanSubproject {
  id: string;
  /** Parent project (the root project for top-level subprojects). */
  parentId: string | null;
  name: string;
  /** Position among its siblings in the plan. */
  sort: number;
}

export interface PlanSettings {
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  /** Where planning starts; default: project start, else today. */
  projectStart: string | null;
  /** Resource levelling (one person, one task at a time). */
  level: boolean;
  /** A task without a given duration takes as long as its largest role effort divided by the people on it. */
  durationFromEffort: boolean;
  /** What customers see of the effort estimation. */
  effortView: EffortView;
  /** Forecast above budget by more than these percentages: yellow, red. */
  warnPct: number;
  critPct: number;
}

export const EFFORT_VIEWS = ['none', 'customer', 'plan', 'full'] as const;
export type EffortView = (typeof EFFORT_VIEWS)[number];

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  workDays: [1, 2, 3, 4, 5],
  projectStart: null,
  level: false,
  durationFromEffort: false,
  effortView: 'plan',
  warnPct: 5,
  critPct: 10,
};

export function planSettingsOf(raw: unknown): PlanSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const days = Array.isArray(o.workDays)
    ? [...new Set(o.workDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  return {
    workDays: days.length ? days : DEFAULT_PLAN_SETTINGS.workDays,
    projectStart: isDate(o.projectStart) ? o.projectStart : null,
    level: o.level === true,
    durationFromEffort: o.durationFromEffort === true,
    effortView: (EFFORT_VIEWS as readonly unknown[]).includes(o.effortView)
      ? (o.effortView as EffortView)
      : DEFAULT_PLAN_SETTINGS.effortView,
    warnPct: typeof o.warnPct === 'number' && o.warnPct >= 0 ? o.warnPct : DEFAULT_PLAN_SETTINGS.warnPct,
    critPct: typeof o.critPct === 'number' && o.critPct >= 0 ? o.critPct : DEFAULT_PLAN_SETTINGS.critPct,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Tree

export type PlanRow =
  | { kind: 'item'; id: string; item: PlanItem; depth: number; summary: boolean; parentRow: string | null }
  | { kind: 'subproject'; id: string; sub: PlanSubproject; depth: number; summary: true; parentRow: string | null };

/** Row ids: items by key, subprojects as "sub:<id>". */
export const subRowId = (id: string) => `sub:${id}`;

type Container = { sub: string | null; parentKey: string | null };

/** Index of the plan tree; tolerant of items whose parent or subproject is missing (filtered views). */
export class PlanTree {
  readonly items: Map<string, PlanItem>;
  readonly subs: Map<string, PlanSubproject>;
  readonly rows: PlanRow[];
  private readonly childMap = new Map<string, PlanItem[]>();

  constructor(
    items: PlanItem[],
    subprojects: PlanSubproject[],
    readonly rootId: string,
  ) {
    this.items = new Map(items.map((i) => [i.key, i]));
    this.subs = new Map(subprojects.map((s) => [s.id, s]));
    for (const i of items) {
      const p = this.parentOf(i);
      if (p) this.childMap.set(p, [...(this.childMap.get(p) ?? []), i]);
    }
    this.rows = [];
    this.walk({ sub: null, parentKey: null }, 0, null, new Set());
  }

  /** The key of an item's parent item, if that exists. */
  parentOf(item: PlanItem): string | null {
    const p = item.parentKey ? this.items.get(item.parentKey) : undefined;
    return p && p.key !== item.key ? p.key : null;
  }

  /** The subproject an item effectively sits in (null = project level). */
  subOf(item: PlanItem): string | null {
    return item.subprojectId && this.subs.has(item.subprojectId) ? item.subprojectId : null;
  }

  /** Subproject's container: its parent subproject, or the top (also when the parent is not visible). */
  private subParent(s: PlanSubproject): string | null {
    return s.parentId && s.parentId !== this.rootId && this.subs.has(s.parentId) ? s.parentId : null;
  }

  childrenOf(key: string): PlanItem[] {
    return this.childMap.get(key) ?? [];
  }

  isSummary(key: string): boolean {
    return this.childrenOf(key).length > 0;
  }

  /** Siblings in a container, in plan order. */
  siblings(c: Container): ({ kind: 'item'; item: PlanItem; sort: number } | { kind: 'subproject'; sub: PlanSubproject; sort: number })[] {
    const out: ({ kind: 'item'; item: PlanItem; sort: number } | { kind: 'subproject'; sub: PlanSubproject; sort: number })[] = [];
    if (c.parentKey) {
      for (const item of this.childrenOf(c.parentKey)) out.push({ kind: 'item', item, sort: item.sort });
    } else {
      for (const item of this.items.values()) {
        if (!this.parentOf(item) && this.subOf(item) === c.sub) out.push({ kind: 'item', item, sort: item.sort });
      }
      for (const sub of this.subs.values()) if (this.subParent(sub) === c.sub) out.push({ kind: 'subproject', sub, sort: sub.sort });
    }
    return out.sort((a, b) => a.sort - b.sort || (a.kind === b.kind ? 0 : a.kind === 'subproject' ? 1 : -1));
  }

  containerOfItem(item: PlanItem): Container {
    const p = this.parentOf(item);
    return p ? { sub: this.subOf(item), parentKey: p } : { sub: this.subOf(item), parentKey: null };
  }

  containerOfSub(sub: PlanSubproject): Container {
    return { sub: this.subParent(sub), parentKey: null };
  }

  /** All items below an item (not the item itself). */
  descendants(key: string): PlanItem[] {
    const out: PlanItem[] = [];
    const stack = [...this.childrenOf(key)];
    while (stack.length) {
      const i = stack.pop()!;
      out.push(i);
      stack.push(...this.childrenOf(i.key));
    }
    return out;
  }

  /** Item keys of the ancestors (phases) of an item, nearest first. */
  ancestors(key: string): string[] {
    const out: string[] = [];
    let item = this.items.get(key);
    while (item) {
      const p = this.parentOf(item);
      if (!p || out.includes(p)) break;
      out.push(p);
      item = this.items.get(p);
    }
    return out;
  }

  private walk(c: Container, depth: number, parentRow: string | null, seen: Set<string>) {
    for (const s of this.siblings(c)) {
      if (s.kind === 'item') {
        if (seen.has(s.item.key)) continue;
        seen.add(s.item.key);
        const summary = this.isSummary(s.item.key);
        this.rows.push({ kind: 'item', id: s.item.key, item: s.item, depth, summary, parentRow });
        if (summary) this.walk({ sub: this.subOf(s.item), parentKey: s.item.key }, depth + 1, s.item.key, seen);
      } else {
        const id = subRowId(s.sub.id);
        if (seen.has(id)) continue;
        seen.add(id);
        this.rows.push({ kind: 'subproject', id, sub: s.sub, depth, summary: true, parentRow });
        this.walk({ sub: s.sub.id, parentKey: null }, depth + 1, id, seen);
      }
    }
    // Items in a cycle of parents never show up above; put them at the top level so nothing gets lost.
    if (depth === 0) {
      for (const item of this.items.values()) {
        if (!seen.has(item.key)) {
          seen.add(item.key);
          this.rows.push({ kind: 'item', id: item.key, item, depth: 0, summary: false, parentRow: null });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Dependencies of phases: a link from or to a phase stands for links from/to all tasks inside it.

/** Leaf tasks with the links they really have (own links, links of their phases, phases expanded). */
function leafLinks(tree: PlanTree): Map<string, Record<string, PmDep>> {
  const leavesOf = (key: string): string[] => {
    if (!tree.isSummary(key)) return [key];
    return tree
      .descendants(key)
      .filter((d) => !tree.isSummary(d.key))
      .map((d) => d.key);
  };
  const out = new Map<string, Record<string, PmDep>>();
  for (const item of tree.items.values()) {
    if (tree.isSummary(item.key)) continue;
    const deps: Record<string, PmDep> = {};
    for (const owner of [item.key, ...tree.ancestors(item.key)]) {
      for (const [pred, dep] of Object.entries(tree.items.get(owner)!.pm.deps)) {
        if (!tree.items.has(pred)) continue;
        for (const leaf of leavesOf(pred)) {
          if (leaf === item.key) continue;
          const current = deps[leaf];
          // Two links to the same task: the stronger one (the later start) wins; keep FS with the larger lag.
          if (!current || (current.type === dep.type && dep.lag > current.lag)) deps[leaf] = dep;
        }
      }
    }
    out.set(item.key, deps);
  }
  return out;
}

/** Whether the plan's links (with phases expanded) contain a circle. */
export function hasCycle(items: PlanItem[], subprojects: PlanSubproject[], rootId: string): boolean {
  const tree = new PlanTree(items, subprojects, rootId);
  const links = leafLinks(tree);
  // A phase linked to one of its own tasks (or ancestors) is a circle as well.
  for (const item of items) {
    const family = new Set([...tree.ancestors(item.key), ...tree.descendants(item.key).map((d) => d.key)]);
    if (Object.keys(item.pm.deps).some((p) => family.has(p) || p === item.key)) return true;
  }
  const indeg = new Map([...links.keys()].map((k) => [k, 0]));
  for (const [k, deps] of links) indeg.set(k, Object.keys(deps).filter((p) => links.has(p)).length);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([k]) => k);
  let seen = 0;
  const succs = new Map<string, string[]>();
  for (const [k, deps] of links) for (const p of Object.keys(deps)) if (links.has(p)) succs.set(p, [...(succs.get(p) ?? []), k]);
  while (queue.length) {
    const k = queue.shift()!;
    seen++;
    for (const s of succs.get(k) ?? []) {
      const d = indeg.get(s)! - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  return seen < links.size;
}

// ---------------------------------------------------------------------------------------------------------
// Computing the plan

export interface RowPlan {
  start: string;
  end: string;
  /** Working minutes (leaf: its duration; summary: from the first start to the last end). */
  duration: number;
  progress: number;
  critical: boolean;
  milestone: boolean;
  conflicts: PmConflict[];
  /** Leaf tasks only. */
  task?: ScheduledTask;
}

export interface ComputedPlan {
  tree: PlanTree;
  rows: PlanRow[];
  byRow: Map<string, RowPlan>;
  /** The whole project. */
  total: RowPlan | null;
  projectStart: string;
}

export function computePlan(
  items: PlanItem[],
  subprojects: PlanSubproject[],
  rootId: string,
  settings: PlanSettings,
  fallbackStart?: string | null,
  /** Project roles of each person (for "duration from effort"). */
  rolesOfUser?: Map<string, string[]>,
): ComputedPlan {
  const tree = new PlanTree(items, subprojects, rootId);
  const links = leafLinks(tree);
  const calendar = calendarOf(settings.workDays);
  const projectStart = settings.projectStart ?? fallbackStart ?? today();
  // Leaves in plan order (rows), so ties in levelling go to the task higher up.
  const tasks: ScheduleTask[] = tree.rows
    .filter((r): r is Extract<PlanRow, { kind: 'item' }> => r.kind === 'item' && !r.summary)
    .map((r) => ({
      id: r.item.key,
      start: r.item.pm.start,
      end: r.item.pm.end,
      dur: r.item.pm.dur ?? (settings.durationFromEffort ? durationFromEffort(r.item, rolesOfUser) : undefined),
      milestone: r.item.pm.milestone,
      notBefore: r.item.pm.notBefore,
      deadline: r.item.pm.deadline,
      deps: links.get(r.item.key) ?? {},
      resources: r.item.assignees,
      done: r.item.progress >= 100,
    }));
  const scheduled = schedule(tasks, { calendar, projectStart, level: settings.level });

  const byRow = new Map<string, RowPlan>();
  for (const [key, s] of scheduled) {
    const item = tree.items.get(key)!;
    byRow.set(key, {
      start: s.start,
      end: s.end,
      duration: s.duration,
      progress: item.progress,
      critical: s.critical && item.progress < 100,
      milestone: s.milestone,
      conflicts: s.conflicts,
      task: s,
    });
  }
  // Summaries bottom-up: rows are in tree order, so walking them backwards visits children first.
  const children = new Map<string, string[]>();
  for (const r of tree.rows) if (r.parentRow) children.set(r.parentRow, [...(children.get(r.parentRow) ?? []), r.id]);
  const rollup = (ids: string[]): RowPlan | null => {
    const parts = ids.map((id) => byRow.get(id)).filter((p): p is RowPlan => !!p);
    if (!parts.length) return null;
    const start = parts.reduce((m, p) => (p.start < m ? p.start : m), parts[0]!.start);
    const end = parts.reduce((m, p) => (p.end > m ? p.end : m), parts[0]!.end);
    const weight = parts.reduce((s, p) => s + p.duration, 0);
    const progress =
      weight > 0
        ? Math.round(parts.reduce((s, p) => s + p.progress * p.duration, 0) / weight)
        : Math.round(parts.reduce((s, p) => s + p.progress, 0) / parts.length);
    return {
      start,
      end,
      duration: parts.reduce((m, p) => Math.max(m, p.duration), 0),
      progress,
      critical: parts.some((p) => p.critical),
      milestone: false,
      conflicts: [...new Set(parts.flatMap((p) => p.conflicts))],
    };
  };
  for (const r of [...tree.rows].reverse()) {
    if (!r.summary) continue;
    const plan = rollup(children.get(r.id) ?? []);
    if (plan) {
      // A summary spans from its first start to its last end.
      plan.duration = Math.max(0, spanMinutes(plan.start, plan.end, settings.workDays));
      byRow.set(r.id, plan);
    }
  }
  const total = rollup(tree.rows.filter((r) => !r.parentRow).map((r) => r.id));
  if (total) total.duration = spanMinutes(total.start, total.end, settings.workDays);
  return { tree, rows: tree.rows, byRow, total, projectStart };
}

/** Duration from effort: the role that takes longest, its effort shared by the people on the task with that role. */
export function durationFromEffort(item: PlanItem, rolesOfUser?: Map<string, string[]>): PmValue<number> | undefined {
  let longest = 0;
  for (const [role, minutes] of Object.entries(item.efforts)) {
    const people = item.assignees.filter((u) => rolesOfUser?.get(u)?.includes(role)).length;
    longest = Math.max(longest, minutes / Math.max(1, people));
  }
  return longest > 0 ? { v: Math.ceil(longest), src: 'calc' } : undefined;
}

function spanMinutes(start: string, end: string, workDays: number[]): number {
  let n = 0;
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  for (let t = from; t <= to; t += 86_400_000) if (workDays.includes(new Date(t).getUTCDay())) n++;
  return daysToMinutes(n);
}

// ---------------------------------------------------------------------------------------------------------
// Editing the tree

export type PlanTarget = { kind: 'item'; key: string } | { kind: 'subproject'; id: string };
export type MoveDirection = 'up' | 'down' | 'indent' | 'outdent';

export interface TreeChanges {
  items: { key: string; parentKey: string | null; subprojectId: string | null; sort: number }[];
  subprojects: { id: string; sort: number }[];
}

const STEP = 1024;

/** Where a new item goes: into a subproject or phase (at the end), or right after a task. */
export function insertPosition(
  tree: PlanTree,
  anchor: PlanTarget | null,
): { parentKey: string | null; subprojectId: string | null; sort: number } {
  const after = (c: Container, sortOf: number | null) => {
    const sibs = tree.siblings(c);
    if (sortOf === null) return (sibs.at(-1)?.sort ?? 0) + STEP;
    const i = sibs.findIndex((s) => s.sort > sortOf);
    return i === -1 ? sortOf + STEP : (sortOf + sibs[i]!.sort) / 2;
  };
  if (anchor?.kind === 'subproject' && tree.subs.has(anchor.id)) {
    return { parentKey: null, subprojectId: anchor.id, sort: after({ sub: anchor.id, parentKey: null }, null) };
  }
  const item = anchor?.kind === 'item' ? tree.items.get(anchor.key) : undefined;
  if (item && tree.isSummary(item.key)) {
    return { parentKey: item.key, subprojectId: tree.subOf(item), sort: after({ sub: tree.subOf(item), parentKey: item.key }, null) };
  }
  if (item) {
    const c = tree.containerOfItem(item);
    return { parentKey: c.parentKey, subprojectId: c.sub, sort: after(c, item.sort) };
  }
  return { parentKey: null, subprojectId: null, sort: after({ sub: null, parentKey: null }, null) };
}

/** Moves a row up/down among its siblings, or (items) in and out of phases and subprojects. */
export function moveInTree(tree: PlanTree, target: PlanTarget, dir: MoveDirection): TreeChanges | null {
  const changes: TreeChanges = { items: [], subprojects: [] };
  const setItem = (item: PlanItem, parentKey: string | null, subprojectId: string | null, sort: number) => {
    changes.items.push({ key: item.key, parentKey, subprojectId, sort });
    // Everything inside goes along into the new subproject.
    for (const d of tree.descendants(item.key)) changes.items.push({ key: d.key, parentKey: d.parentKey, subprojectId, sort: d.sort });
  };
  const item = target.kind === 'item' ? tree.items.get(target.key) : undefined;
  const sub = target.kind === 'subproject' ? tree.subs.get(target.id) : undefined;
  if (!item && !sub) return null;
  const c = item ? tree.containerOfItem(item) : tree.containerOfSub(sub!);
  const sibs = tree.siblings(c);
  const idx = sibs.findIndex((s) => (s.kind === 'item' ? s.item.key === item?.key : s.sub.id === sub?.id));

  if (dir === 'up' || dir === 'down') {
    const j = idx + (dir === 'up' ? -1 : 1);
    if (j < 0 || j >= sibs.length) return null;
    // Renumber the siblings, then swap the two.
    const order = sibs.map((s, i) => ({ s, sort: (i + 1) * STEP }));
    [order[idx]!.sort, order[j]!.sort] = [order[j]!.sort, order[idx]!.sort];
    for (const { s, sort } of order) {
      if (s.sort === sort) continue;
      if (s.kind === 'item') changes.items.push({ key: s.item.key, parentKey: s.item.parentKey, subprojectId: s.item.subprojectId, sort });
      else changes.subprojects.push({ id: s.sub.id, sort });
    }
    return changes;
  }
  if (!item) return null; // Subprojects keep their place in the project tree.

  if (dir === 'indent') {
    const prev = sibs[idx - 1];
    if (!prev) return null;
    if (prev.kind === 'item') {
      const last = tree.childrenOf(prev.item.key).reduce((m, x) => Math.max(m, x.sort), 0);
      setItem(item, prev.item.key, tree.subOf(prev.item), last + STEP);
    } else {
      const last = tree.siblings({ sub: prev.sub.id, parentKey: null }).at(-1)?.sort ?? 0;
      setItem(item, null, prev.sub.id, last + STEP);
    }
    return changes;
  }

  // Outdent: right after the phase or subproject it was in.
  if (c.parentKey) {
    const parent = tree.items.get(c.parentKey)!;
    const pc = tree.containerOfItem(parent);
    const psibs = tree.siblings(pc);
    const next = psibs[psibs.findIndex((s) => s.kind === 'item' && s.item.key === parent.key) + 1];
    setItem(item, pc.parentKey, pc.sub, next ? (parent.sort + next.sort) / 2 : parent.sort + STEP);
    return changes;
  }
  if (c.sub) {
    const s = tree.subs.get(c.sub)!;
    const pc = tree.containerOfSub(s);
    const psibs = tree.siblings(pc);
    const next = psibs[psibs.findIndex((x) => x.kind === 'subproject' && x.sub.id === s.id) + 1];
    setItem(item, null, pc.sub, next ? (s.sort + next.sort) / 2 : s.sort + STEP);
    return changes;
  }
  return null;
}

/** Which link types are allowed between two rows (phases: only "after the end"). */
export function allowedDepTypes(tree: PlanTree, pred: string, succ: string): readonly DepType[] {
  return tree.isSummary(pred) || tree.isSummary(succ) ? ['FS'] : ['FS', 'SS', 'FF', 'SF'];
}

// ---------------------------------------------------------------------------------------------------------
// Comparing two versions

export type DiffField =
  'title' | 'start' | 'end' | 'duration' | 'milestone' | 'deps' | 'assignees' | 'place' | 'internal' | 'deadline' | 'effort';

export interface DiffRow {
  key: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  fields: DiffField[];
  /** Working days the start / end moved (positive = later); null when not comparable. */
  startShift: number | null;
  endShift: number | null;
  /** Change of planned effort per role (minutes; only roles that changed). */
  effortDelta: Record<string, number>;
  from?: { start: string; end: string; title: string };
  to?: { start: string; end: string; title: string };
}

export interface PlanDiff {
  rows: DiffRow[];
  /** Project end before and after, and the shift in working days. */
  end: { from: string | null; to: string | null; shift: number | null };
  /** Planned effort per role before and after (minutes). */
  effort: { from: Record<string, number>; to: Record<string, number> };
}

/** Per role: b − a, only where it differs. */
export function roleDelta(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[r] ?? 0) - (a[r] ?? 0);
    if (d !== 0) out[r] = d;
  }
  return out;
}

function planEffort(items: Iterable<PlanItem>, tree: PlanTree): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    if (tree.isSummary(i.key)) continue;
    for (const [r, m] of Object.entries(i.efforts)) out[r] = (out[r] ?? 0) + m;
  }
  return out;
}

/** Signed working days from one date to another (Monday → Tuesday = 1; across a weekend only workdays count). */
export function workdayShift(from: string, to: string, workDays: number[]): number {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  let n = 0;
  for (let t = Date.parse(`${a}T00:00:00Z`) + 86_400_000; t <= Date.parse(`${b}T00:00:00Z`); t += 86_400_000) {
    if (workDays.includes(new Date(t).getUTCDay())) n++;
  }
  return sign * n;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sameDeps = (a: Record<string, PmDep>, b: Record<string, PmDep>) =>
  sameSet(Object.keys(a), Object.keys(b)) && Object.entries(a).every(([k, d]) => b[k]!.type === d.type && b[k]!.lag === d.lag);

/**
 * What changed from `base` to `next` (both computed): tasks added, removed, moved in time or changed
 * otherwise. Progress and actual dates are no planning changes and are left out.
 */
export function diffPlans(base: ComputedPlan, next: ComputedPlan, workDays: number[]): PlanDiff {
  const rows: DiffRow[] = [];
  const shift = (a?: string, b?: string) => (a && b ? workdayShift(a, b, workDays) : null);
  for (const r of next.rows) {
    if (r.kind !== 'item') continue;
    const now = r.item;
    const was = base.tree.items.get(now.key);
    const c = next.byRow.get(now.key);
    const b = base.byRow.get(now.key);
    if (!was) {
      rows.push({
        key: now.key,
        title: now.title,
        kind: 'added',
        fields: [],
        startShift: null,
        endShift: null,
        effortDelta: roleDelta({}, now.efforts),
        to: c && { start: c.start, end: c.end, title: now.title },
      });
      continue;
    }
    const fields: DiffField[] = [];
    if (was.title !== now.title) fields.push('title');
    if (b && c && b.start !== c.start) fields.push('start');
    if (b && c && b.end !== c.end) fields.push('end');
    if (b && c && !b.milestone && !c.milestone && b.duration !== c.duration && !next.tree.isSummary(now.key)) fields.push('duration');
    if (!!was.pm.milestone !== !!now.pm.milestone) fields.push('milestone');
    if (!sameDeps(was.pm.deps, now.pm.deps)) fields.push('deps');
    if (!sameSet(was.assignees, now.assignees)) fields.push('assignees');
    if (was.parentKey !== now.parentKey || was.subprojectId !== now.subprojectId) fields.push('place');
    if (was.internal !== now.internal) fields.push('internal');
    if ((was.pm.deadline ?? null) !== (now.pm.deadline ?? null)) fields.push('deadline');
    const effortDelta = roleDelta(was.efforts, now.efforts);
    if (Object.keys(effortDelta).length) fields.push('effort');
    if (fields.length) {
      rows.push({
        key: now.key,
        title: now.title,
        kind: 'changed',
        fields,
        startShift: shift(b?.start, c?.start),
        endShift: shift(b?.end, c?.end),
        effortDelta,
        from: b && { start: b.start, end: b.end, title: was.title },
        to: c && { start: c.start, end: c.end, title: now.title },
      });
    }
  }
  for (const r of base.rows) {
    if (r.kind !== 'item' || next.tree.items.has(r.item.key)) continue;
    const b = base.byRow.get(r.item.key);
    rows.push({
      key: r.item.key,
      title: r.item.title,
      kind: 'removed',
      fields: [],
      startShift: null,
      endShift: null,
      effortDelta: roleDelta(r.item.efforts, {}),
      from: b && { start: b.start, end: b.end, title: r.item.title },
    });
  }
  const from = base.total?.end ?? null;
  const to = next.total?.end ?? null;
  return {
    rows,
    end: { from, to, shift: from && to ? workdayShift(from, to, workDays) : null },
    effort: { from: planEffort(base.tree.items.values(), base.tree), to: planEffort(next.tree.items.values(), next.tree) },
  };
}

/** Fields that describe what happened, not what is planned: they go along when a draft is accepted. */
export const ACTUAL_FIELDS = ['progress', 'actualStart', 'actualEnd', 'remaining'] as const;
