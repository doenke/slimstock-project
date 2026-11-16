import { FALLBACK_LANGUAGE, type Language } from '@spm/shared';
import de from '@spm/shared/locales/de.json' with { type: 'json' };
import en from '@spm/shared/locales/en.json' with { type: 'json' };
import es from '@spm/shared/locales/es.json' with { type: 'json' };
import nl from '@spm/shared/locales/nl.json' with { type: 'json' };

const files: Record<Language, unknown> = { de, en, nl, es };

const lookup = (file: unknown, key: string): string | undefined => {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), file);
  return typeof v === 'string' ? v : undefined;
};

/** Server-side texts (exports, later mails) from the same language files as the web app. */
export function translator(language: Language) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    const text = lookup(files[language], key) ?? lookup(files[FALLBACK_LANGUAGE], key) ?? lookup(files.de, key) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
  };
}
