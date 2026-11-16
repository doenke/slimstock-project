import type { Me } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../api';
import { LanguageMenu } from '../components/LanguageMenu';
import { ErrorText, Field, useSubmit } from '../components/ui';
import { useSession } from '../session';

export function LoginPage() {
  const { t } = useTranslation();
  const { setMe, config } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    setMe(await post<Me>('/api/auth/login', { username, password }));
  });
  return (
    <div className="login">
      <div className="login-lang">
        <LanguageMenu />
      </div>
      <form className="card login-card" onSubmit={onSubmit}>
        <img src="/icon.svg" alt="" width="56" height="56" />
        <h1>{t('app.name')}</h1>
        <p className="muted">{t('login.intro')}</p>
        <Field label={t('login.username')}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label={t('login.password')}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorText code={error} />
        <button className="primary" disabled={busy}>
          {t('login.submit')}
        </button>
        <p className="muted small">{t('login.customerHint')}</p>
      </form>
      <p className="muted small center">{t('app.version', { version: config.version })}</p>
    </div>
  );
}
