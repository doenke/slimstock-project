import { ENABLED_LANGUAGES, LANGUAGE_NAMES, type Language } from '@spm/shared';
import { useTranslation } from 'react-i18next';
import { useSession } from '../session';

/** Switch the UI language at any time. Inside a project there is also "project language". */
export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const { me, projectLanguage, chooseLanguage } = useSession();
  const own = me ? me.language : null;
  const value = own ?? (projectLanguage ? 'project' : i18n.language);
  return (
    <label className="language-menu" title={t('language.label')}>
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">{t('language.label')}</span>
      <select value={value} onChange={(e) => void chooseLanguage(e.target.value === 'project' ? null : (e.target.value as Language))}>
        {projectLanguage && <option value="project">{t('language.project', { language: LANGUAGE_NAMES[projectLanguage] })}</option>}
        {ENABLED_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
