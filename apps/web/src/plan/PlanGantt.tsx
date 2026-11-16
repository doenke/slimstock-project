import {
  addCalendarDays,
  calendarDaysBetween,
  calendarOf,
  isoWeek,
  isWorkDay,
  today as todayIso,
  workBetween,
  type DepType,
  type PlanPayload,
  type PlanRow,
  type RowPlan,
} from '@spm/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { conflictTexts, shortDate } from './text';

export type Zoom = 'day' | 'week';
const DAY_WIDTH: Record<Zoom, number> = { day: 28, week: 10 };
const ROW = 34;
const NAME_WIDTH = 260;
const PAD_BEFORE = 3;
const PAD_AFTER = 10;

interface Props {
  plan: PlanPayload;
  rows: PlanRow[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  zoom: Zoom;
  /** Dates of a compared version per row: drawn as thin grey bars below. */
  baseline?: Record<string, { start: string; end: string; milestone: boolean }>;
  /** Dragging finished: move the start (days) or change the length (new end date). */
  onDrag?: (key: string, change: { start: string; end?: string } | { dur: number }) => void;
}

interface Drag {
  id: string;
  mode: 'move' | 'end';
  x: number;
  days: number;
}

/**
 * The plan as a Gantt chart (ported from the Shopping app): one row per task, phase and subproject, bars
 * from planned start to end, milestones as diamonds, links as arrows, the critical path in red. Dragging a
 * bar moves its start, its right edge changes the duration.
 */
export function PlanGantt({ plan, rows, collapsed, onToggle, selected, onSelect, zoom, baseline, onDrag }: Props) {
  const { t } = useTranslation();
  const calendar = useMemo(() => calendarOf(plan.settings.workDays), [plan.settings.workDays]);
  const dw = DAY_WIDTH[zoom];
  const today = todayIso();
  const lang = i18n.language;
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }), [lang]);
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' }), [lang]);

  const range = useMemo(() => {
    const dates = rows.flatMap((r) => {
      const c = plan.computed[r.id];
      const deadline = r.kind === 'item' ? r.item.pm.deadline : undefined;
      const b = baseline?.[r.id];
      return [...(c ? [c.start, c.end, c.task?.lateEnd ?? c.end] : []), ...(deadline ? [deadline] : []), ...(b ? [b.start, b.end] : [])];
    });
    let from = dates.reduce((m, d) => (d < m ? d : m), dates[0] ?? plan.projectStart);
    let to = dates.reduce((m, d) => (d > m ? d : m), dates[0] ?? plan.projectStart);
    if (today < from && calendarDaysBetween(today, from) < 60) from = today;
    if (today > to && calendarDaysBetween(to, today) < 60) to = today;
    from = addCalendarDays(from, -PAD_BEFORE);
    if (zoom === 'week') from = addCalendarDays(from, -((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7));
    to = addCalendarDays(to, PAD_AFTER);
    return { from, days: calendarDaysBetween(from, to) + 1 };
  }, [rows, plan, today, zoom, baseline]);

  const x = (date: string) => calendarDaysBetween(range.from, date) * dw;
  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => addCalendarDays(range.from, i)), [range]);

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) setDrag({ ...d, days: Math.round((e.clientX - d.x) / dw) });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || d.days === 0 || !onDrag) return;
      const c = plan.computed[d.id];
      const item = plan.items.find((i) => i.key === d.id);
      if (!c || !item) return;
      if (d.mode === 'move') {
        const start = addCalendarDays(c.start, d.days);
        // A given end moves along; the duration stays.
        onDrag(d.id, item.pm.end?.src === 'set' ? { start, end: addCalendarDays(item.pm.end.v, d.days) } : { start });
      } else {
        const end = addCalendarDays(c.end, d.days);
        if (end < c.start) return;
        onDrag(d.id, { dur: Math.max(0, workBetween(c.start, end, calendar)) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // Only when a drag starts or ends.
  }, [drag === null]);

  const geometry = (id: string, c: RowPlan) => {
    const shift = drag?.id === id && drag.mode === 'move' ? drag.days : 0;
    const grow = drag?.id === id && drag.mode === 'end' ? drag.days : 0;
    if (c.milestone) return { left: x(c.start) + (shift + 1) * dw, width: 0 };
    return { left: x(c.start) + shift * dw, width: Math.max(dw, (calendarDaysBetween(c.start, c.end) + 1 + grow) * dw) };
  };

  // Arrows from the predecessor to the successor (only between rows that are shown).
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const arrows: { key: string; d: string; critical: boolean }[] = [];
  for (const [i, r] of rows.entries()) {
    if (r.kind !== 'item') continue;
    const sc = plan.computed[r.id];
    if (!sc) continue;
    for (const [pred, dep] of Object.entries(r.item.pm.deps)) {
      const j = rowIndex.get(pred);
      const pc = plan.computed[pred];
      if (j === undefined || !pc) continue;
      const pg = geometry(pred, pc);
      const sg = geometry(r.id, sc);
      const type: DepType = dep.type;
      const ax = type[0] === 'F' ? pg.left + pg.width : pg.left;
      const bx = type[1] === 'S' ? sg.left : sg.left + sg.width;
      const ay = j * ROW + ROW / 2;
      const by = i * ROW + ROW / 2;
      const out = type[0] === 'F' ? 1 : -1;
      const into = type[1] === 'S' ? -1 : 1;
      const x1 = ax + out * 8;
      const x2 = bx + into * 8;
      const fits = into === -1 ? x1 <= x2 : x1 >= x2;
      const mid = (j < i ? i : i + 1) * ROW;
      const d = fits ? `M${ax},${ay} H${x2} V${by} H${bx}` : `M${ax},${ay} H${x1} V${mid} H${x2} V${by} H${bx}`;
      arrows.push({ key: `${pred}>${r.id}`, d, critical: pc.critical && sc.critical });
    }
  }

  const width = range.days * dw;
  const months: { label: string; left: number; width: number }[] = [];
  for (const [i, d] of days.entries()) {
    const last = months.at(-1);
    const label = monthFmt.format(new Date(`${d}T00:00:00Z`));
    if (last?.label === label) last.width += dw;
    else months.push({ label, left: i * dw, width: dw });
  }
  const nameOf = new Map(plan.people.map((p) => [p.userId, p.name]));

  return (
    <div className="gantt" style={{ '--gantt-row': `${ROW}px`, '--gantt-name': `${NAME_WIDTH}px` } as CSSProperties}>
      <div className="gantt__inner" style={{ width: NAME_WIDTH + width }}>
        <div className="gantt__head">
          <div className="gantt__corner">{t('plan.col.name')}</div>
          <div className="gantt__scale" style={{ width }}>
            <div className="gantt__months">
              {months.map((m) => (
                <span key={`${m.left}`} style={{ left: m.left, width: m.width }}>
                  {m.width >= 48 ? m.label : ''}
                </span>
              ))}
            </div>
            <div className="gantt__days">
              {days.map((d, i) =>
                zoom === 'day' ? (
                  <span
                    key={d}
                    style={{ left: i * dw, width: dw }}
                    className={`${isWorkDay(d, calendar) ? '' : 'gantt__free'}${d === today ? ' gantt__today-label' : ''}`}
                  >
                    <small>{weekdayFmt.format(new Date(`${d}T00:00:00Z`))}</small>
                    {Number(d.slice(8))}
                  </span>
                ) : new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ? (
                  <span key={d} style={{ left: i * dw, width: 7 * dw }}>
                    {t('plan.weekShort', { n: isoWeek(d) })}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>

        <div className="gantt__body" style={{ height: rows.length * ROW }}>
          <div className="gantt__grid" style={{ left: NAME_WIDTH, width }} aria-hidden>
            {days.map((d, i) =>
              !isWorkDay(d, calendar) ? <span key={d} className="gantt__free" style={{ left: i * dw, width: dw }} /> : null,
            )}
            {calendarDaysBetween(range.from, today) >= 0 && calendarDaysBetween(range.from, today) < range.days && (
              <span className="gantt__today" style={{ left: x(today) + dw / 2 }} title={t('plan.today')} />
            )}
          </div>
          <svg className="gantt__arrows" style={{ left: NAME_WIDTH }} width={width} height={rows.length * ROW} aria-hidden>
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L6,3 L0,6 z" fill="context-stroke" />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path
                key={a.key}
                d={a.d}
                className={a.critical ? 'gantt__arrow gantt__arrow--critical' : 'gantt__arrow'}
                markerEnd="url(#gantt-arrow)"
              />
            ))}
          </svg>

          {rows.map((r, i) => {
            const c = plan.computed[r.id];
            const item = r.kind === 'item' ? r.item : null;
            const name = r.kind === 'subproject' ? r.sub.name : r.item.title;
            const done = !!item && item.progress >= 100;
            const conflicts = conflictTexts(t, c);
            const draggable = !!onDrag && !!item && !r.summary && !done;
            const g = c ? geometry(r.id, c) : null;
            const label = c
              ? c.milestone
                ? `${name}: ${t('plan.milestone')} ${shortDate(c.start)}`
                : `${name}: ${shortDate(c.start)} – ${shortDate(c.end)}`
              : name;
            const who = item?.assignees.map((id) => nameOf.get(id) ?? '?') ?? [];
            const title = [
              label,
              c && !c.milestone ? `${c.progress} %` : null,
              who.length ? who.join(', ') : null,
              c?.critical ? t('plan.critical') : null,
              ...conflicts,
            ]
              .filter(Boolean)
              .join('\n');
            const cls = [
              'gantt__bar',
              c?.milestone ? 'gantt__bar--milestone' : '',
              r.kind === 'subproject' ? 'gantt__bar--sub' : r.summary ? 'gantt__bar--summary' : '',
              c?.critical && !r.summary ? 'gantt__bar--critical' : '',
              done ? 'gantt__bar--done' : '',
              conflicts.length && !r.summary ? 'gantt__bar--conflict' : '',
              drag?.id === r.id ? 'gantt__bar--dragging' : '',
              draggable ? 'gantt__bar--draggable' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={r.id}
                className={`gantt__row${r.id === selected ? ' gantt__row--selected' : ''}${r.kind === 'subproject' ? ' gantt__row--sub' : ''}`}
                style={{ top: i * ROW }}
                onClick={() => onSelect(r.id)}
              >
                <div className="gantt__name" style={{ paddingLeft: 8 + r.depth * 16 }}>
                  {r.summary ? (
                    <button
                      type="button"
                      className="caret"
                      aria-expanded={!collapsed.has(r.id)}
                      aria-label={collapsed.has(r.id) ? t('plan.expand') : t('plan.collapse')}
                      onClick={(e) => (e.stopPropagation(), onToggle(r.id))}
                    >
                      {collapsed.has(r.id) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="caret-space" />
                  )}
                  <button type="button" className="gantt__name-text" aria-pressed={r.id === selected} title={name}>
                    {done ? '✓ ' : ''}
                    {name}
                  </button>
                  {conflicts.length > 0 && (
                    <span className="warn" title={conflicts.join('\n')}>
                      ⚠
                    </span>
                  )}
                </div>
                <div className="gantt__lane" style={{ width }}>
                  {baseline?.[r.id] && (
                    <span
                      className={`gantt__baseline${baseline[r.id]!.milestone ? ' gantt__baseline--milestone' : ''}`}
                      style={{
                        left: baseline[r.id]!.milestone ? x(baseline[r.id]!.start) + dw : x(baseline[r.id]!.start),
                        width: baseline[r.id]!.milestone ? 0 : (calendarDaysBetween(baseline[r.id]!.start, baseline[r.id]!.end) + 1) * dw,
                      }}
                      title={`${t('versions.baseline')}: ${shortDate(baseline[r.id]!.start)} – ${shortDate(baseline[r.id]!.end)}`}
                    />
                  )}
                  {item?.pm.deadline && (
                    <span
                      className="gantt__due"
                      style={{ left: x(item.pm.deadline) + dw }}
                      title={`${t('plan.deadline')} ${shortDate(item.pm.deadline)}`}
                    />
                  )}
                  {c && g && (
                    <div
                      className={cls}
                      style={{ left: g.left, width: g.width }}
                      role="img"
                      aria-label={label}
                      title={title}
                      onPointerDown={(e) => {
                        if (!draggable || e.button !== 0) return;
                        e.preventDefault();
                        onSelect(r.id);
                        const end = (e.target as HTMLElement).classList.contains('gantt__handle');
                        setDrag({ id: r.id, mode: end ? 'end' : 'move', x: e.clientX, days: 0 });
                      }}
                    >
                      {!c.milestone && !r.summary && c.progress > 0 && (
                        <span className="gantt__done-part" style={{ width: `${c.progress}%` }} />
                      )}
                      {draggable && !c.milestone && <span className="gantt__handle" aria-hidden />}
                      {!c.milestone && !r.summary && g.width >= 70 && <span className="gantt__bar-label">{name}</span>}
                    </div>
                  )}
                  {c && g && (c.milestone || who.length > 0) && (
                    <span className="gantt__side-label" style={{ left: g.left + g.width + (c.milestone ? 10 : 6) }}>
                      {c.milestone ? shortDate(c.start) : who.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {rows.length === 0 && <p className="muted empty-plan">{t('plan.empty')}</p>}
    </div>
  );
}
