import i18n from './i18n';

/** 16.11.2026 / 11/16/2026 – in the current UI language. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
