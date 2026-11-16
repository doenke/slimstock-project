import {
  daysToMinutes,
  localized,
  minutesToDays,
  totalOf,
  type EffortRow,
  type Language,
  type PlanPayload,
  type PlanRow,
  type Role,
  type UnitBudget,
} from '@spm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useSession } from '../session';

/** Days with up to two decimals in the UI language; empty for 0. */
export function fmtDays(min: number | undefined): string {
  if (!min) return '';
  return new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(minutesToDays(min));
}

/** Parses "1,5" or "1.5" (days) into minutes; empty = null. */
export function parseDays(text: string): number | null | undefined {
  const s = text.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return daysToMinutes(Math.round(n * 4) / 4);
}

export function useEffortRoles(plan: PlanPayload) {
  const { roles } = useSession();
  const { i18n: inst } = useTranslation();
  const byId = new Map(roles.map((r) => [r.id, r]));
  const ids = plan.effort?.roleIds ?? [];
  const list = ids.map((id) => byId.get(id)).filter((r): r is Role => !!r);
  const slimstock = new Set(list.filter((r) => r.side === 'slimstock').map((r) => r.id));
  const customer = new Set(list.filter((r) => r.side === 'customer').map((r) => r.id));
  return { list, slimstock, customer, name: (id: string) => localized(byId.get(id)?.names, inst.language as Language) };
}

/** A day cell that saves on blur/Enter. */
function DayInput({ value, onCommit, label }: { value: number | undefined; onCommit: (min: number | null) => void; label: string }) {
  const [text, setText] = useState(fmtDays(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(fmtDays(value)), [value]);
  const commit = () => {
    const v = parseDays(text);
    if (v === undefined) return setBad(true);
    setBad(false);
    if ((v ?? 0) !== (value ?? 0)) onCommit(v);
  };
  return (
    <input
      className={`day-input${bad ? ' bad' : ''}`}
      inputMode="decimal"
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(fmtDays(value));
      }}
    />
  );
}

export type EffortMode = 'plan' | 'actual';

