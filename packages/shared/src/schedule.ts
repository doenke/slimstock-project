/**
 * Scheduling core (critical path method with working calendar and optional resource levelling).
 * Ported from the project planning of the Shopping app (doenke/shopping, packages/shared/src/pm.ts) and
 * kept independent of how items are stored: `plan.ts` feeds it with the leaf tasks of a plan.
 */

export type PmSource = 'set' | 'calc';
export interface PmValue<T> {
  v: T;
  src: PmSource;
}
/** FS: starts after the predecessor's end, SS: starts with its start, FF: ends with its end, SF: ends with its start. */
export type DepType = 'FS' | 'SS' | 'FF' | 'SF';
export const DEP_TYPES: readonly DepType[] = ['FS', 'SS', 'FF', 'SF'];
export interface PmDep {
  type: DepType;
  /** Minutes of working time; negative = overlap. */
  lag: number;
}

/** Minutes of a standard working day (durations are shown in days of this length). */
export const DAY_MINUTES = 480;
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ---------------------------------------------------------------------------------------------------------
// Working calendar

/** Minutes of working time per weekday (0 = Sunday); 0 = free day. */
export interface WorkCalendar {
  minutes: number[];
}

/** Working days (0 = Sunday … 6 = Saturday) as a calendar with standard days. */
export function calendarOf(workDays: readonly number[] | undefined): WorkCalendar {
  const days = workDays && workDays.some((d) => d >= 0 && d <= 6) ? workDays : DEFAULT_WORK_DAYS;
  return { minutes: [0, 1, 2, 3, 4, 5, 6].map((d) => (days.includes(d) ? DAY_MINUTES : 0)) };
}

const DAY_MS = 86_400_000;
/** Days since 1970-01-01 (a Thursday) of a "YYYY-MM-DD" date. */
const dayNumber = (date: string) => Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
const dateOfDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** Weekday (0 = Sunday) of a day number. */
const weekday = (n: number) => (((n + 4) % 7) + 7) % 7;

/**
 * Working time as one axis: minutes of working time since the Monday 1970-01-05 (free days take no room).
 * The end of one working day and the start of the next one are the same point; dates show a point as the
 * day it starts (for starts) or ends (for ends) in.
 */
class Axis {
  readonly week: number;
  private readonly cal: WorkCalendar;
  /** Working minutes before each weekday, in a week starting on Monday. */
  private readonly before: number[];
  constructor(cal: WorkCalendar) {
    const m = cal.minutes.some((x) => x > 0) ? cal.minutes : [0, ...DEFAULT_WORK_DAYS.map(() => DAY_MINUTES), 0];
    this.cal = { minutes: m };
    this.week = m.reduce((a, b) => a + b, 0);
    this.before = [];
    let sum = 0;
    for (const d of [1, 2, 3, 4, 5, 6, 0]) {
      this.before[d] = sum;
      sum += m[d]!;
    }
  }
  /** Where a day starts on the axis (a free day: where the next working day starts). */
  dayStart(day: number): number {
    const fromMonday = day - 4; // day 4 = 1970-01-05, a Monday
    const weeks = Math.floor(fromMonday / 7);
    return weeks * this.week + this.before[weekday(day)]!;
  }
  dayEnd(day: number): number {
    return this.dayStart(day) + this.cal.minutes[weekday(day)]!;
  }
  /** The working day a point starts in (a point at a day's end belongs to the next working day). */
  startDay(t: number): number {
    let day = 4 + Math.floor(t / this.week) * 7;
    while (this.dayEnd(day) <= t || this.cal.minutes[weekday(day)] === 0) day++;
    return day;
  }
  /** The working day a point ends in (a point at a day's start belongs to the previous working day). */
  endDay(t: number): number {
    let day = 4 + Math.floor(t / this.week) * 7 + 7;
    while (this.dayStart(day) >= t || this.cal.minutes[weekday(day)] === 0) day--;
    return day;
  }
}

