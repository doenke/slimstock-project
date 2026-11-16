import { useTranslation } from 'react-i18next';
import { CustomersPage } from './admin/CustomersPage';
import { RolesPage } from './admin/RolesPage';
import { UsersPage } from './admin/UsersPage';
import { Layout } from './components/Layout';
import { PageError } from './components/ui';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { match, useLocation } from './router';
import { useSession } from './session';

export function App() {
  const { me } = useSession();
  const { path } = useLocation();
  useTranslation();
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ChangePasswordPage />;

  let page;
  let params: Record<string, string> | null;
  if (path === '/' || path === '') page = <ProjectsPage />;
  else if ((params = match('/projects/:id', path))) page = <ProjectPage key={params.id} id={params.id!} />;
  else if (path === '/profile') page = <ProfilePage />;
  else if (me.isAdmin && path === '/admin/users') page = <UsersPage />;
  else if (me.isAdmin && path === '/admin/roles') page = <RolesPage />;
  else if (me.isAdmin && path === '/admin/customers') page = <CustomersPage />;
  else page = <PageError code="not_found" />;
  return <Layout>{page}</Layout>;
}
