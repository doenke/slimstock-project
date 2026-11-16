import { subRowId, type PlanPayload, type PlanTarget } from '@spm/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, ErrorText, Field, Loading, PageError, useSubmit } from '../components/ui';
import { formatDate } from '../format';
import { ItemPanel } from './ItemPanel';
import { PlanGantt, type Zoom } from './PlanGantt';
import { PlanTable } from './PlanTable';
import { daysText } from './text';
import { loadSet, loadValue, saveSet, saveValue, usePlan, visibleRows } from './usePlan';
import './plan.css';

type Mode = 'gantt' | 'table';

/** The project plan of a project (on a subproject: the whole plan, filtered to that subproject). */
export function PlanView({ projectId, rootId }: { projectId: string; rootId: string }) {
  const { t } = useTranslation();
  const { plan, tree, error, notice, setNotice, run } = usePlan(projectId);
  const [mode, setMode] = useState<Mode>(() => loadValue('spm:plan-mode', ['gantt', 'table'], 'gantt'));
  const [zoom, setZoom] = useState<Zoom>(() => loadValue('spm:plan-zoom', ['day', 'week'], 'day'));
  const [collapsed, setCollapsed] = useState(() => loadSet(`spm:plan-collapsed:${rootId}`));
  const [selected, setSelected] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isSub = projectId !== rootId;
  const [wholePlan, setWholePlan] = useState(!isSub);

  const rows = useMemo(() => {
    if (!tree) return [];
    const only = isSub && !wholePlan && tree.subs.has(projectId) ? subRowId(projectId) : null;
    return visibleRows(tree.rows, collapsed, only);
  }, [tree, collapsed, isSub, wholePlan, projectId]);

  useEffect(() => {
    if (selected && tree && !tree.items.has(selected) && !(selected.startsWith('sub:') && tree.subs.has(selected.slice(4))))
      setSelected(null);
  }, [tree, selected]);

  if (error) return <PageError code={error} />;
  if (!plan || !tree) return <Loading />;
  const vid = plan.version.id;
  const edit = plan.rights.edit;

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    saveSet(`spm:plan-collapsed:${rootId}`, next);
  };
  const target = (): PlanTarget | null =>
    selected ? (selected.startsWith('sub:') ? { kind: 'subproject', id: selected.slice(4) } : { kind: 'item', key: selected }) : null;
  const anchor = (): PlanTarget | null =>
    target() ?? (isSub && !wholePlan && tree.subs.has(projectId) ? { kind: 'subproject', id: projectId } : null);

  const add = async (milestone: boolean) => {
    const title = newTitle.trim() || (milestone ? t('plan.newMilestone') : '');
    if (!title) return;
    const res = await run<{ key: string; plan: PlanPayload }>(
      'POST',
      `/api/plan-versions/${vid}/items`,
      { title, milestone, anchor: anchor() },
      (r) => r.plan,
    );
    if (res) {
      setNewTitle('');
      setSelected(res.key);
    }
  };
  const save = async (key: string, patch: Record<string, unknown>) => {
    const item = tree.items.get(key);
    if (item) await run('PATCH', `/api/plan-versions/${vid}/items/${key}`, { rev: item.rev, ...patch });
  };
  const move = (direction: 'up' | 'down' | 'indent' | 'outdent') => {
    const tg = target();
    if (tg) void run('POST', `/api/plan-versions/${vid}/move`, { target: tg, direction });
  };
  const remove = () => {
    const item = selected ? tree.items.get(selected) : undefined;
    if (!item) return;
    const inside = tree.descendants(item.key).length;
    if (
      !window.confirm(
        inside ? t('plan.confirmDeletePhase', { title: item.title, count: inside }) : t('plan.confirmDelete', { title: item.title }),
      )
    )
      return;
    void run('DELETE', `/api/plan-versions/${vid}/items/${item.key}`).then(() => setSelected(null));
  };

  const isItem = !!selected && !selected.startsWith('sub:');
  const rowActions = (
    <>
      <button type="button" className="small" onClick={() => move('up')} title={t('plan.moveUp')}>
        ↑
      </button>
      <button type="button" className="small" onClick={() => move('down')} title={t('plan.moveDown')}>
        ↓
      </button>
      {isItem && (
        <>
          <button type="button" className="small" onClick={() => move('outdent')} title={t('plan.outdent')}>
            ⇤
          </button>
          <button type="button" className="small" onClick={() => move('indent')} title={t('plan.indent')}>
            ⇥
          </button>
          <span className="spacer" />
          <button type="button" className="small danger" onClick={remove}>
            {t('plan.delete')}
          </button>
        </>
      )}
    </>
  );

  return (
    <div className="plan">
      <div className="plan-toolbar">
        <div className="segmented" role="group" aria-label={t('plan.view')}>
          {(['gantt', 'table'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? 'active' : ''}
              aria-pressed={m === mode}
              onClick={() => (setMode(m), saveValue('spm:plan-mode', m))}
            >
              {t(`plan.mode.${m}`)}
            </button>
          ))}
        </div>
        {mode === 'gantt' && (
          <div className="segmented" role="group" aria-label={t('plan.zoom')}>
            {(['day', 'week'] as const).map((z) => (
              <button
                key={z}
                type="button"
                className={z === zoom ? 'active' : ''}
                aria-pressed={z === zoom}
                onClick={() => (setZoom(z), saveValue('spm:plan-zoom', z))}
              >
                {t(`plan.zoomLevel.${z}`)}
              </button>
            ))}
          </div>
        )}
        {isSub && (
          <label className="check small">
            <input type="checkbox" checked={wholePlan} onChange={(e) => setWholePlan(e.target.checked)} />
            {t('plan.wholePlan')}
          </label>
        )}
        <span className="spacer" />
        {plan.total && (
          <span className="muted small plan-total">
            {formatDate(plan.total.start)} – {formatDate(plan.total.end)} · {daysText(t, plan.total.duration)} · {plan.total.progress} %
          </span>
        )}
        {plan.rights.editSettings && (
          <button type="button" className="small" onClick={() => setSettingsOpen(true)}>
            {t('plan.settings')}
          </button>
        )}
      </div>

      {edit && (
        <form
          className="plan-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add(false);
          }}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('plan.addPlaceholder')}
            aria-label={t('plan.addPlaceholder')}
            maxLength={300}
          />
          <button className="primary" disabled={!newTitle.trim()}>
            + {t('plan.addTask')}
          </button>
          <button type="button" onClick={() => void add(true)}>
            ◆ {t('plan.addMilestone')}
          </button>
        </form>
      )}
      {edit && <p className="muted small plan-hint">{t('plan.addHint')}</p>}
      {notice && (
        <p className="error small" role="alert">
          {t(`errors.${notice}`, { defaultValue: t('errors.internal') })}{' '}
          <button type="button" className="link" onClick={() => setNotice(null)}>
            {t('common.close')}
          </button>
        </p>
      )}

      <div className={`plan-body${selected ? ' with-panel' : ''}`}>
        <div className="plan-main">
          {mode === 'gantt' ? (
            <PlanGantt
              plan={plan}
              rows={rows}
              collapsed={collapsed}
              onToggle={toggle}
              selected={selected}
              onSelect={setSelected}
              zoom={zoom}
              onDrag={
                edit
                  ? (key, change) =>
                      void save(key, {
                        pm:
                          'dur' in change
                            ? { dur: { v: change.dur, src: 'set' }, end: null }
                            : { start: { v: change.start, src: 'set' }, ...(change.end ? { end: { v: change.end, src: 'set' } } : {}) },
                      })
                  : undefined
              }
            />
          ) : (
            <PlanTable plan={plan} rows={rows} collapsed={collapsed} onToggle={toggle} selected={selected} onSelect={setSelected} />
          )}
          {mode === 'gantt' && <p className="muted small gantt-legend">{t(edit ? 'plan.legendEdit' : 'plan.legend')}</p>}
        </div>
        {selected && (
          <ItemPanel
            plan={plan}
            tree={tree}
            rowId={selected}
            onSave={save}
            onSelect={setSelected}
            onClose={() => setSelected(null)}
            actions={rowActions}
          />
        )}
      </div>
      {settingsOpen && (
        <SettingsDialog
          plan={plan}
          projectId={projectId}
          onClose={() => setSettingsOpen(false)}
          onSaved={(p) => (run('PATCH', `/api/projects/${projectId}/plan/settings`, p), setSettingsOpen(false))}
        />
      )}
    </div>
  );
}

function SettingsDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanPayload;
  projectId: string;
  onClose: () => void;
  onSaved: (patch: Record<string, unknown>) => void;
}) {
  const { t, i18n } = useTranslation();
  const [workDays, setWorkDays] = useState(plan.settings.workDays);
  const [projectStart, setProjectStart] = useState(plan.settings.projectStart ?? '');
  const [level, setLevel] = useState(plan.settings.level);
  const { error, onSubmit, setError } = useSubmit(async () => {
    if (!workDays.length) return setError('validation');
    onSaved({ workDays, projectStart: projectStart || null, level });
  });
  const dayName = (d: number) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15 + d)));
  return (
    <Dialog title={t('plan.settings')} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <fieldset>
          <legend>{t('plan.workDays')}</legend>
          <div className="row wrap">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label key={d} className="check">
                <input
                  type="checkbox"
                  checked={workDays.includes(d)}
                  onChange={(e) => setWorkDays(e.target.checked ? [...workDays, d].sort() : workDays.filter((x) => x !== d))}
                />
                {dayName(d)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          label={t('plan.planStart')}
          hint={t('plan.planStartHint', { date: formatDate(plan.project.startDate) || t('plan.todayWord') })}
        >
          <input type="date" value={projectStart} onChange={(e) => setProjectStart(e.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={level} onChange={(e) => setLevel(e.target.checked)} />
          {t('plan.levelLabel')}
        </label>
        <p className="muted small">{t('plan.levelHint')}</p>
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary">{t('common.save')}</button>
        </div>
      </form>
    </Dialog>
  );
}
