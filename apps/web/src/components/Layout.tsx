import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, navigate, useLocation } from '../router';
import { useMe, useSession } from '../session';
import { LanguageMenu } from './LanguageMenu';
import { Avatar } from './ui';

export function Layout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { config, logout } = useSession();
  const me = useMe();
  const { path } = useLocation();
  const nav = (to: string, label: string, active: boolean) => (
    <Link to={to} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
      {label}
    </Link>
  );
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width="28" height="28" />
          <span>{t('app.name')}</span>
        </Link>
        <nav className="mainnav">
          {nav('/', t('nav.projects'), path === '/' || path.startsWith('/projects'))}
          {nav('/tasks', t('nav.myTasks'), path === '/tasks')}
          {me.isAdmin && nav('/admin/users', t('nav.admin'), path.startsWith('/admin'))}
        </nav>
        <div className="topbar-right">
          <LanguageMenu />
          <details className="usermenu">
            <summary aria-label={t('nav.account')}>
              <Avatar name={me.name} kind={me.kind} />
              <span className="username">{me.name}</span>
            </summary>
            <div className="menu" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
              <button type="button" onClick={() => navigate('/profile')}>
                {t('nav.profile')}
              </button>
              <button type="button" onClick={() => void logout().then(() => navigate('/', true))}>
                {t('nav.logout')}
              </button>
            </div>
          </details>
        </div>
      </header>
      <main className="content">{children}</main>
      <footer className="footer">
        {t('app.name')} · {t('app.version', { version: config.version })}
      </footer>
    </div>
  );
}

export function AdminTabs() {
  const { t } = useTranslation();
  const { path } = useLocation();
  const tab = (to: string, label: string) => (
    <Link to={to} className={path === to ? 'tab active' : 'tab'} aria-current={path === to ? 'page' : undefined}>
      {label}
    </Link>
  );
  return (
    <div className="tabs" role="navigation">
      {tab('/admin/users', t('admin.users'))}
      {tab('/admin/roles', t('admin.roles'))}
      {tab('/admin/customers', t('admin.customers'))}
    </div>
  );
}
