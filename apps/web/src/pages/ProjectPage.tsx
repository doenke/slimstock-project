import { LANGUAGE_NAMES, PROJECT_STATUSES, type ProjectDetail, type ProjectStatus, type ProjectSummary } from '@spm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '../api';
import { Dialog, ErrorText, Field, Loading, PageError, PermissionBadge, useLoad, useSubmit } from '../components/ui';
import { formatDate } from '../format';
import { Link, navigate, useLocation } from '../router';
import { useSession } from '../session';
import { MembersPanel } from './MembersPanel';
import { ProjectFields } from './ProjectsPage';

export function ProjectPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { query } = useLocation();
  const tab = query.get('tab') === 'members' ? 'members' : 'overview';
  const { setProjectLanguage } = useSession();
  const { data: project, error, reload } = useLoad(() => get<ProjectDetail>(`/api/projects/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);

  useEffect(() => {
    setProjectLanguage(project?.language ?? null);
  }, [project?.language, setProjectLanguage]);
  useEffect(() => () => setProjectLanguage(null), [setProjectLanguage]);

  if (error) return <PageError code={error} />;
  if (!project) return <Loading />;
  const p = project;
  const tabLink = (key: string, label: string) => (
    <Link
      to={key === 'overview' ? `/projects/${p.id}` : `/projects/${p.id}?tab=${key}`}
      className={tab === key ? 'tab active' : 'tab'}
      aria-current={tab === key ? 'page' : undefined}
    >
      {label}
    </Link>
  );

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label={t('project.breadcrumb')}>
        <Link to="/">{t('nav.projects')}</Link>
        <span>›</span>
        <span>{p.customerName}</span>
        {p.path.map((a) => (
          <span key={a.id} className="crumb">
            <span>›</span>
            <Link to={`/projects/${a.id}`}>{a.name}</Link>
          </span>
        ))}
      </nav>
      <div className="page-head">
        <div>
          <h1>
            {p.name} {p.code && <span className="code">{p.code}</span>}
          </h1>
          <div className="row wrap">
            <span className={`status status-${p.status}`}>{t(`status.${p.status}`)}</span>
            <PermissionBadge level={p.permission} />
            {p.parentId && <span className="muted small">{t('project.isSubproject')}</span>}
          </div>
        </div>
        {p.rights.editProject && <button onClick={() => setEditing(true)}>{t('common.edit')}</button>}
      </div>

      <div className="tabs">
        {tabLink('overview', t('project.overview'))}
        {tabLink('members', t('project.members'))}
      </div>

      {tab === 'overview' ? (
        <div className="overview">
          <section className="card">
            <h2>{t('project.details')}</h2>
            <dl className="facts">
              <dt>{t('projects.customer')}</dt>
              <dd>{p.customerName}</dd>
              <dt>{t('project.period')}</dt>
              <dd>{p.startDate || p.endDate ? `${formatDate(p.startDate) || '…'} – ${formatDate(p.endDate) || '…'}` : '—'}</dd>
              <dt>{t('project.language')}</dt>
              <dd>{LANGUAGE_NAMES[p.language]}</dd>
            </dl>
            {p.description ? <p className="description">{p.description}</p> : <p className="muted">{t('project.noDescription')}</p>}
          </section>
          <section className="card">
            <div className="section-head">
              <h2>{t('project.subprojects')}</h2>
              {p.rights.createSubproject && (
                <button className="small" onClick={() => setAddingSub(true)}>
                  + {t('project.newSubproject')}
                </button>
              )}
            </div>
            {p.subprojects.length === 0 ? (
              <p className="muted">{t('project.noSubprojects')}</p>
            ) : (
              <ul className="subprojects">
                {p.subprojects.map((s) => (
                  <li key={s.id}>
                    {s.permission ? <Link to={`/projects/${s.id}`}>{s.name}</Link> : <span>{s.name}</span>}
                    {s.code && <span className="code">{s.code}</span>}
                    <span className={`status status-${s.status}`}>{t(`status.${s.status}`)}</span>
                    {s.subprojectCount > 0 && (
                      <span className="muted small">{t('project.subprojectCount', { count: s.subprojectCount })}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card upcoming">
            <h2>{t('project.planTitle')}</h2>
            <p className="muted">{t('project.planSoon')}</p>
          </section>
        </div>
      ) : (
        <MembersPanel project={p} />
      )}

      {editing && (
        <EditProjectDialog
          project={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
      {addingSub && <NewSubprojectDialog parent={p} onClose={() => setAddingSub(false)} />}
    </div>
  );
}

function EditProjectDialog({ project, onClose, onSaved }: { project: ProjectDetail; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(project.name);
  const [code, setCode] = useState(project.code ?? '');
  const [language, setLanguage] = useState(project.language);
  const [startDate, setStartDate] = useState(project.startDate ?? '');
  const [endDate, setEndDate] = useState(project.endDate ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await patch(`/api/projects/${project.id}`, { name, code, language, startDate, endDate, description, status });
    onSaved();
  });
  return (
    <Dialog title={t('project.edit')} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <ProjectFields
          {...{
            name,
            setName,
            code,
            setCode,
            language,
            setLanguage,
            startDate,
            setStartDate,
            endDate,
            setEndDate,
            description,
            setDescription,
          }}
        />
        <Field label={t('project.status')}>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NewSubprojectDialog({ parent, onClose }: { parent: ProjectDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState(parent.language);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const created = await post<ProjectSummary>('/api/projects', {
      parentId: parent.id,
      name,
      code,
      language,
      startDate,
      endDate,
      description,
    });
    navigate(`/projects/${created.id}`);
  });
  return (
    <Dialog title={t('project.newSubprojectIn', { name: parent.name })} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <ProjectFields
          {...{
            name,
            setName,
            code,
            setCode,
            language,
            setLanguage,
            startDate,
            setStartDate,
            endDate,
            setEndDate,
            description,
            setDescription,
          }}
        />
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
