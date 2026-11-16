import type { AuditRow } from '@spm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, get } from '../api';
import { Avatar, Loading, PageError } from '../components/ui';
import { formatDate, formatDateTime } from '../format';
import { fmtDays } from '../plan/EffortView';

type Area = 'all' | 'project' | 'plan' | 'tasks';

/** The change log of a project: who changed what when (customers see only shared things). */
export function AuditView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [area, setArea] = useState<Area>('all');
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: string) => {
    try {
      const q = new URLSearchParams();
      if (area !== 'all') q.set('area', area);
      if (before) q.set('before', before);
      const page = await get<AuditRow[]>(`/api/projects/${projectId}/audit?${q}`);
      setRows((r) => (before && r ? [...r, ...page] : page));
      setMore(page.length === 100);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  };
  useEffect(() => {
    setRows(null);
    void load();
  }, [projectId, area]);

  if (error) return <PageError code={error} />;
  const text = (r: AuditRow) => {
    const d = r.details as Record<string, unknown>;
    const fields =
      Array.isArray(d.fields) && d.fields.length
        ? ` (${(d.fields as string[]).map((f) => t(`audit.field.${f}`, { defaultValue: f })).join(', ')})`
        : '';
    const extra =
      r.action === 'effort.booked' && typeof d.minutes === 'number'
        ? ` – ${fmtDays(d.minutes)} ${t('effort.days')} (${formatDate(String(d.date))})`
        : r.action === 'effort.billing'
          ? ` – ${t(`effort.billing.${String(d.billing)}`)}`
          : '';
    // Plan changes name the version they happened in (version actions say it in their text).
    const version = d.version && !r.action.startsWith('version.') ? ` · ${String(d.version)}` : '';
    return `${t(`audit.action.${r.action.replace(/\./g, '_')}`, { ...d, defaultValue: r.action })}${fields}${extra}${version}`;
  };
  // Grouped by day.
  const days: { day: string; rows: AuditRow[] }[] = [];
  for (const r of rows ?? []) {
    const day = r.at.slice(0, 10);
    const last = days.at(-1);
    if (last?.day === day) last.rows.push(r);
    else days.push({ day, rows: [r] });
  }
  return (
    <div className="audit">
      <div className="plan-toolbar">
        <div className="segmented" role="group" aria-label={t('audit.title')}>
          {(['all', 'project', 'plan', 'tasks'] as const).map((a) => (
            <button key={a} type="button" className={a === area ? 'active' : ''} aria-pressed={a === area} onClick={() => setArea(a)}>
              {t(`audit.area.${a}`)}
            </button>
          ))}
        </div>
        <span className="muted small">{t('audit.intro')}</span>
      </div>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>{t('audit.empty')}</p>
        </div>
      ) : (
        <>
          {days.map((d) => (
            <section key={d.day} className="card audit-day">
              <h2>{formatDate(d.day)}</h2>
              <ul>
                {d.rows.map((r) => (
                  <li key={r.id}>
                    <Avatar name={r.userName ?? '?'} kind={r.userKind ?? undefined} />
                    <div>
                      <strong>{r.userName ?? t('audit.someone')}</strong> {text(r)}
                      <div className="muted small">{formatDateTime(r.at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && (
            <button type="button" onClick={() => void load(rows.at(-1)!.at)}>
              {t('audit.more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
