import { PASSWORD_MIN_LENGTH } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../api';
import { ErrorText, Field, useSubmit } from '../components/ui';

export function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const { busy, error, onSubmit, setError } = useSubmit(async () => {
    if (password !== repeat) return setError('password_mismatch');
    await post('/api/me/password', { current, password });
    setCurrent('');
    setPassword('');
    setRepeat('');
    onDone();
  });
  return (
    <form className="stack" onSubmit={onSubmit}>
      <Field label={t('password.current')}>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </Field>
      <Field label={t('password.new')} hint={t('password.rule', { min: PASSWORD_MIN_LENGTH })}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </Field>
      <Field label={t('password.repeat')}>
        <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
      </Field>
      <ErrorText code={error} />
      <div>
        <button className="primary" disabled={busy}>
          {t('password.save')}
        </button>
      </div>
    </form>
  );
}
