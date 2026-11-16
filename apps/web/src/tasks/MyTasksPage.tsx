import { DUE_GROUPS, dueGroup, today, type MyTask } from '@spm/shared';
import { useTranslation } from 'react-i18next';
import { get } from '../api';
import { Loading, PageError, useLoad } from '../components/ui';
import { Link } from '../router';
import { DueDate, PriorityMark } from './common';
import './tasks.css';

/** Open tasks assigned to me, in all my projects, by due date. */
export function MyTasksPage() {
  const { t } = useTranslation();
  const { data, error } = useLoad(() => get<MyTask[]>('/api/my-tasks'), []);
  if (error) return <PageError code={error} />;
  const now = today();
  return (
    <div className="page">
      <h1>{t('tasks.myTitle')}</h1>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <div className="empty">
          <p>{t('tasks.myEmpty')}</p>
        </div>
      ) : (
        DUE_GROUPS.map((g) => {
          const list = data.filter((x) => dueGroup(x.due, now) === g);
          if (!list.length) return null;
          return (
            <section key={g} className="card my-tasks">
              <h2>
                {t(`tasks.dueGroup.${g}`)} <span className="muted">({list.length})</span>
              </h2>
              <ul>
                {list.map((x) => (
                  <li key={x.id}>
                    <PriorityMark task={x} />
                    <Link to={`/projects/${x.projectId}?tab=tasks&task=${x.id}`}>{x.title}</Link>
                    <span className="muted small">
                      {x.rootName}
                      {x.projectName !== x.rootName ? ` › ${x.projectName}` : ''}
                    </span>
                    <span className="spacer" />
                    <DueDate due={x.due} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
