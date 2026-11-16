import {
  levelsForSide,
  localized,
  maxLevel,
  type Language,
  type Member,
  type PermissionLevel,
  type ProjectDetail,
  type Role,
  type Side,
  type UserRow,
} from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { del, get, patch, post } from '../api';
import { Avatar, Dialog, ErrorText, Field, Loading, PageError, PermissionBadge, RoleChips, useLoad, useSubmit } from '../components/ui';
import { useSession } from '../session';

const sideOf = (m: { kind: 'staff' | 'customer' }): Side => (m.kind === 'staff' ? 'slimstock' : 'customer');

export function MembersPanel({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const { roles } = useSession();
  const { data: members, error, setData } = useLoad(() => get<Member[]>(`/api/projects/${project.id}/members`), [project.id]);
  const [adding, setAdding] = useState<Side | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const canManage = (m: Member) => project.rights.manageAllMembers || (project.rights.manageMembers && m.kind === 'customer');

  if (error) return <PageError code={error} />;
  if (!members) return <Loading />;

  const section = (side: Side) => {
    const list = members.filter((m) => sideOf(m) === side);
    const mayAdd = side === 'slimstock' ? project.rights.manageAllMembers : project.rights.manageMembers;
    return (
      <section className="card" key={side}>
        <div className="section-head">
          <h2>{t(`side.${side}`)}</h2>
          {mayAdd && (
            <button className="small" onClick={() => setAdding(side)}>
              + {t('members.add')}
            </button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="muted">{t('members.none')}</p>
        ) : (
          <ul className="members">
            {list.map((m) => (
              <li key={m.userId}>
                <Avatar name={m.name} kind={m.kind} />
                <div className="member-main">
                  <div className="member-name">
                    {m.name}
                    {m.email && <span className="muted small"> · {m.email}</span>}
                  </div>
                  <div className="chips">
                    <RoleChips ids={m.roleIds} roles={roles} />
                    <RoleChips ids={m.inheritedRoleIds.filter((id) => !m.roleIds.includes(id))} roles={roles} muted />
                    {m.roleIds.length === 0 && m.inheritedRoleIds.length === 0 && (
                      <span className="muted small">{t('members.noRoles')}</span>
                    )}
                  </div>
                  {m.inheritedFrom.length > 0 && (
                    <div className="muted small">
                      {t('members.inheritedFrom', { names: m.inheritedFrom.map((p) => p.name).join(', ') })}
                    </div>
                  )}
                </div>
                <div className="member-side">
                  <PermissionBadge level={m.effectivePermission} />
                  {m.permissionOverride && <span className="muted small">{t('members.overridden')}</span>}
                </div>
                {canManage(m) && (
                  <button className="small" onClick={() => setEditing(m)}>
                    {m.membershipId ? t('common.edit') : t('members.addRolesHere')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className="members-panel">
      {project.rights.viewInternal ? [section('slimstock'), section('customer')] : [section('customer'), section('slimstock')]}
      {adding && (
        <MemberDialog
          project={project}
          side={adding}
          members={members}
          onClose={() => setAdding(null)}
          onSaved={(list) => (setData(list), setAdding(null))}
        />
      )}
      {editing && (
        <MemberDialog
          project={project}
          side={sideOf(editing)}
          member={editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={(list) => (setData(list), setEditing(null))}
        />
      )}
    </div>
  );
}

function MemberDialog({
  project,
  side,
  member,
  members,
  onClose,
  onSaved,
}: {
  project: ProjectDetail;
  side: Side;
  member?: Member;
  members: Member[];
  onClose: () => void;
  onSaved: (members: Member[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const { roles } = useSession();
  const editing = !!member?.membershipId;
  const { data: staff } = useLoad(
    () => (side === 'slimstock' && !member ? get<UserRow[]>('/api/staff') : Promise.resolve([])),
    [side, member],
  );
  const [userId, setUserId] = useState(member?.userId ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>(member?.roleIds ?? []);
  const [override, setOverride] = useState<PermissionLevel | ''>(member?.permissionOverride ?? '');
  const sideRoles = roles.filter((r) => r.side === side && (r.active || roleIds.includes(r.id)));
  const fromRoles =
    maxLevel([...roleIds, ...(member?.inheritedRoleIds ?? [])].map((id) => roles.find((r) => r.id === id)?.defaultPermission)) ?? 'reader';
  const levels = levelsForSide(side).filter(
    (l) => project.rights.manageAllMembers || l === 'reader' || l === 'team_customer' || l === 'pl_customer',
  );
  const candidates = (staff ?? []).filter((u) => !members.some((m) => m.userId === u.id && m.membershipId));

  const toggle = (id: string) => setRoleIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const { busy, error, onSubmit } = useSubmit(async () => {
    const permissionOverride = override || null;
    if (editing) {
      onSaved(await patch<Member[]>(`/api/projects/${project.id}/members/${member!.membershipId}`, { roleIds, permissionOverride }));
    } else {
      const who = member || side === 'slimstock' ? { userId } : { name, email };
      onSaved(await post<Member[]>(`/api/projects/${project.id}/members`, { ...who, roleIds, permissionOverride }));
    }
  });
  const remove = useSubmit(async () => {
    if (!window.confirm(t('members.confirmRemove', { name: member!.name, project: project.name }))) return;
    onSaved(await del<Member[]>(`/api/projects/${project.id}/members/${member!.membershipId}`));
  });

  const title = member ? member.name : t(side === 'slimstock' ? 'members.addSlimstock' : 'members.addCustomer');
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        {!member && side === 'slimstock' && (
          <Field label={t('members.person')}>
            {!staff ? (
              <Loading />
            ) : (
              <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
                <option value="" disabled>
                  {t('common.choose')}
                </option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {!member && side === 'customer' && (
          <>
            <Field label={t('members.name')}>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            </Field>
            <Field label={t('members.email')} hint={t('members.emailHint')}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
            </Field>
          </>
        )}
        {member && !editing && <p className="muted">{t('members.addRolesIntro', { project: project.name })}</p>}
        <fieldset className="roles">
          <legend>{t('members.roles')}</legend>
          {sideRoles.map((r: Role) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggle(r.id)} />
              {localized(r.names, i18n.language as Language)}
              {!r.active && <span className="muted small"> ({t('roles.inactive')})</span>}
            </label>
          ))}
        </fieldset>
        <Field label={t('members.permission')} hint={t('members.permissionHint')}>
          <select value={override} onChange={(e) => setOverride(e.target.value as PermissionLevel | '')}>
            <option value="">{t('members.fromRoles', { level: t(`permission.${fromRoles}`) })}</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {t(`permission.${l}`)}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText code={error ?? remove.error} />
        <div className="actions">
          {editing && (
            <button type="button" className="danger" onClick={() => void remove.onSubmit()} disabled={remove.busy}>
              {t('members.remove')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {editing ? t('common.save') : t('members.add')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
