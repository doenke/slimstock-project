import { ENABLED_LANGUAGES, LANGUAGE_NAMES, type Customer, type Language, type ProjectSummary } from '@spm/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../api';
import { Dialog, ErrorText, Field, Loading, PageError, PermissionBadge, useLoad, useSubmit } from '../components/ui';
import { formatDate } from '../format';
import { Link, navigate } from '../router';
import { useMe, useSession } from '../session';

export function ProjectsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const { data, error } = useLoad(() => get<ProjectSummary[]>('/api/projects'), []);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    if (!data) return [];
    const ids = new Set(data.map((p) => p.id));
    const q = search.trim().toLowerCase();
    const matches = (p: ProjectSummary): boolean =>
      !q ||
      [p.name, p.code ?? '', p.customerName].some((s) => s.toLowerCase().includes(q)) ||
      data.some((c) => c.parentId === p.id && matches(c));
    // Roots: top-level projects, and subprojects whose parent this user cannot see.
    const roots = data.filter((p) => (!p.parentId || !ids.has(p.parentId)) && (showArchived || p.status !== 'archived') && matches(p));
    const byCustomer = new Map<string, { name: string; projects: ProjectSummary[] }>();
    for (const p of roots) {
      const g = byCustomer.get(p.customerId) ?? { name: p.customerName, projects: [] };
      g.projects.push(p);
      byCustomer.set(p.customerId, g);
    }
    return [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, search, showArchived]);

  if (error) return <PageError code={error} />;
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('projects.title')}</h1>
        {me.isAdmin && (
          <button className="primary" onClick={() => setCreating(true)}>
            + {t('projects.new')}
          </button>
        )}
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder={t('projects.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t('projects.search')}
        />
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('projects.showArchived')}
        </label>
      </div>
      {!data ? (
        <Loading />
      ) : groups.length === 0 ? (
        <div className="empty">
          <p>{data.length === 0 ? t(me.isAdmin ? 'projects.emptyAdmin' : 'projects.empty') : t('projects.noMatch')}</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="customer-group">
            <h2>{g.name}</h2>
            <div className="project-grid">
              {g.projects.map((p) => (
                <ProjectCard key={p.id} project={p} subprojects={data.filter((c) => c.parentId === p.id)} />
              ))}
            </div>
          </section>
        ))
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectCard({ project: p, subprojects }: { project: ProjectSummary; subprojects: ProjectSummary[] }) {
  const { t } = useTranslation();
  return (
    <article className="card project-card">
      <div className="project-card-head">
        <Link to={`/projects/${p.id}`} className="project-title">
          {p.name}
        </Link>
        <span className={`status status-${p.status}`}>{t(`status.${p.status}`)}</span>
      </div>
      <p className="muted small">
        {[p.code, p.startDate && `${formatDate(p.startDate)} – ${formatDate(p.endDate) || '…'}`, LANGUAGE_NAMES[p.language]]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {subprojects.length > 0 && (
        <ul className="sublist">
          {subprojects.map((s) => (
            <li key={s.id}>
              <Link to={`/projects/${s.id}`}>{s.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <PermissionBadge level={p.permission} />
    </article>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { config } = useSession();
  const { data: customers } = useLoad(() => get<Customer[]>('/api/customers'), []);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<Language>(config.defaultLanguage);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [esynergyName, setEsynergyName] = useState('');
  const isNewCustomer = customerId === 'new' || (customers?.length === 0 && customerId === '');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const created = await post<ProjectSummary>('/api/projects', {
      ...(isNewCustomer ? { customerName } : { customerId }),
      name,
      code,
      language,
      startDate,
      endDate,
      description,
      esynergyName,
    });
    navigate(`/projects/${created.id}`);
  });
  return (
    <Dialog title={t('projects.new')} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <Field label={t('projects.customer')}>
          <select value={isNewCustomer ? 'new' : customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="" disabled>
              {t('common.choose')}
            </option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="new">+ {t('projects.newCustomer')}</option>
          </select>
        </Field>
        {isNewCustomer && (
          <Field label={t('projects.customerName')}>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          </Field>
        )}
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
            esynergyName,
            setEsynergyName,
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

export function ProjectFields(p: {
  name: string;
  setName: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  language: Language;
  setLanguage: (v: Language) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  esynergyName: string;
  setEsynergyName: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t('project.name')}>
        <input value={p.name} onChange={(e) => p.setName(e.target.value)} required maxLength={160} />
      </Field>
      <div className="grid2">
        <Field label={t('project.code')}>
          <input value={p.code} onChange={(e) => p.setCode(e.target.value)} maxLength={40} />
        </Field>
        <Field label={t('project.language')} hint={t('project.languageHint')}>
          <select value={p.language} onChange={(e) => p.setLanguage(e.target.value as Language)}>
            {ENABLED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid2">
        <Field label={t('project.start')}>
          <input type="date" value={p.startDate} onChange={(e) => p.setStartDate(e.target.value)} />
        </Field>
        <Field label={t('project.end')}>
          <input type="date" value={p.endDate} min={p.startDate || undefined} onChange={(e) => p.setEndDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t('project.esynergyName')} hint={t('project.esynergyHint')}>
        <input value={p.esynergyName} onChange={(e) => p.setEsynergyName(e.target.value)} maxLength={160} />
      </Field>
      <Field label={t('project.description')}>
        <textarea rows={3} value={p.description} onChange={(e) => p.setDescription(e.target.value)} maxLength={4000} />
      </Field>
    </>
  );
}
