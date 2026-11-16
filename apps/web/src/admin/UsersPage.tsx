import { PASSWORD_MIN_LENGTH, type UserRow } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '../api';
import { AdminTabs } from '../components/Layout';
import { Avatar, Dialog, ErrorText, Field, Loading, PageError, useLoad, useSubmit } from '../components/ui';
import { formatDateTime } from '../format';
import { useMe } from '../session';

export function UsersPage() {
  const { t } = useTranslation();
  const me = useMe();
  const { data, error, reload } = useLoad(() => get<UserRow[]>('/api/admin/users'), []);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  if (error) return <PageError code={error} />;
  return (
    <div className="page">
      <h1>{t('nav.admin')}</h1>
      <AdminTabs />
      <div className="section-head">
        <p className="muted">{t('admin.usersIntro')}</p>
        <button className="primary" onClick={() => setEditing('new')}>
          + {t('admin.newUser')}
        </button>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>{t('profile.name')}</th>
                <th>{t('login.username')}</th>
                <th>{t('profile.email')}</th>
                <th>{t('admin.lastSeen')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className={u.active ? undefined : 'inactive'}>
                  <td>
                    <span className="row">
                      <Avatar name={u.name} kind="staff" />
                      {u.name}
                      {u.isAdmin && <span className="badge">{t('admin.isAdmin')}</span>}
                      {!u.active && <span className="badge muted">{t('admin.inactive')}</span>}
                    </span>
                  </td>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td className="muted small">{formatDateTime(u.lastSeenAt) || '—'}</td>
                  <td className="actions-cell">
                    <button className="small" onClick={() => setEditing(u)}>
                      {t('common.edit')}
                    </button>
                    <button className="small" onClick={() => setResetting(u)} disabled={u.id === me.id}>
                      {t('admin.resetPassword')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          self={editing !== 'new' && editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), void reload())}
        />
      )}
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function UserDialog({ user, self, onClose, onSaved }: { user: UserRow | null; self: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(user?.username ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [isAdmin, setIsAdmin] = useState(user?.isAdmin ?? false);
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (user) await patch(`/api/admin/users/${user.id}`, { name, email, isAdmin, active });
    else await post('/api/admin/users', { username, name, email, isAdmin, password });
    onSaved();
  });
  return (
    <Dialog title={user ? user.name : t('admin.newUser')} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t('login.username')} hint={user ? undefined : t('admin.usernameHint')}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={!!user}
            required
            pattern="[A-Za-z0-9._\-]{2,50}"
          />
        </Field>
        <Field label={t('profile.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('profile.email')}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {!user && (
          <Field label={t('admin.startPassword')} hint={t('admin.startPasswordHint', { min: PASSWORD_MIN_LENGTH })}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={PASSWORD_MIN_LENGTH}
              required
              autoComplete="off"
            />
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} disabled={self} />
          {t('admin.isAdminLabel')}
        </label>
        {user && (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={self} />
            {t('admin.activeLabel')}
          </label>
        )}
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {user ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await post(`/api/admin/users/${user.id}/password`, { password });
    setDone(true);
  });
  return (
    <Dialog title={t('admin.resetPasswordFor', { name: user.name })} onClose={onClose}>
      {done ? (
        <div className="stack">
          <p>{t('admin.resetDone')}</p>
          <div className="actions">
            <button className="primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          <p className="muted">{t('admin.resetIntro')}</p>
          <Field label={t('admin.startPassword')} hint={t('admin.startPasswordHint', { min: PASSWORD_MIN_LENGTH })}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={PASSWORD_MIN_LENGTH}
              required
              autoComplete="off"
            />
          </Field>
          <ErrorText code={error} />
          <div className="actions">
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="primary" disabled={busy}>
              {t('admin.resetPassword')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
