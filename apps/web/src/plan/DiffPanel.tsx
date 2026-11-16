import { totalOf, type PlanDiff } from '@spm/shared';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../format';
import { fmtDays } from './EffortView';

const signedDays = (min: number) => (min > 0 ? `+${fmtDays(min)}` : min < 0 ? `−${fmtDays(-min)}` : '±0');
const signed = (n: number | null) => (n === null ? '' : n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/** Project end before/after and how many tasks were added, removed, changed. */
export function DiffSummary({ diff }: { diff: PlanDiff }) {
  const { t } = useTranslation();
  const count = (k: string) => diff.rows.filter((r) => r.kind === k).length;
  return (
    <p className="diff-summary">
      {diff.end.from && diff.end.to && (
        <span className={diff.end.shift && diff.end.shift > 0 ? 'later' : diff.end.shift && diff.end.shift < 0 ? 'earlier' : ''}>
          {t('diff.end', { from: formatDate(diff.end.from), to: formatDate(diff.end.to), shift: signed(diff.end.shift) })}
        </span>
      )}
      {totalOf(diff.effort.from) !== totalOf(diff.effort.to) && (
        <span className={totalOf(diff.effort.to) > totalOf(diff.effort.from) ? 'later' : 'earlier'}>
          {t('effort.changeTotal', {
            from: fmtDays(totalOf(diff.effort.from)) || '0',
            to: fmtDays(totalOf(diff.effort.to)) || '0',
            delta: signedDays(totalOf(diff.effort.to) - totalOf(diff.effort.from)),
          })}
        </span>
      )}
      <span className="muted">
        {diff.rows.length === 0
          ? t('diff.none')
          : t('diff.counts', { added: count('added'), removed: count('removed'), changed: count('changed') })}
      </span>
    </p>
  );
}

/** What changed compared to another version, row by row. */
export function DiffPanel({ diff, versionLabel, onSelect }: { diff: PlanDiff; versionLabel: string; onSelect: (key: string) => void }) {
  const { t } = useTranslation();
  return (
    <details className="diff-panel card" open>
      <summary>
        <strong>{t('diff.title', { version: versionLabel })}</strong> <DiffSummary diff={diff} />
      </summary>
      {diff.rows.length > 0 && (
        <div className="table-wrap">
          <table className="diff-table">
            <thead>
              <tr>
                <th>{t('plan.col.name')}</th>
                <th>{t('diff.change')}</th>
                <th>{t('plan.col.start')}</th>
                <th>{t('plan.col.end')}</th>
                <th className="num">{t('diff.field.effort')}</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => r.kind !== 'removed' && onSelect(r.key)}
                  className={r.kind === 'removed' ? 'removed' : 'clickable'}
                >
                  <td>
                    {r.from && r.to && r.from.title !== r.to.title ? (
                      <>
                        <s className="muted">{r.from.title}</s> {r.to.title}
                      </>
                    ) : (
                      r.title
                    )}
                  </td>
                  <td>
                    <span className={`badge diff-${r.kind}`}>{t(`diff.kind.${r.kind}`)}</span>{' '}
                    {r.fields
                      .filter((f) => f !== 'start' && f !== 'end')
                      .map((f) => (
                        <span key={f} className="chip">
                          {t(`diff.field.${f}`)}
                        </span>
                      ))}
                  </td>
                  <td>
                    {r.kind === 'changed' && r.startShift ? (
                      <span className={r.startShift > 0 ? 'later' : 'earlier'}>
                        {formatDate(r.to?.start)} ({signed(r.startShift)})
                      </span>
                    ) : (
                      formatDate((r.to ?? r.from)?.start)
                    )}
                  </td>
                  <td>
                    {r.kind === 'changed' && r.endShift ? (
                      <span className={r.endShift > 0 ? 'later' : 'earlier'}>
                        {formatDate(r.to?.end)} ({signed(r.endShift)})
                      </span>
                    ) : (
                      formatDate((r.to ?? r.from)?.end)
                    )}
                  </td>
                  <td className="num">
                    {totalOf(r.effortDelta) !== 0 && (
                      <span className={totalOf(r.effortDelta) > 0 ? 'later' : 'earlier'}>{signedDays(totalOf(r.effortDelta))}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