/** The estimate as a table: days per role and task, sums per phase, subproject and project. */
export function EffortTable({
  plan,
  rows,
  collapsed,
  onToggle,
  selected,
  onSelect,
  mode,
  onSave,
}: {
  plan: PlanPayload;
  rows: PlanRow[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  mode: EffortMode;
  onSave: (key: string, patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const { list, slimstock, customer, name } = useEffortRoles(plan);
  const effort = plan.effort!;
  if (!list.length) return <p className="muted">{t('effort.noRoles')}</p>;
  const sides = [
    { key: 'slimstock', label: t('side.slimstock'), ids: slimstock },
    { key: 'customer', label: t('side.customer'), ids: customer },
  ].filter((s) => s.ids.size);
  const cellsFor = (e: EffortRow | undefined, editable: boolean, key: string) =>
    mode === 'plan' ? (
      <>
        {list.map((r) => (
          <td key={r.id} className={`num ${r.side}`}>
            {editable ? (
              <DayInput value={e?.plan[r.id]} label={`${name(r.id)}`} onCommit={(v) => onSave(key, { efforts: { [r.id]: v } })} />
            ) : (
              fmtDays(e?.plan[r.id])
            )}
          </td>
        ))}
        {sides.map((s) => (
          <td key={s.key} className="num sum">
            {fmtDays(e && totalOf(e.plan, s.ids))}
          </td>
        ))}
      </>
    ) : (
      sides.map((s) => {
        const p = e ? totalOf(e.plan, s.ids) : 0;
        const f = e ? totalOf(e.forecast, s.ids) : 0;
        return [
          <td key={`${s.key}p`} className="num">
            {fmtDays(p)}
          </td>,
          <td key={`${s.key}a`} className="num">
            {fmtDays(e && totalOf(e.actual, s.ids))}
          </td>,
          <td key={`${s.key}r`} className="num">
            {fmtDays(e && totalOf(e.remaining, s.ids))}
          </td>,
          <td key={`${s.key}f`} className={`num sum${f > p ? ' over' : ''}`}>
            {fmtDays(f)}
          </td>,
        ];
      })
    );
  return (
    <div className="plan-table-wrap">
      <table className="plan-table effort-table">
        <thead>
          <tr>
            <th rowSpan={2} className="col-name">
              {t('plan.col.name')}
            </th>
            {mode === 'plan'
              ? sides.map((s) => (
                  <th key={s.key} colSpan={s.ids.size} className={`group ${s.key}`}>
                    {s.label}
                  </th>
                ))
              : null}
            {mode === 'plan' ? (
              <th colSpan={sides.length} className="group">
                Σ
              </th>
            ) : (
              sides.map((s) => (
                <th key={s.key} colSpan={4} className={`group ${s.key}`}>
                  {s.label}
                </th>
              ))
            )}
          </tr>
          <tr>
            {mode === 'plan' ? (
              <>
                {list.map((r) => (
                  <th key={r.id} className="num role-head" title={name(r.id)}>
                    {name(r.id)}
                  </th>
                ))}
                {sides.map((s) => (
                  <th key={s.key} className="num">
                    {s.label}
                  </th>
                ))}
              </>
            ) : (
              sides.map((s) =>
                ['plan', 'actual', 'remaining', 'forecast'].map((k) => (
                  <th key={s.key + k} className="num">
                    {t(`effort.${k}`)}
                  </th>
                )),
              )
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const e = effort.byRow[r.id];
            const editable = mode === 'plan' && plan.rights.edit && r.kind === 'item' && !r.summary && !r.item.pm.milestone;
            return (
              <tr
                key={r.id}
                className={[
                  'plan-row',
                  r.kind === 'subproject' ? 'is-sub' : r.summary ? 'is-summary' : '',
                  r.id === selected ? 'is-selected' : '',
                ].join(' ')}
                onClick={() => onSelect(r.id)}
              >
                <td className="col-name">
                  <span className="plan-name" style={{ paddingLeft: r.depth * 18 }}>
                    {r.summary ? (
                      <button
                        type="button"
                        className="caret"
                        aria-expanded={!collapsed.has(r.id)}
                        onClick={(ev) => (ev.stopPropagation(), onToggle(r.id))}
                      >
                        {collapsed.has(r.id) ? '▸' : '▾'}
                      </button>
                    ) : (
                      <span className="caret-space" />
                    )}
                    <span className="plan-title">{r.kind === 'subproject' ? r.sub.name : r.item.title}</span>
                  </span>
                </td>
                {cellsFor(e, editable, r.id)}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="total-row">
            <td>{t('effort.total')}</td>
            {cellsFor(effort.total, false, '')}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Budget, plan, actual and forecast per subproject (Slimstock days), with billing. */
export function BudgetPanel({ plan, onBilling }: { plan: PlanPayload; onBilling: (unitId: string, billing: 'tm' | 'fixed') => void }) {
  const { t } = useTranslation();
  const budgets = plan.effort?.budgets ?? [];
  if (!budgets.length) return null;
  const nameOf = (u: UnitBudget) =>
    u.unitId === plan.project.id ? t('effort.projectLevel') : (plan.subprojects.find((s) => s.id === u.unitId)?.name ?? '?');
  const canBill = plan.rights.manageVersions && plan.rights.edit;
  return (
    <section className="card budget-panel">
      <h2>{t('effort.budgetTitle')}</h2>
      <div className="table-wrap">
        <table className="budget-table">
          <thead>
            <tr>
              <th />
              <th>{t('effort.billingLabel')}</th>
              <th className="num">{t('effort.budget')}</th>
              <th className="num">{t('effort.plan')}</th>
              <th className="num">{t('effort.actual')}</th>
              <th className="num">{t('effort.remaining')}</th>
              <th className="num">{t('effort.forecast')}</th>
              <th className="num">{t('effort.deviation')}</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((u) => (
              <tr key={u.unitId}>
                <td>{nameOf(u)}</td>
                <td>
                  {canBill ? (
                    <select
                      value={u.billing}
                      onChange={(e) => onBilling(u.unitId, e.target.value as 'tm' | 'fixed')}
                      aria-label={t('effort.billingLabel')}
                    >
                      <option value="tm">{t('effort.billing.tm')}</option>
                      <option value="fixed">{t('effort.billing.fixed')}</option>
                    </select>
                  ) : (
                    t(`effort.billing.${u.billing}`)
                  )}
                  {u.pending && <div className="muted small">{t('effort.pending')}</div>}
                </td>
                <td className="num">{fmtDays(u.budget) || '0'}</td>
                <td className="num">{fmtDays(u.plan) || '0'}</td>
                <td className="num">{fmtDays(u.actual) || '0'}</td>
                <td className="num">{fmtDays(u.remaining) || '0'}</td>
                <td className="num">{fmtDays(u.forecast) || '0'}</td>
                <td className="num">
                  <span className={`budget-level level-${u.level}`} title={t(`effort.level.${u.level}`)}>
                    {u.deviation > 0 ? '+' : u.deviation < 0 ? '−' : '±'}
                    {fmtDays(Math.abs(u.deviation)) || '0'}
                    {u.deviationPct !== null && ` (${u.deviationPct > 0 ? '+' : ''}${u.deviationPct} %)`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {budgets.some((b) => b.billing === 'fixed') && <p className="muted small">{t('effort.fixedHint')}</p>}
    </section>
  );
}
