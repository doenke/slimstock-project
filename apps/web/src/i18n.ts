import { FALLBACK_LANGUAGE, LANGUAGES, type Language } from '@spm/shared';
import de from '@spm/shared/locales/de.json';
import en from '@spm/shared/locales/en.json';
import es from '@spm/shared/locales/es.json';
import nl from '@spm/shared/locales/nl.json';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const STORAGE_KEY = 'spm:language';

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en }, nl: { translation: nl }, es: { translation: es } },
  supportedLngs: [...LANGUAGES],
  lng: FALLBACK_LANGUAGE,
  fallbackLng: [FALLBACK_LANGUAGE, 'de'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(language: Language): void {
  if (i18n.language !== language) void i18n.changeLanguage(language);
  document.documentElement.lang = language;
}

/** Language chosen before login (on this device). */
export function storedLanguage(): Language | null {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Language | null) ?? null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: Language | null): void {
  try {
    if (language) localStorage.setItem(STORAGE_KEY, language);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

export default i18n;
