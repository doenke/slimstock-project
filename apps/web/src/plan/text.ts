import { minutesToDays, type PmConflict, type RowPlan } from '@spm/shared';
import type { TFunction } from 'i18next';
import i18n from '../i18n';

/** "3 days" / "0.5 days" in the UI language. */
export function daysText(t: TFunction, minutes: number): string {
  const d = minutesToDays(minutes);
  return t('plan.days', { count: d, value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(d) });
}

/** Short date (16.11. / 11/16) for dense columns. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(`${iso}T00:00:00`));
}

export function conflictTexts(t: TFunction, plan: RowPlan | undefined): string[] {
  return (plan?.conflicts ?? []).map((c: PmConflict) => t(`plan.conflict.${c}`));
}
