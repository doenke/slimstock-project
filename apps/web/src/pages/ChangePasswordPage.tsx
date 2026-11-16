import type { Me } from '@spm/shared';
import { useTranslation } from 'react-i18next';
import { get } from '../api';
import { LanguageMenu } from '../components/LanguageMenu';
import { useSession } from '../session';
import { PasswordForm } from './PasswordForm';

/** Shown after the first login (or a reset) until the start password is replaced. */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { setMe, logout } = useSession();
  return (
    <div className="login">
      <div className="login-lang">
        <LanguageMenu />
      </div>
      <div className="card login-card">
        <h1>{t('password.firstTitle')}</h1>
        <p className="muted">{t('password.firstIntro')}</p>
        <PasswordForm onDone={() => void get<Me>('/api/me').then(setMe)} />
        <button type="button" className="link" onClick={() => void logout()}>
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}
