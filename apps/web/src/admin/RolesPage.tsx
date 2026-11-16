import {
  ENABLED_LANGUAGES,
  LANGUAGES,
  LANGUAGE_NAMES,
  levelsForSide,
  localized,
  type Language,
  type PermissionLevel,
  type Role,
  type Side,
} from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patch, post } from '../api';
import { AdminTabs } from '../components/Layout';
import { Dialog, ErrorText, Field, PermissionBadge, useSubmit } from '../components/ui';
import { useSession } from '../session';

export function RolesPage() {
  const { t, i18n } = useTranslation();
  const { roles, reloadRoles } = useSession();
  const [editing, setEditing] = useState<Role | Side | null>(null);
  const move = async (side: Side, index: number, delta: number) => {
    const list = roles.filter((r) => r.side === side);
    const other = roles.filter((r) => r.side !== side);
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    const ids = side === 'slimstock' ? [...next, ...other] : [...other, ...next];
    await post('/api/admin/roles/order', { ids: ids.map((r) => r.id) });
    await reloadRoles();
  };
  return (
    <div className="page">
      <h1>{t('nav.admin')}</h1>
      <AdminTabs />
      <p className="muted">{t('roles.intro')}</p>
      <div className="two-col">
        {(['slimstock', 'customer'] as Side[]).map((side) => {
          const list = roles.filter((r) => r.side === side);
          return (
            <section className="card" key={side}>
              <div className="section-head">
                <h2>{t(`side.${side}`)}</h2>
                <button className="small" onClick={() => setEditing(side)}>
                  + {t('roles.new')}
                </button>
              </div>
              <ul className="role-list">
                {list.map((r, i) => (
                  <li key={r.id} className={r.active ? undefined : 'inactive'}>
                    <div className="role-main">
                      <strong>{localized(r.names, i18n.language as Language)}</strong>
                      <div className="row wrap small">
                        <PermissionBadge level={r.defaultPermission} />
                        {!r.calculated && <span className="muted">{t('roles.notCalculated')}</span>}
                        {!r.active && <span className="muted">{t('roles.inactive')}</span>}
                      </div>
                    </div>
                    <div className="row">
                      <button className="icon-button" disabled={i === 0} onClick={() => void move(side, i, -1)} aria-label={t('roles.up')}>
                        ↑
                      </button>
                      <button
                        className="icon-button"
                        disabled={i === list.length - 1}
                        onClick={() => void move(side, i, 1)}
                        aria-label={t('roles.down')}
                      >
                        ↓
                      </button>
                      <button className="small" onClick={() => setEditing(r)}>
                        {t('common.edit')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {editing && (
        <RoleDialog
          role={typeof editing === 'string' ? null : editing}
          side={typeof editing === 'string' ? editing : editing.side}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RoleDialog({ role, side, onClose }: { role: Role | null; side: Side; onClose: () => void }) {
  const { t } = useTranslation();
  const { reloadRoles } = useSession();
  const [names, setNames] = useState<Partial<Record<Language, string>>>(role?.names ?? {});
  const [calculated, setCalculated] = useState(role?.calculated ?? true);
  const [active, setActive] = useState(role?.active ?? true);
  const [defaultPermission, setDefaultPermission] = useState<PermissionLevel>(
    role?.defaultPermission ?? (side === 'slimstock' ? 'team_slimstock' : 'team_customer'),
  );
  const { busy, error, onSubmit } = useSubmit(async () => {
    const body = { names, calculated, active, defaultPermission };
    if (role) await patch(`/api/admin/roles/${role.id}`, body);
    else await post('/api/admin/roles', { ...body, side });
    await reloadRoles();
    onClose();
  });
  // Enabled languages first; prepared ones can already be filled in.
  const order = [...ENABLED_LANGUAGES, ...LANGUAGES.filter((l) => !ENABLED_LANGUAGES.includes(l))];
  return (
    <Dialog title={role ? t('roles.edit') : t('roles.newFor', { side: t(`side.${side}`) })} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <fieldset className="names">
          <legend>{t('roles.names')}</legend>
          {order.map((l) => (
            <Field key={l} label={LANGUAGE_NAMES[l]}>
              <input
                value={names[l] ?? ''}
                onChange={(e) => setNames({ ...names, [l]: e.target.value })}
                required={l === 'de' || l === 'en'}
                maxLength={120}
              />
            </Field>
          ))}
        </fieldset>
        <Field label={t('roles.defaultPermission')} hint={t('roles.defaultPermissionHint')}>
          <select value={defaultPermission} onChange={(e) => setDefaultPermission(e.target.value as PermissionLevel)}>
            {levelsForSide(side).map((l) => (
              <option key={l} value={l}>
                {t(`permission.${l}`)}
              </option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={calculated} onChange={(e) => setCalculated(e.target.checked)} />
          {t('roles.calculatedLabel')}
        </label>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('roles.activeLabel')}
        </label>
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {role ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
