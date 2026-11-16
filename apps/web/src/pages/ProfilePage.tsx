import type { Me } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch } from '../api';
import { ErrorText, Field, useSubmit } from '../components/ui';
import { useMe, useSession } from '../session';
import { PasswordForm } from './PasswordForm';

export function ProfilePage() {
  const { t } = useTranslation();
  const me = useMe();
  const { setMe, config } = useSession();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? '');
  const [saved, setSaved] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setMe(await patch<Me>('/api/me', { name, email }));
    setSaved(true);
  });
  return (
    <div className="page narrow">
      <h1>{t('profile.title')}</h1>
      <section className="card">
        <form className="stack" onSubmit={onSubmit}>
          {me.kind === 'staff' && (
            <Field label={t('login.username')}>
              <input value={me.username ?? ''} disabled />
            </Field>
          )}
          <Field label={t('profile.name')}>
            <input value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} required />
          </Field>
          <Field label={t('profile.email')}>
            <input type="email" value={email} onChange={(e) => (setEmail(e.target.value), setSaved(false))} />
          </Field>
          <ErrorText code={error} />
          <div className="row">
            <button className="primary" disabled={busy}>
              {t('common.save')}
            </button>
            {saved && <span className="success">{t('common.saved')}</span>}
          </div>
        </form>
      </section>
      <section className="card">
        <label className="check">
          <input
            type="checkbox"
            checked={me.notify}
            disabled={!config.mail}
            onChange={async (e) => setMe(await patch<Me>('/api/me', { notify: e.target.checked }))}
          />
          {t('profile.notify')}
        </label>
        {!config.mail && <p className="muted small">{t('profile.notifyOff')}</p>}
      </section>
      {me.kind === 'staff' && (
        <section className="card">
          <h2>{t('password.title')}</h2>
          <PasswordForm onDone={() => setPasswordSaved(true)} />
          {passwordSaved && <p className="success">{t('password.changed')}</p>}
        </section>
      )}
    </div>
  );
}
