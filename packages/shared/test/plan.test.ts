import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDaysBetween,
  calendarOf,
  computePlan,
  diffPlans,
  workdayShift,
  DAY_MINUTES,
  DEFAULT_PLAN_SETTINGS,
  hasCycle,
  insertPosition,
  isoWeek,
  isWorkDay,
  moveInTree,
  PlanTree,
  planSettingsOf,
  schedule,
  workBetween,
  type PlanItem,
  type PlanSubproject,
  type ScheduleTask,
} from '../src/index.js';

const days = (n: number) => ({ v: n * DAY_MINUTES, src: 'set' as const });
const fs = { type: 'FS' as const, lag: 0 };
// Monday, 16 November 2026; Monday to Friday.
const opts = { calendar: calendarOf(undefined), projectStart: '2026-11-16' };
const task = (id: string, extra: Partial<ScheduleTask> = {}): ScheduleTask => ({ id, deps: {}, ...extra });

describe('schedule (from the Shopping app)', () => {
  it('schedules a chain, skips weekends and finds the critical path', () => {
    const s = schedule([task('a', { dur: days(2) }), task('b', { dur: days(4), deps: { a: fs } }), task('c', { dur: days(1) })], opts);
    expect(s.get('a')).toMatchObject({ start: '2026-11-16', end: '2026-11-17', critical: true, startSrc: 'calc', durationSrc: 'set' });
    expect(s.get('b')).toMatchObject({ start: '2026-11-18', end: '2026-11-23', critical: true, float: 0 });
    expect(s.get('c')).toMatchObject({ earlyStart: '2026-11-16', lateStart: '2026-11-23', critical: false, float: 5 * DAY_MINUTES });
  });

  it('knows lags, other link types and milestones', () => {
    const s = schedule(
      [
        task('a', { dur: days(2) }),
        task('m', { milestone: true, deps: { a: fs } }),
        task('b', { dur: days(1), deps: { m: { type: 'FS', lag: 2 * DAY_MINUTES } } }),
        task('c', { dur: days(3), deps: { a: { type: 'SS', lag: DAY_MINUTES } } }),
        task('k', { milestone: true }),
      ],
      opts,
    );
    expect(s.get('m')).toMatchObject({ start: '2026-11-17', end: '2026-11-17', duration: 0, milestone: true });
    expect(s.get('b')).toMatchObject({ start: '2026-11-20', end: '2026-11-20' });
    expect(s.get('c')).toMatchObject({ start: '2026-11-17', end: '2026-11-19' });
    expect(s.get('k')).toMatchObject({ start: '2026-11-16' });
  });

  it('works with given dates and reports conflicts', () => {
    const s = schedule(
      [
        task('a', { dur: days(3) }),
        task('b', { start: { v: '2026-11-17', src: 'set' }, deps: { a: fs } }),
        task('c', { start: { v: '2026-11-23', src: 'set' }, end: { v: '2026-11-25', src: 'set' }, deadline: '2026-11-24' }),
        task('d', { notBefore: '2026-11-21' }),
        task('e', { start: { v: '2026-11-30', src: 'calc' } }),
      ],
      opts,
    );
    expect(s.get('b')).toMatchObject({ start: '2026-11-17', startSrc: 'set', conflicts: ['start'] });
    expect(s.get('c')).toMatchObject({ duration: 3 * DAY_MINUTES, durationSrc: 'calc', end: '2026-11-25', conflicts: ['deadline'] });
    expect(s.get('d')).toMatchObject({ start: '2026-11-23' });
    expect(s.get('e')).toMatchObject({ start: '2026-11-16', startSrc: 'calc' });
  });

  it('uses the working days', () => {
    const s = schedule([task('a', { dur: days(3) })], { calendar: calendarOf([6, 0]), projectStart: '2026-11-16' });
    expect(s.get('a')).toMatchObject({ start: '2026-11-21', end: '2026-11-28' });
  });

  it('survives circles', () => {
    const s = schedule([task('a', { deps: { b: fs } }), task('b', { deps: { a: fs } }), task('c', { deps: { b: fs } })], opts);
    expect(s.get('a')!.conflicts).toContain('cycle');
    expect(s.size).toBe(3);
  });

  it('levels resources when asked', () => {
    const items = [task('a', { dur: days(2), resources: ['anna'] }), task('b', { dur: days(3), resources: ['anna'] })];
    expect(schedule(items, opts).get('a')!.start).toBe('2026-11-16');
    const s = schedule(items, { ...opts, level: true });
    expect(s.get('b')).toMatchObject({ start: '2026-11-16' });
    expect(s.get('a')).toMatchObject({ start: '2026-11-19', waitsFor: { id: 'b', person: 'anna' } });
  });

  it('calendar helpers', () => {
    const cal = calendarOf(undefined);
    expect(isWorkDay('2026-11-21', cal)).toBe(false);
    expect(addCalendarDays('2026-11-30', 2)).toBe('2026-12-02');
    expect(calendarDaysBetween('2026-11-30', '2026-11-28')).toBe(-2);
    expect(workBetween('2026-11-19', '2026-11-24', cal)).toBe(4 * DAY_MINUTES);
  });

  it('counts ISO weeks', () => {
    expect(isoWeek('2026-11-16')).toBe(47);
    expect(isoWeek('2026-11-22')).toBe(47);
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2024-12-30')).toBe(1);
    expect(isoWeek('2021-01-03')).toBe(53);
  });
});

