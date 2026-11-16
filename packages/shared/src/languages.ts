/** Every language the app knows. Only `ENABLED_LANGUAGES` can be chosen; the others are prepared. */
export const LANGUAGES = ['de', 'en', 'nl', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Languages with complete translations that users can pick. */
export const ENABLED_LANGUAGES: readonly Language[] = ['de', 'en'];

/** Used when nothing else decides (and for missing keys in prepared languages). */
export const FALLBACK_LANGUAGE: Language = 'en';

/** Native names, shown in the language menu regardless of the current language. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  de: 'Deutsch',
  en: 'English',
  nl: 'Nederlands',
  es: 'Español',
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** A text in several languages, e.g. the name of a project role. */
export type LocalizedText = Partial<Record<Language, string>>;

/** Picks the best translation: the wanted language, then English, then German, then anything. */
export function localized(text: LocalizedText | null | undefined, language: Language): string {
  if (!text) return '';
  return text[language] || text[FALLBACK_LANGUAGE] || text.de || Object.values(text).find(Boolean) || '';
}

/**
 * The language the UI uses: own choice → project language → browser languages → fallback.
 * Only enabled languages count.
 */
export function resolveLanguage(options: {
  own?: string | null;
  project?: string | null;
  browser?: readonly string[];
  fallback?: string | null;
}): Language {
  const candidates = [options.own, options.project, ...(options.browser ?? []).map((l) => l.slice(0, 2).toLowerCase()), options.fallback];
  for (const c of candidates) {
    if (isLanguage(c) && ENABLED_LANGUAGES.includes(c)) return c;
  }
  return FALLBACK_LANGUAGE;
}
