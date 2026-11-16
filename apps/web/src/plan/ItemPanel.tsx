import {
  allowedDepTypes,
  daysToMinutes,
  minutesToDays,
  type DepType,
  type PlanItem,
  type PlanPayload,
  type PlanTree,
  type PmDep,
} from '@spm/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../format';
import { Link } from '../router';
import { Comments } from './Comments';
import { EffortSection } from './EffortSection';
import { conflictTexts, daysText } from './text';

interface Props {
  plan: PlanPayload;
  tree: PlanTree;
  rowId: string;
  onSave: (key: string, patch: Record<string, unknown>) => Promise<void>;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Bookings changed: reload the plan. */
  onChanged: () => void;
  actions: ReactNode;
}

/** A text/number input that saves on blur or Enter (and shows outside changes). */
function CommitInput({
  value,
  onCommit,
  className,
  ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) onCommit(v);
  };
  return (
    <input
      {...rest}
      className={className}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(value);
      }}
    />
  );
}

const DEP_TYPES: DepType[] = ['FS', 'SS', 'FF', 'SF'];

/** Details of the selected row: edit a task (or phase), or see a subproject's summary. */
export function ItemPanel({ plan, tree, rowId, onSave, onSelect, onClose, onChanged, actions }: Props) {
  const { t } = useTranslation();
  const c = plan.computed[rowId];
  const edit = plan.rights.edit;

  if (rowId.startsWith('sub:')) {
    const sub = tree.subs.get(rowId.slice(4));
    if (!sub) return null;
    return (
      <aside className="plan-panel" aria-label={sub.name}>
        <header>
          <h2>{sub.name}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>
        <p className="muted small">{t('plan.subprojectRow')}</p>
        <Summary c={c} />
        <EffortSection plan={plan} rowId={rowId} item={null} summary onSave={() => {}} onChanged={onChanged} />
        <p>
          <Link to={`/projects/${sub.id}`}>{t('plan.openSubproject')}</Link>
        </p>
        {edit && <div className="panel-actions">{actions}</div>}
      </aside>
    );
  }

  const item = tree.items.get(rowId);
  if (!item) return null;
  const summary = tree.isSummary(item.key);
  const save = (patch: Record<string, unknown>) => onSave(item.key, patch);
  const pm = (patch: Record<string, unknown>) => save({ pm: patch });
  const task = c?.task;

  return (
    <aside className="plan-panel" aria-label={item.title}>
      <header>
        <h2 className={edit ? 'sr-only' : 'panel-title'}>{item.title}</h2>
        {edit && (
          <CommitInput
            className="title-input"
            value={item.title}
            onCommit={(v) => v.trim() && save({ title: v.trim() })}
            disabled={!edit}
            aria-label={t('plan.col.name')}
            maxLength={300}
          />
        )}
        <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </header>

      {conflictTexts(t, c).map((txt) => (
        <p key={txt} className="error small">
          ⚠ {txt}
        </p>
      ))}

      {summary ? (
        <>
          <p className="muted small">{t('plan.phaseHint')}</p>
          <Summary c={c} />
        </>
      ) : !edit ? (
        <ReadOnlyFacts plan={plan} item={item} />
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={!!item.pm.milestone} disabled={!edit} onChange={(e) => pm({ milestone: e.target.checked })} />
            {t('plan.milestone')}
          </label>
          <div className="panel-grid">
            {!item.pm.milestone && (
              <DateOrDays
                label={t('plan.col.duration')}
                calc={task?.durationSrc !== 'set'}
                onReset={item.pm.dur ? () => pm({ dur: null }) : undefined}
              >
                <CommitInput
                  type="number"
                  min={0}
                  step={0.25}
                  value={c ? String(minutesToDays(c.duration)) : ''}
                  disabled={!edit || (item.pm.start?.src === 'set' && item.pm.end?.src === 'set')}
                  onCommit={(v) => v !== '' && pm({ dur: { v: daysToMinutes(Math.max(0, Number(v))), src: 'set' }, end: null })}
                />
              </DateOrDays>
            )}
            <DateOrDays
              label={t('plan.col.start')}
              calc={item.pm.start?.src !== 'set'}
              onReset={item.pm.start ? () => pm({ start: null }) : undefined}
            >
              <CommitInput
                type="date"
                value={c?.start ?? ''}
                disabled={!edit}
                onCommit={(v) => pm({ start: v ? { v, src: 'set' } : null })}
              />
            </DateOrDays>
            {!item.pm.milestone && (
              <DateOrDays
                label={t('plan.col.end')}
                calc={item.pm.end?.src !== 'set'}
                onReset={item.pm.end ? () => pm({ end: null }) : undefined}
              >
                <CommitInput
                  type="date"
                  value={c?.end ?? ''}
                  disabled={!edit}
                  onCommit={(v) => pm({ end: v ? { v, src: 'set' } : null })}
                />
              </DateOrDays>
            )}
            <DateOrDays label={t('plan.notBefore')} onReset={item.pm.notBefore ? () => pm({ notBefore: null }) : undefined}>
              <CommitInput type="date" value={item.pm.notBefore ?? ''} disabled={!edit} onCommit={(v) => pm({ notBefore: v || null })} />
            </DateOrDays>
            <DateOrDays label={t('plan.deadline')} onReset={item.pm.deadline ? () => pm({ deadline: null }) : undefined}>
              <CommitInput type="date" value={item.pm.deadline ?? ''} disabled={!edit} onCommit={(v) => pm({ deadline: v || null })} />
            </DateOrDays>
          </div>
          <p className="muted small">{t('plan.calcHint')}</p>

          <h3>{t('plan.progressTitle')}</h3>
          <div className="panel-grid">
            <label className="field">
              <span className="label">{t('plan.col.progress')}</span>
              <span className="row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={item.progress}
                  disabled={!edit}
                  onChange={(e) => save({ progress: Number(e.target.value) })}
                  aria-label={t('plan.col.progress')}
                />
                <span className="pct">{item.progress} %</span>
              </span>
            </label>
            <label className="field">
              <span className="label">{t('plan.actualStart')}</span>
              <CommitInput type="date" value={item.actualStart ?? ''} disabled={!edit} onCommit={(v) => save({ actualStart: v || null })} />
            </label>
            <label className="field">
              <span className="label">{t('plan.actualEnd')}</span>
              <CommitInput type="date" value={item.actualEnd ?? ''} disabled={!edit} onCommit={(v) => save({ actualEnd: v || null })} />
            </label>
          </div>

          <h3>{t('plan.col.who')}</h3>
          <div className="people">
            {plan.people.map((p) => (
              <label key={p.userId} className="check">
                <input
                  type="checkbox"
                  checked={item.assignees.includes(p.userId)}
                  disabled={!edit}
                  onChange={(e) =>
                    save({ assignees: e.target.checked ? [...item.assignees, p.userId] : item.assignees.filter((x) => x !== p.userId) })
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </>
      )}

      <EffortSection plan={plan} rowId={rowId} item={item} summary={summary} onSave={save} onChanged={onChanged} />

      <Links plan={plan} tree={tree} item={item} edit={edit} onSave={(deps) => pm({ deps })} onSelect={onSelect} />

      {task && !item.pm.milestone && (
        <dl className="facts small">
          <dt>{t('plan.early')}</dt>
          <dd>
            {formatDate(task.earlyStart)} – {formatDate(task.earlyEnd)}
          </dd>
          <dt>{t('plan.late')}</dt>
          <dd>
            {formatDate(task.lateStart)} – {formatDate(task.lateEnd)}
          </dd>
          <dt>{t('plan.col.float')}</dt>
          <dd>
            {task.float < 0 ? '−' : ''}
            {daysText(t, Math.abs(task.float))}
            {c?.critical ? ` · ${t('plan.critical')}` : ''}
          </dd>
          {task.waitsFor && (
            <>
              <dt>{t('plan.waitsFor')}</dt>
              <dd>{tree.items.get(task.waitsFor.id)?.title}</dd>
            </>
          )}
        </dl>
      )}

      {plan.rights.createDraft && (
        <label className="check">
          <input type="checkbox" checked={item.internal} disabled={!edit} onChange={(e) => save({ internal: e.target.checked })} />
          {t('plan.internalLabel')}
        </label>
      )}

      <section>
        <h3>{t('comments.title')}</h3>
        <Comments plan={plan} itemKey={item.key} onChanged={onChanged} />
      </section>

      {edit && <div className="panel-actions">{actions}</div>}
    </aside>
  );
}

function Summary({ c }: { c: PlanPayload['computed'][string] | undefined }) {
  const { t } = useTranslation();
  if (!c) return <p className="muted">{t('plan.noTasksInside')}</p>;
  return (
    <dl className="facts">
      <dt>{t('project.period')}</dt>
      <dd>
        {formatDate(c.start)} – {formatDate(c.end)}
      </dd>
      <dt>{t('plan.col.duration')}</dt>
      <dd>{daysText(t, c.duration)}</dd>
      <dt>{t('plan.col.progress')}</dt>
      <dd>{c.progress} %</dd>
    </dl>
  );
}

function DateOrDays({ label, calc, onReset, children }: { label: string; calc?: boolean; onReset?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <label className={`field${calc ? ' is-calc' : ''}`}>
      <span className="label">
        {label}
        {onReset && (
          <button
            type="button"
            className="reset"
            onClick={(e) => (e.preventDefault(), onReset())}
            title={t('plan.reset')}
            aria-label={`${label}: ${t('plan.reset')}`}
          >
            ↺
          </button>
        )}
      </span>
      {children}
    </label>
  );
}

/** Predecessors (editable) and successors (derived) of an item. */
function Links({
  plan,
  tree,
  item,
  edit,
  onSave,
  onSelect,
}: {
  plan: PlanPayload;
  tree: PlanTree;
  item: PlanItem;
  edit: boolean;
  onSave: (deps: Record<string, PmDep>) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState('');
  const deps = item.pm.deps;
  const family = new Set([item.key, ...tree.ancestors(item.key), ...tree.descendants(item.key).map((d) => d.key)]);
  const candidates = plan.items.filter((i) => !family.has(i.key) && !deps[i.key]);
  const successors = plan.items.filter((i) => i.pm.deps[item.key]);
  const set = (key: string, dep: PmDep | null) => {
    const next = { ...deps };
    if (dep) next[key] = dep;
    else delete next[key];
    onSave(next);
  };
  return (
    <section className="links">
      <h3>{t('plan.col.predecessors')}</h3>
      {Object.keys(deps).length === 0 && <p className="muted small">{t('plan.noPredecessors')}</p>}
      <ul>
        {Object.entries(deps).map(([key, dep]) => {
          const pred = tree.items.get(key);
          if (!pred) return null;
          const types = allowedDepTypes(tree, key, item.key);
          return (
            <li key={key}>
              <button type="button" className="link" onClick={() => onSelect(key)}>
                {pred.title}
              </button>
              {!edit ? (
                <span className="muted small">
                  {t(`plan.dep.${dep.type}`)}
                  {dep.lag ? ` ${dep.lag > 0 ? '+' : ''}${minutesToDays(dep.lag)}` : ''}
                </span>
              ) : (
                <select
                  value={dep.type}
                  disabled={!edit || types.length === 1}
                  onChange={(e) => set(key, { ...dep, type: e.target.value as DepType })}
                  aria-label={t('plan.linkType')}
                >
                  {DEP_TYPES.filter((d) => types.includes(d)).map((d) => (
                    <option key={d} value={d}>
                      {t(`plan.dep.${d}`)}
                    </option>
                  ))}
                </select>
              )}
              {edit && (
                <CommitInput
                  type="number"
                  step={0.5}
                  className="lag"
                  value={String(minutesToDays(dep.lag))}
                  onCommit={(v) => set(key, { ...dep, lag: daysToMinutes(Number(v) || 0) })}
                  aria-label={t('plan.lag')}
                  title={t('plan.lagHint')}
                />
              )}
              {edit && (
                <button type="button" className="icon-button" onClick={() => set(key, null)} aria-label={t('plan.removeLink')}>
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {edit && candidates.length > 0 && (
        <select
          value={adding}
          onChange={(e) => {
            setAdding('');
            if (e.target.value) set(e.target.value, { type: 'FS', lag: 0 });
          }}
          aria-label={t('plan.addPredecessor')}
        >
          <option value="">+ {t('plan.addPredecessor')}</option>
          {candidates.map((i) => (
            <option key={i.key} value={i.key}>
              {i.title}
            </option>
          ))}
        </select>
      )}
      {successors.length > 0 && (
        <>
          <h3>{t('plan.successors')}</h3>
          <ul>
            {successors.map((s) => (
              <li key={s.key}>
                <button type="button" className="link" onClick={() => onSelect(s.key)}>
                  {s.title}
                </button>
                <span className="muted small">{t(`plan.dep.${s.pm.deps[item.key]!.type}`)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The task for people who only read: plain facts instead of locked form fields. */
function ReadOnlyFacts({ plan, item }: { plan: PlanPayload; item: PlanItem }) {
  const { t } = useTranslation();
  const c = plan.computed[item.key];
  const who = item.assignees.map((id) => plan.people.find((p) => p.userId === id)?.name ?? '?');
  return (
    <dl className="facts">
      {c && (
        <>
          <dt>{item.pm.milestone ? t('plan.milestone') : t('project.period')}</dt>
          <dd>{item.pm.milestone ? formatDate(c.start) : `${formatDate(c.start)} – ${formatDate(c.end)}`}</dd>
          {!item.pm.milestone && (
            <>
              <dt>{t('plan.col.duration')}</dt>
              <dd>{daysText(t, c.duration)}</dd>
            </>
          )}
        </>
      )}
      {item.pm.deadline && (
        <>
          <dt>{t('plan.deadline')}</dt>
          <dd>{formatDate(item.pm.deadline)}</dd>
        </>
      )}
      <dt>{t('plan.col.progress')}</dt>
      <dd>
        <span className="progress">
          <span style={{ width: `${item.progress}%` }} />
        </span>{' '}
        {item.progress} %
      </dd>
      {(item.actualStart || item.actualEnd) && (
        <>
          <dt>{t('plan.actualStart')}</dt>
          <dd>
            {formatDate(item.actualStart) || '–'} {item.actualEnd && `– ${formatDate(item.actualEnd)}`}
          </dd>
        </>
      )}
      {who.length > 0 && (
        <>
          <dt>{t('plan.col.who')}</dt>
          <dd>{who.join(', ')}</dd>
        </>
      )}
    </dl>
  );
}
