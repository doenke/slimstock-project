import type { PlanPayload, PlanRow } from '@spm/shared';
import { useTranslation } from 'react-i18next';
import { conflictTexts, daysText, shortDate } from './text';

interface Props {
  plan: PlanPayload;
  rows: PlanRow[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}

/** The plan as a table: tree of phases and subprojects, dates, progress, links and people. */
export function PlanTable({ plan, rows, collapsed, onToggle, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const titleOf = new Map(plan.items.map((i) => [i.key, i.title]));
  const nameOf = new Map(plan.people.map((p) => [p.userId, p.name]));
  return (
    <div className="plan-table-wrap">
      <table className="plan-table">
        <thead>
          <tr>
            <th className="col-name">{t('plan.col.name')}</th>
            <th>{t('plan.col.duration')}</th>
            <th>{t('plan.col.start')}</th>
            <th>{t('plan.col.end')}</th>
            <th>{t('plan.col.progress')}</th>
            <th>{t('plan.col.predecessors')}</th>
            <th>{t('plan.col.who')}</th>
            <th>{t('plan.col.float')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = plan.computed[r.id];
            const conflicts = conflictTexts(t, c);
            const item = r.kind === 'item' ? r.item : null;
            const cls = [
              'plan-row',
              r.kind === 'subproject' ? 'is-sub' : r.summary ? 'is-summary' : '',
              r.id === selected ? 'is-selected' : '',
              c?.critical ? 'is-critical' : '',
              item && item.progress >= 100 ? 'is-done' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <tr key={r.id} className={cls} onClick={() => onSelect(r.id)} aria-selected={r.id === selected}>
                <td className="col-name">
                  <span className="plan-name" style={{ paddingLeft: r.depth * 18 }}>
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
                    {item?.pm.milestone && <span className="diamond" aria-label={t('plan.milestone')} />}
                    <span className="plan-title">{r.kind === 'subproject' ? r.sub.name : r.item.title}</span>
                    {item?.internal && <span className="badge muted">{t('plan.internal')}</span>}
                    {conflicts.length > 0 && (
                      <span className="warn" title={conflicts.join('\n')}>
                        ⚠
                      </span>
                    )}
                  </span>
                </td>
                <td className={c?.task?.durationSrc === 'calc' ? 'calc' : undefined}>
                  {c ? (c.milestone ? '◆' : daysText(t, c.duration)) : ''}
                </td>
                <td className={c?.task?.startSrc === 'calc' ? 'calc' : undefined}>{shortDate(c?.start)}</td>
                <td className={c?.task?.endSrc === 'calc' ? 'calc' : undefined}>{shortDate(c?.end)}</td>
                <td>
                  {c && (
                    <span className="progress" title={`${c.progress} %`}>
                      <span style={{ width: `${c.progress}%` }} />
                    </span>
                  )}
                </td>
                <td className="small">
                  {item &&
                    Object.keys(item.pm.deps)
                      .map((k) => titleOf.get(k))
                      .filter(Boolean)
                      .join(', ')}
                </td>
                <td className="small">{item?.assignees.map((id) => nameOf.get(id) ?? '?').join(', ')}</td>
                <td className="small">
                  {c?.task && !c.milestone && c.task.float > 0
                    ? daysText(t, c.task.float)
                    : c?.task && c.task.float < 0
                      ? `−${daysText(t, -c.task.float)}`
                      : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted empty-plan">{t('plan.empty')}</p>}
    </div>
  );
}