/** Whether a date is a working day of the calendar. */
export function isWorkDay(date: string, cal: WorkCalendar): boolean {
  return (cal.minutes[weekday(dayNumber(date))] ?? 0) > 0;
}

/** A date plus some calendar days. */
export function addCalendarDays(date: string, days: number): string {
  return dateOfDay(dayNumber(date) + days);
}

/** Calendar days from one date to another (negative when `to` lies before `from`). */
export function calendarDaysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Working time from the start of one day to the end of another (0 if the end lies before the start). */
export function workBetween(start: string, end: string, cal: WorkCalendar): number {
  const axis = new Axis(cal);
  return Math.max(0, axis.dayEnd(dayNumber(end)) - axis.dayStart(dayNumber(start)));
}

/** Duration (minutes of working time) shown in working days. */
export function minutesToDays(min: number): number {
  return Math.round((min / DAY_MINUTES) * 100) / 100;
}
export function daysToMinutes(days: number): number {
  return Math.round(days * DAY_MINUTES);
}

/** Today as "YYYY-MM-DD" (local time). */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------
// Scheduling

export type PmConflict =
  /** The given start lies before what the predecessors (or "not before") allow. */
  | 'start'
  /** The given end lies before what the predecessors allow. */
  | 'end'
  /** The planned end lies after the deadline. */
  | 'deadline'
  /** Part of a circle of dependencies (those links are ignored). */
  | 'cycle'
  /** Someone has two given (fixed) tasks at the same time. */
  | 'resource';

/** One task as the scheduler sees it. */
export interface ScheduleTask {
  id: string;
  start?: PmValue<string>;
  end?: PmValue<string>;
  dur?: PmValue<number>;
  milestone?: boolean;
  notBefore?: string;
  deadline?: string;
  deps: Record<string, PmDep>;
  /** Who works on it (for resource levelling). */
  resources?: string[];
  /** Done tasks occupy nobody. */
  done?: boolean;
}

export interface ScheduledTask {
  id: string;
  milestone: boolean;
  /** Duration in minutes of working time. */
  duration: number;
  durationSrc: PmSource;
  startSrc: PmSource;
  endSrc: PmSource;
  /** Planned start / end (dates): given ones, else the early dates. */
  start: string;
  end: string;
  earlyStart: string;
  earlyEnd: string;
  lateStart: string;
  lateEnd: string;
  /** Total float in minutes of working time (negative: the plan does not work out). */
  float: number;
  resources: string[];
  /** Resource levelling moved it back: the task whose person it waits for. */
  waitsFor: { id: string; person: string } | null;
  critical: boolean;
  conflicts: PmConflict[];
}

export interface ScheduleOptions {
  calendar: WorkCalendar;
  /** Where the plan starts. */
  projectStart: string;
  /** Resource levelling: one person does one task after the other (default off). */
  level?: boolean;
}

interface Node {
  id: string;
  dur: number;
  durSrc: PmSource;
  milestone: boolean;
  fixedStart: number | null;
  fixedEnd: number | null;
  notBefore: number | null;
  deadline: number | null;
  preds: { id: string; dep: PmDep }[];
  succs: { id: string; dep: PmDep }[];
  es: number;
  ef: number;
  ls: number;
  lf: number;
  bound: boolean;
  res: string[];
  done: boolean;
  waitsFor: { id: string; person: string } | null;
  conflicts: Set<PmConflict>;
}

/**
 * Computes early and late dates, float and the critical path (tasks in their plan order; dependencies on
 * tasks that are not there are ignored). Given start/end/duration ("set") are fixed; a given start and
 * end together decide the duration. Without a duration a task takes one day, a milestone none.
 */
