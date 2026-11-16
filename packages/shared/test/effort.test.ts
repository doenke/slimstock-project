import { describe, expect, it } from 'vitest';
import { computeEffort, durationFromEffort, PlanTree, taskEffort, unitBudgets, type EffortEntry, type PlanItem } from '../src/index.js';

const D = 480;
let n = 0;
const item = (key: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  key,
  parentKey: null,
  subprojectId: null,
  title: key,
  sort: ++n,
  pm: { deps: {} },
  progress: 0,
  actualStart: null,
  actualEnd: null,
  assignees: [],
  internal: false,
  efforts: {},
  remaining: {},
  rev: 1,
  ...extra,
});
const entry = (itemKey: string, roleId: string, days: number): EffortEntry => ({
  id: `${itemKey}${roleId}${days}`,
  itemKey,
  userId: 'u',
  roleId,
  date: '2026-11-16',
  minutes: days * D,
  note: null,
});

describe('effort', () => {
  it('derives remaining and forecast per task', () => {
    const a = item('a', { efforts: { sa: 3 * D, ku: 2 * D } });
    expect(taskEffort(a, { sa: 1 * D })).toEqual({ plan: { sa: 3 * D, ku: 2 * D }, actual: { sa: D }, remaining: { sa: 2 * D, ku: 2 * D }, forecast: { sa: 3 * D, ku: 2 * D } });
    // A given remaining wins; done tasks have nothing left.
    expect(taskEffort({ ...a, remaining: { sa: 4 * D } }, { sa: D }).forecast.sa).toBe(5 * D);
    expect(taskEffort({ ...a, progress: 100 }, { sa: D }).remaining).toEqual({});
  });

  it('sums up phases, subprojects and the project; keeps bookings on removed tasks', () => {
    const items = [item('p'), item('p1', { parentKey: 'p', efforts: { sa: D } }), item('p2', { parentKey: 'p', efforts: { sa: 2 * D } }), item('s1', { subprojectId: 'S', efforts: { c: 4 * D } })];
    const tree = new PlanTree(items, [{ id: 'S', parentId: 'root', name: 'S', sort: 9 }], 'root');
    const e = computeEffort(tree, [entry('p1', 'sa', 0.5), entry('gone', 'c', 1)]);
    expect(e.byRow.get('p')!.plan).toEqual({ sa: 3 * D });
    expect(e.byRow.get('sub:S')!.plan).toEqual({ c: 4 * D });
    expect(e.total.plan).toEqual({ sa: 3 * D, c: 4 * D });
    expect(e.total.actual).toEqual({ sa: 0.5 * D, c: D });
    expect(e.orphanActual).toEqual({ c: D });
  });

  it('compares forecast with the budget per unit', () => {
    const items = [item('a', { efforts: { sa: 10 * D, ku: 5 * D } }), item('s1', { subprojectId: 'S', efforts: { sa: 10 * D } })];
    const tree = new PlanTree(items, [{ id: 'S', parentId: 'root', name: 'S', sort: 9 }], 'root');
    const units = unitBudgets({
      tree,
      entries: [entry('a', 'sa', 11)],
      terms: { S: { billing: 'fixed', budget: { sa: 8 * D } } },
      slimstockRoles: new Set(['sa']),
      workingPlan: new Map([['root', { sa: 10 * D }]]),
      warnPct: 5,
      critPct: 10,
    });
    const root = units.find((u) => u.unitId === 'root')!;
    // 11 days booked, nothing left (remaining = max(0, plan − actual)) → 10 % over.
    expect(root).toMatchObject({ billing: 'tm', budget: 10 * D, actual: 11 * D, forecast: 11 * D, deviationPct: 10, level: 'warn' });
    const s = units.find((u) => u.unitId === 'S')!;
    expect(s).toMatchObject({ billing: 'fixed', budget: 8 * D, plan: 10 * D, deviationPct: 25, level: 'crit', pending: false });
  });

  it('derives a duration from the effort', () => {
    const roles = new Map([
      ['anna', ['sa']],
      ['ben', ['sa', 'c']],
    ]);
    expect(durationFromEffort(item('x', { efforts: { sa: 4 * D, c: 3 * D }, assignees: ['anna', 'ben'] }), roles)).toEqual({ v: 3 * D, src: 'calc' });
    expect(durationFromEffort(item('y', { efforts: {} }), roles)).toBeUndefined();
  });
});