let n = 0;
const item = (key: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  key,
  parentKey: null,
  subprojectId: null,
  title: key,
  sort: ++n * 1024,
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
const sub = (id: string, sort: number, parentId = 'root'): PlanSubproject => ({ id, parentId, name: id, sort });
const settings = { ...DEFAULT_PLAN_SETTINGS, projectStart: '2026-11-16' };

describe('plan tree', () => {
  it('orders project-level items, subprojects and phases', () => {
    const items = [
      item('kickoff', { sort: 1 }),
      item('golive', { sort: 5000 }),
      item('if1', { subprojectId: 'S', sort: 1 }),
      item('phase', { sort: 2 }),
      item('p1', { parentKey: 'phase', sort: 1 }),
    ];
    const tree = new PlanTree(items, [sub('S', 3000)], 'root');
    expect(tree.rows.map((r) => `${'.'.repeat(r.depth)}${r.id}`)).toEqual(['kickoff', 'phase', '.p1', 'sub:S', '.if1', 'golive']);
    expect(tree.rows.find((r) => r.id === 'phase')!.summary).toBe(true);
  });

  it('shows items of hidden parents at the top (filtered views)', () => {
    const tree = new PlanTree([item('x', { parentKey: 'gone', subprojectId: 'hidden' })], [], 'root');
    expect(tree.rows.map((r) => r.id)).toEqual(['x']);
  });

  it('rolls phases and subprojects up and expands links of phases', () => {
    const items = [
      item('a', { pm: { dur: days(2), deps: {} } }),
      item('phase', { pm: { deps: { a: fs } } }),
      item('p1', { parentKey: 'phase', pm: { dur: days(1), deps: {} } }),
      item('p2', { parentKey: 'phase', pm: { dur: days(3), deps: {} } }),
      item('after', { pm: { milestone: true, deps: { phase: fs } } }),
      item('s1', { subprojectId: 'S', pm: { dur: days(1), deps: {} }, progress: 100 }),
      item('s2', { subprojectId: 'S', pm: { dur: days(1), deps: {} } }),
    ];
    const plan = computePlan(items, [sub('S', 99_999)], 'root', settings);
    // Both tasks of the phase wait for a; the milestone waits for both.
    expect(plan.byRow.get('p1')).toMatchObject({ start: '2026-11-18' });
    expect(plan.byRow.get('p2')).toMatchObject({ start: '2026-11-18', end: '2026-11-20' });
    expect(plan.byRow.get('phase')).toMatchObject({ start: '2026-11-18', end: '2026-11-20', duration: 3 * DAY_MINUTES });
    expect(plan.byRow.get('after')).toMatchObject({ start: '2026-11-20', milestone: true });
    expect(plan.byRow.get('sub:S')).toMatchObject({ start: '2026-11-16', end: '2026-11-16', progress: 50 });
    expect(plan.total).toMatchObject({ start: '2026-11-16', end: '2026-11-20' });
  });

  it('finds circles through phases', () => {
    const items = [item('phase'), item('p1', { parentKey: 'phase' }), item('x', { pm: { deps: { phase: fs } } })];
    expect(hasCycle(items, [], 'root')).toBe(false);
    expect(hasCycle([...items.slice(0, 2), item('x2', { pm: { deps: { phase: fs } } }), { ...items[0]!, pm: { deps: { x2: fs } } }], [], 'root')).toBe(true);
    // A phase after one of its own tasks.
    expect(hasCycle([{ ...items[0]!, pm: { deps: { p1: fs } } }, items[1]!], [], 'root')).toBe(true);
  });

  it('inserts after a task, at the end of a phase or subproject', () => {
    const items = [item('a', { sort: 1024 }), item('b', { sort: 2048 }), item('phase', { sort: 4096 }), item('p1', { parentKey: 'phase', sort: 1024 })];
    const tree = new PlanTree(items, [sub('S', 8192)], 'root');
    expect(insertPosition(tree, { kind: 'item', key: 'a' })).toEqual({ parentKey: null, subprojectId: null, sort: 1536 });
    expect(insertPosition(tree, { kind: 'item', key: 'phase' })).toEqual({ parentKey: 'phase', subprojectId: null, sort: 2048 });
    expect(insertPosition(tree, { kind: 'subproject', id: 'S' })).toEqual({ parentKey: null, subprojectId: 'S', sort: 1024 });
    expect(insertPosition(tree, null).sort).toBe(8192 + 1024);
  });

  it('moves rows up, down, in and out', () => {
    const items = [item('a', { sort: 1 }), item('b', { sort: 2 }), item('c', { sort: 3 }), item('c1', { parentKey: 'c', sort: 1 })];
    const tree = new PlanTree(items, [sub('S', 4)], 'root');
    const up = moveInTree(tree, { kind: 'item', key: 'b' }, 'up')!;
    expect(up.items.find((i) => i.key === 'b')!.sort).toBeLessThan(up.items.find((i) => i.key === 'a')!.sort);
    expect(moveInTree(tree, { kind: 'item', key: 'a' }, 'up')).toBeNull();
    // b goes into a (a becomes a phase).
    expect(moveInTree(tree, { kind: 'item', key: 'b' }, 'indent')!.items[0]).toMatchObject({ key: 'b', parentKey: 'a', subprojectId: null });
    // c (with its child) goes into the subproject below? No – indent uses the row above: b.
    expect(moveInTree(tree, { kind: 'item', key: 'c' }, 'indent')!.items.map((i) => i.key)).toEqual(['c', 'c1']);
    // Out of the phase: right after it.
    const out = moveInTree(tree, { kind: 'item', key: 'c1' }, 'outdent')!;
    expect(out.items[0]).toMatchObject({ key: 'c1', parentKey: null, sort: 3.5 });
    // The subproject moves among the top rows.
    const subUp = moveInTree(tree, { kind: 'subproject', id: 'S' }, 'up')!;
    expect(subUp.subprojects).toHaveLength(1);
    expect(moveInTree(tree, { kind: 'subproject', id: 'S' }, 'indent')).toBeNull();
  });

  it('indents into a subproject and takes the children along', () => {
    const items = [item('p', { sort: 2 }), item('p1', { parentKey: 'p', sort: 1 }), item('s1', { subprojectId: 'S', sort: 1 })];
    const tree = new PlanTree(items, [sub('S', 1)], 'root');
    const ch = moveInTree(tree, { kind: 'item', key: 'p' }, 'indent')!;
    expect(ch.items).toEqual([
      { key: 'p', parentKey: null, subprojectId: 'S', sort: 1025 },
      { key: 'p1', parentKey: 'p', subprojectId: 'S', sort: 1 },
    ]);
    const out = moveInTree(tree, { kind: 'item', key: 's1' }, 'outdent')!;
    expect(out.items[0]).toMatchObject({ key: 's1', subprojectId: null, sort: 1.5 });
  });

  it('reads settings defensively', () => {
    expect(planSettingsOf({ workDays: [6, 0, 9], projectStart: 'x', level: 'yes', effortView: 'all' })).toMatchObject({ workDays: [0, 6], projectStart: null, level: false, effortView: 'plan' });
    expect(planSettingsOf(null)).toEqual(DEFAULT_PLAN_SETTINGS);
  });
});

describe('comparing versions', () => {
  it('counts working days between dates', () => {
    expect(workdayShift('2026-11-20', '2026-11-23', [1, 2, 3, 4, 5])).toBe(1);
    expect(workdayShift('2026-11-23', '2026-11-20', [1, 2, 3, 4, 5])).toBe(-1);
    expect(workdayShift('2026-11-16', '2026-11-16', [1, 2, 3, 4, 5])).toBe(0);
  });

  it('finds added, removed and changed tasks; progress is no change', () => {
    const base = [item('a', { pm: { dur: days(2), deps: {} } }), item('b', { pm: { dur: days(1), deps: { a: fs } } }), item('gone')];
    const next = [
      { ...base[0]!, pm: { dur: days(4), deps: {} }, progress: 50 },
      { ...base[1]!, assignees: ['anna'] },
      item('new', { pm: { milestone: true, deps: {} } }),
    ];
    const diff = diffPlans(computePlan(base, [], 'root', settings), computePlan(next, [], 'root', settings), [1, 2, 3, 4, 5]);
    const by = Object.fromEntries(diff.rows.map((r) => [r.key, r]));
    expect(by.a).toMatchObject({ kind: 'changed', fields: ['end', 'duration'], startShift: 0, endShift: 2 });
    expect(by.b).toMatchObject({ kind: 'changed', fields: ['start', 'end', 'assignees'], startShift: 2 });
    expect(by.new!.kind).toBe('added');
    expect(by.gone!.kind).toBe('removed');
    expect(diff.end).toEqual({ from: '2026-11-18', to: '2026-11-20', shift: 2 });
  });
});