export function schedule(tasks: ScheduleTask[], opts: ScheduleOptions): Map<string, ScheduledTask> {
  const axis = new Axis(opts.calendar);
  const nodes = new Map<string, Node>();
  for (const t of tasks) {
    const milestone = t.milestone === true;
    const res = [...new Set((t.resources ?? []).filter(Boolean))];
    const fixedStart = t.start?.src === 'set' ? axis.dayStart(dayNumber(t.start.v)) : null;
    const fixedEnd = t.end?.src === 'set' ? axis.dayEnd(dayNumber(t.end.v)) : null;
    let dur = milestone ? 0 : t.dur ? t.dur.v : DAY_MINUTES;
    let durSrc: PmSource = milestone || t.dur?.src === 'set' ? 'set' : 'calc';
    if (!milestone && fixedStart !== null && fixedEnd !== null) {
      dur = Math.max(0, fixedEnd - fixedStart);
      durSrc = 'calc';
    }
    nodes.set(t.id, {
      id: t.id,
      dur,
      durSrc,
      milestone,
      fixedStart: milestone && fixedStart !== null ? axis.dayEnd(dayNumber(t.start!.v)) : fixedStart,
      fixedEnd,
      notBefore: t.notBefore ? axis.dayStart(dayNumber(t.notBefore)) : null,
      deadline: t.deadline ? axis.dayEnd(dayNumber(t.deadline)) : null,
      preds: [],
      succs: [],
      es: 0,
      ef: 0,
      ls: 0,
      lf: 0,
      bound: false,
      res,
      done: t.done === true,
      waitsFor: null,
      conflicts: new Set(),
    });
  }
  for (const t of tasks) {
    for (const [pred, dep] of Object.entries(t.deps)) {
      if (pred === t.id || !nodes.has(pred)) continue;
      nodes.get(t.id)!.preds.push({ id: pred, dep });
      nodes.get(pred)!.succs.push({ id: t.id, dep });
    }
  }

  // Topological order (Kahn); what is left over sits in (or behind) a circle.
  const order: Node[] = [];
  const indeg = new Map([...nodes.values()].map((n) => [n.id, n.preds.length]));
  const queue = [...nodes.values()].filter((n) => n.preds.length === 0);
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const s of n.succs) {
      const d = indeg.get(s.id)! - 1;
      indeg.set(s.id, d);
      if (d === 0) queue.push(nodes.get(s.id)!);
    }
  }
  if (order.length < nodes.size) {
    const done = new Set(order.map((n) => n.id));
    const rest = [...nodes.values()].filter((n) => !done.has(n.id));
    const restIds = new Set(rest.map((n) => n.id));
    for (const n of rest) {
      n.conflicts.add('cycle');
      n.preds = n.preds.filter((p) => !restIds.has(p.id));
      n.succs = n.succs.filter((s) => !restIds.has(s.id));
    }
    for (const n of order) n.succs = n.succs.filter((s) => !restIds.has(s.id));
    order.push(...rest);
  }

  const projectStart = axis.dayStart(dayNumber(opts.projectStart));
  const earliest = (n: Node): number => {
    let es = Math.max(projectStart, n.notBefore ?? -Infinity);
    for (const { id, dep } of n.preds) {
      const p = nodes.get(id)!;
      const t =
        dep.type === 'FS'
          ? p.ef + dep.lag
          : dep.type === 'SS'
            ? p.es + dep.lag
            : dep.type === 'FF'
              ? p.ef + dep.lag - n.dur
              : p.es + dep.lag - n.dur;
      if (t >= es) n.bound = true;
      es = Math.max(es, t);
    }
    if (n.fixedStart !== null || n.fixedEnd !== null) n.bound = true;
    if (n.fixedStart !== null) {
      if (n.fixedStart < es) n.conflicts.add('start');
      es = n.fixedStart;
    } else if (n.fixedEnd !== null) {
      if (n.fixedEnd - n.dur < es) n.conflicts.add('end');
      es = n.fixedEnd - n.dur;
    }
    return es;
  };
  const forward = () => {
    for (const n of order) {
      n.es = earliest(n);
      n.ef = n.es + n.dur;
    }
  };
  const backward = () => {
    const projectEnd = Math.max(projectStart, ...order.map((n) => n.ef));
    for (const n of [...order].reverse()) {
      let lf = Math.min(projectEnd, n.deadline ?? Infinity);
      for (const { id, dep } of n.succs) {
        const s = nodes.get(id)!;
        const t =
          dep.type === 'FS'
            ? s.ls - dep.lag
            : dep.type === 'SS'
              ? s.ls - dep.lag + n.dur
              : dep.type === 'FF'
                ? s.lf - dep.lag
                : s.lf - dep.lag + n.dur;
        lf = Math.min(lf, t);
      }
      n.lf = lf;
      n.ls = lf - n.dur;
    }
  };

  forward();
  backward();

  // Resource levelling (serial): of the tasks whose predecessors are planned, the one with the least float
  // (latest start, then plan order) goes next, at the first time all its people are free.
  if (opts.level && order.some((n) => n.res.length && n.dur > 0 && !n.done)) {
    const busy = new Map<string, { from: number; to: number; id: string }[]>();
    const rank = new Map(tasks.map((t, i) => [t.id, i]));
    const left = new Set(order.map((n) => n.id));
    const placed = new Set<string>();
    while (left.size) {
      let next: Node | null = null;
      for (const id of left) {
        const n = nodes.get(id)!;
        if (!n.preds.every((p) => placed.has(p.id))) continue;
        if (!next || n.ls < next.ls || (n.ls === next.ls && rank.get(n.id)! < rank.get(next.id)!)) next = n;
      }
      if (!next) break;
      const n = next;
      let es = earliest(n);
      const fixed = n.fixedStart !== null || n.fixedEnd !== null;
      const uses = n.dur > 0 && !n.done ? n.res : [];
      for (let guard = 0; guard < 10_000; guard++) {
        let clash: { to: number; id: string; person: string } | null = null;
        for (const r of uses) {
          for (const b of busy.get(r) ?? []) {
            if (b.from < es + n.dur && es < b.to && (!clash || b.to > clash.to)) clash = { to: b.to, id: b.id, person: r };
          }
        }
        if (!clash) break;
        if (fixed) {
          n.conflicts.add('resource');
          break;
        }
        es = clash.to;
        n.waitsFor = { id: clash.id, person: clash.person };
      }
      n.es = es;
      n.ef = es + n.dur;
      for (const r of uses) busy.set(r, [...(busy.get(r) ?? []), { from: n.es, to: n.ef, id: n.id }]);
      placed.add(n.id);
      left.delete(n.id);
    }
    backward();
  }
  for (const n of order) if (n.deadline !== null && n.ef > n.deadline) n.conflicts.add('deadline');

  const out = new Map<string, ScheduledTask>();
  for (const n of nodes.values()) {
    const point = n.dur === 0;
    const startDate = (t: number) => dateOfDay(point && n.bound ? axis.endDay(t) : axis.startDay(t));
    const endDate = (t: number) => (point ? startDate(t) : dateOfDay(axis.endDay(t)));
    const float = n.ls - n.es;
    out.set(n.id, {
      id: n.id,
      milestone: n.milestone,
      duration: n.dur,
      durationSrc: n.durSrc,
      startSrc: n.fixedStart !== null ? 'set' : 'calc',
      endSrc: n.fixedEnd !== null ? 'set' : 'calc',
      start: startDate(n.es),
      end: endDate(n.ef),
      earlyStart: startDate(n.es),
      earlyEnd: endDate(n.ef),
      lateStart: startDate(n.ls),
      lateEnd: endDate(n.lf),
      float,
      critical: float <= 0,
      resources: n.res,
      waitsFor: n.waitsFor,
      conflicts: [...n.conflicts],
    });
  }
  return out;
}

/** ISO 8601 week number of a "YYYY-MM-DD" date (weeks start on Monday; week 1 holds the first Thursday). */
export function isoWeek(date: string): number {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  // The Thursday of this week decides the year the week belongs to.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
}
