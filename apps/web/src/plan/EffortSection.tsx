import { today, type PlanItem, type PlanPayload } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, del, post } from '../api';
import { ErrorText } from '../components/ui';
import { formatDate } from '../format';
import { fmtDays, parseDays, useEffortRoles } from './EffortView';

/** Effort of one task in the detail panel: plan per role, actual/remaining/forecast and bookings. */
export function EffortSection({
  plan,
  rowId,
  item,
  summary,
  onSave,
  onChanged,
}: {
  plan: PlanPayload;
  rowId: string;
  item: PlanItem | null;
  /** A phase or subproject: effort is the sum of what is inside. */
  summary: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { list, name } = useEffortRoles(plan);
  // Roles opened for input here (only roles with effort are listed otherwise).
  const [added, setAdded] = useState<string[]>([]);
  const [lastRow, setLastRow] = useState(rowId);
  if (lastRow !== rowId) {
    setLastRow(rowId);
    setAdded([]);
  }
  const effort = plan.effort;
  const e = effort?.byRow[rowId];
  if (!effort || !list.length) return null;
  const leaf = !!item && !item.pm.milestone && !summary;
  const editPlan = plan.rights.edit && !!item && leaf;
  const shown = list.filter((r) => added.includes(r.id) || e?.plan[r.id] || e?.actual[r.id] || item?.remaining[r.id]);
  const addable = list.filter((r) => !shown.includes(r));
  return (
    <section className="effort-section">
      <h3>{t('effort.effortTitle')}</h3>
      {shown.length === 0 ? (
        <p className="muted small">—</p>
      ) : (
        <table className="effort-mini">
          <thead>
            <tr>
              <th />
              <th className="num">{t('effort.plan')}</th>
              {effort.withActual && (
                <>
                  <th className="num">{t('effort.actual')}</th>
                  <th className="num">{t('effort.remaining')}</th>
                  <th className="num">{t('effort.forecast')}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className={`role-cell ${r.side}`}>{name(r.id)}</td>
                <td className="num">
                  {editPlan ? (
                    <DaysField
                      value={item!.efforts[r.id]}
                      label={`${name(r.id)} ${t('effort.plan')}`}
                      onCommit={(v) => onSave({ efforts: { [r.id]: v } })}
                    />
                  ) : (
                    fmtDays(e?.plan[r.id])
                  )}
                </td>
                {effort.withActual && (
                  <>
                    <td className="num">{fmtDays(e?.actual[r.id])}</td>
                    <td className="num">
                      {item && plan.rights.createDraft && leaf ? (
                        <DaysField
                          value={item.remaining[r.id]}
                          placeholder={fmtDays(e?.remaining[r.id]) || '0'}
                          label={`${name(r.id)} ${t('effort.remaining')}`}
                          onCommit={(v) => onSave({ remaining: { [r.id]: v } })}
                        />
                      ) : (
                        fmtDays(e?.remaining[r.id])
                      )}
                    </td>
                    <td className="num">{fmtDays(e?.forecast[r.id])}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        {item && leaf ? `${t('effort.planHint')} ${effort.withActual ? t('effort.remainingHint') : ''}` : t('effort.phaseHint')}
      </p>
      {effort.withActual && item && leaf && <Bookings plan={plan} item={item} onChanged={onChanged} />}
    </section>
  );
}

function DaysField({
  value,
  onCommit,
  label,
  placeholder,
}: {
  value: number | undefined;
  onCommit: (v: number | null) => void;
  label: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(fmtDays(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(fmtDays(value));
  }
  return (
    <input
      className="day-input"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseDays(text);
        if (v !== undefined && (v ?? null) !== (value ?? null)) onCommit(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

function Bookings({ plan, item, onChanged }: { plan: PlanPayload; item: PlanItem; onChanged: () => void }) {
  const { t } = useTranslation();
  const { list, name } = useEffortRoles(plan);
  const entries = plan.effort!.entries.filter((e) => e.itemKey === item.key);
  const canBook = plan.rights.createDraft;
  const [date, setDate] = useState(today());
  const [userId, setUserId] = useState(item.assignees[0] ?? plan.people[0]?.userId ?? '');
  const [roleId, setRoleId] = useState(Object.keys(item.efforts)[0] ?? list[0]?.id ?? '');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const book = async () => {
    const minutes = parseDays(days);
    if (!minutes) return setError('validation');
    try {
      await post(`/api/projects/${plan.project.id}/effort-entries`, { itemKey: item.key, userId, roleId, date, minutes, note });
      setDays('');
      setNote('');
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  };
  return (
    <div className="bookings">
      <h3>{t('effort.bookings')}</h3>
      {entries.length === 0 ? (
        <p className="muted small">{t('effort.noBookings')}</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              <span className="small">
                {formatDate(e.date)} · {e.userName} · {name(e.roleId)} · <strong>{fmtDays(e.minutes)}</strong>
                {e.note && <span className="muted"> – {e.note}</span>}
              </span>
              {canBook && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('effort.deleteBooking')}
                  onClick={() =>
                    window.confirm(t('effort.confirmDeleteBooking')) && void del(`/api/effort-entries/${e.id}`).then(onChanged)
                  }
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canBook && (
        <form
          className="booking-form"
          onSubmit={(e) => {
            e.preventDefault();
            void book();
          }}
        >
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('effort.date')} required />
          <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t('effort.person')} required>
            {plan.people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label={t('effort.role')} required>
            {list.map((r) => (
              <option key={r.id} value={r.id}>
                {name(r.id)}
              </option>
            ))}
          </select>
          <input
            className="day-input"
            inputMode="decimal"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder={t('effort.days')}
            aria-label={t('effort.days')}
            required
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('effort.note')}
            aria-label={t('effort.note')}
            maxLength={500}
          />
          <button className="small primary">{t('effort.addBooking')}</button>
          <ErrorText code={error} />
        </form>
      )}
      <p className="muted small">{t('effort.readOnlyBookings')}</p>
    </div>
  );
}
