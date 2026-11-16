import { DUE_GROUPS, dueGroup, today, type Task, type TaskList } from '@spm/shared';
import { createContext, useContext, useEffect, useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, get } from '../api';
import { Avatar, Dialog, ErrorText, Loading, PageError, useSubmit } from '../components/ui';
import { loadValue, saveValue } from '../plan/usePlan';
import { navigate, useLocation } from '../router';
import { DueDate, PriorityMark, statusLabel } from './common';
import { TaskPanel } from './TaskPanel';
import './tasks.css';

type Mode = 'table' | 'kanban';
type Group = 'due' | 'status' | 'who' | 'project' | 'none';

/** The task list of a project (on a subproject: its tasks). */
export function TasksView({ projectId, rootId }: { projectId: string; rootId: string }) {
  const { t } = useTranslation();
  const { query } = useLocation();
  const selected = query.get('task');
  const [list, setList] = useState<TaskList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => loadValue('spm:tasks-mode', ['table', 'kanban'], 'table'));
  const [group, setGroup] = useState<Group>(() => loadValue('spm:tasks-group', ['due', 'status', 'who', 'project', 'none'], 'due'));
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [statusDialog, setStatusDialog] = useState(false);

  const reload = async () => {
    try {
      setList(await get<TaskList>(`/api/projects/${projectId}/tasks`));
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  };
  useEffect(() => {
    void reload();
  }, [projectId]);

  const select = (id: string | null) => {
    const q = new URLSearchParams({ tab: 'tasks' });
    if (id) q.set('task', id);
    navigate(`/projects/${projectId}?${q}`, true);
  };
  const run = async (method: 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, body?: unknown) => {
    try {
      const res = await api<TaskList | { id: string; list: TaskList }>(method, url, body);
      setList('list' in res ? res.list : res);
      setNotice(null);
      return res;
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'internal';
      setNotice(code);
      if (code === 'conflict') await reload();
      return null;
    }
  };
  const save = (task: Task, patch: Record<string, unknown>) => {
    // Shown at once; the server's answer (the whole list) confirms or corrects it.
    setList((l) => (l ? { ...l, tasks: l.tasks.map((x) => (x.id === task.id ? ({ ...x, ...patch } as Task) : x)) } : l));
    return run('PATCH', `/api/tasks/${task.id}?view=${projectId}`, { rev: task.rev, ...patch });
  };

  const visible = useMemo(() => {
    if (!list) return [];
    const q = search.trim().toLowerCase();
    // The Kanban always has its "done" column; the table hides done tasks unless asked.
    return list.tasks.filter(
      (x) =>
        (mode === 'kanban' || showDone || !x.done || x.id === selected) && (!q || `${x.title} ${x.area ?? ''}`.toLowerCase().includes(q)),
    );
  }, [list, search, showDone, selected, mode]);

  if (error) return <PageError code={error} />;
  if (!list) return <Loading />;
  const nameOf = (id: string) => list.people.find((p) => p.userId === id)?.name ?? '?';
  const projectName = (id: string) => list.projects.find((p) => p.id === id)?.name ?? '';
  const task = list.tasks.find((x) => x.id === selected) ?? null;

  const groups: { key: string; label: string; tasks: Task[] }[] = (() => {
    const by = (keyOf: (x: Task) => string[], order: string[], label: (k: string) => string) =>
      order.map((k) => ({ key: k, label: label(k), tasks: visible.filter((x) => keyOf(x).includes(k)) })).filter((g) => g.tasks.length);
    const now = today();
    switch (group) {
      case 'due':
        return by(
          (x) => [x.done ? 'done' : dueGroup(x.due, now)],
          [...DUE_GROUPS, 'done'],
          (k) => t(`tasks.dueGroup.${k}`),
        );
      case 'status':
        return by(
          (x) => [x.statusId],
          list.statuses.map((s) => s.id),
          (k) => statusLabel(t, list.statuses, k),
        );
      case 'who':
        return by(
          (x) => (x.assignees.length ? x.assignees : ['-']),
          [...list.people.map((p) => p.userId), '-'],
          (k) => (k === '-' ? t('tasks.nobody') : nameOf(k)),
        );
      case 'project':
        return by(
          (x) => [x.projectId],
          list.projects.map((p) => p.id),
          projectName,
        );
      default:
        return [{ key: 'all', label: '', tasks: visible }];
    }
  })();

  return (
    <KindContext.Provider value={new Map(list.people.map((p) => [p.userId, p.kind]))}>
      <div className="tasks">
        <div className="plan-toolbar">
          <div className="segmented" role="group" aria-label={t('plan.view')}>
            {(['table', 'kanban'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={m === mode ? 'active' : ''}
                aria-pressed={m === mode}
                onClick={() => (setMode(m), saveValue('spm:tasks-mode', m))}
              >
                {t(`tasks.mode.${m}`)}
              </button>
            ))}
          </div>
          {mode === 'table' && (
            <label className="row small">
              {t('tasks.groupBy')}
              <select
                value={group}
                onChange={(e) => (setGroup(e.target.value as Group), saveValue('spm:tasks-group', e.target.value))}
                className="compact"
              >
                {(['due', 'status', 'who', 'project', 'none'] as const)
                  .filter((g) => g !== 'project' || list.projects.length > 1)
                  .map((g) => (
                    <option key={g} value={g}>
                      {t(`tasks.group.${g}`)}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <input
            type="search"
            className="compact-search"
            placeholder={t('tasks.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('tasks.search')}
          />
          {mode === 'table' && (
            <label className="check small">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
          <span className="spacer" />
          <span className="muted small">
            {t('tasks.count', { open: list.tasks.filter((x) => !x.done).length, done: list.tasks.filter((x) => x.done).length })}
          </span>
          {list.rights.editStatuses && (
            <button type="button" className="small" onClick={() => setStatusDialog(true)}>
              {t('tasks.editStatuses')}
            </button>
          )}
        </div>
        {list.rights.create && (
          <form
            className="plan-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              const res = await run('POST', `/api/projects/${projectId}/tasks`, { title });
              if (res && 'id' in res) {
                setTitle('');
                select(res.id);
              }
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tasks.addPlaceholder')}
              aria-label={t('tasks.addPlaceholder')}
              maxLength={300}
            />
            <button className="primary" disabled={!title.trim()}>
              + {t('tasks.add')}
            </button>
          </form>
        )}
        {notice && (
          <p className="error small" role="alert">
            {t(`errors.${notice}`, { defaultValue: t('errors.internal') })}
          </p>
        )}

        <div className={`plan-body${task ? ' with-panel' : ''}`}>
          <div className="plan-main">
            {list.tasks.length === 0 ? (
              <div className="empty">
                <p>{t(list.rights.create ? 'tasks.emptyCreate' : 'tasks.empty')}</p>
              </div>
            ) : mode === 'table' ? (
              <TaskTable
                groups={groups}
                list={list}
                selected={selected}
                onSelect={select}
                onToggle={(x) => void save(x, { done: !x.done })}
                nameOf={nameOf}
                projectName={projectName}
              />
            ) : (
              <Kanban
                list={list}
                tasks={visible}
                selected={selected}
                onSelect={select}
                onMove={(x, patch) => void save(x, patch)}
                nameOf={nameOf}
              />
            )}
          </div>
          {task && (
            <TaskPanel
              list={list}
              task={task}
              rootId={rootId}
              onSave={(patch) => void save(task, patch)}
              onDelete={() => void run('DELETE', `/api/tasks/${task.id}?view=${projectId}`).then(() => select(null))}
              onClose={() => select(null)}
              onChanged={() => void reload()}
            />
          )}
        </div>
        {statusDialog && (
          <StatusDialog
            list={list}
            onClose={() => setStatusDialog(false)}
            onSave={(statuses) =>
              void run('PUT', `/api/projects/${projectId}/task-statuses`, { statuses }).then(() => setStatusDialog(false))
            }
          />
        )}
      </div>
    </KindContext.Provider>
  );
}

/** Who is staff, who is customer – for the avatar colours. */
const KindContext = createContext<Map<string, 'staff' | 'customer'>>(new Map());

function Who({ ids, nameOf }: { ids: string[]; nameOf: (id: string) => string }) {
  const kinds = useContext(KindContext);
  return (
    <span className="who">
      {ids.map((id) => (
        <span key={id} title={nameOf(id)}>
          <Avatar name={nameOf(id)} kind={kinds.get(id)} />
        </span>
      ))}
    </span>
  );
}

function TaskTable({
  groups,
  list,
  selected,
  onSelect,
  onToggle,
  nameOf,
  projectName,
}: {
  groups: { key: string; label: string; tasks: Task[] }[];
  list: TaskList;
  selected: string | null;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => void;
  nameOf: (id: string) => string;
  projectName: (id: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="plan-table-wrap">
      <table className="plan-table task-table">
        <thead>
          <tr>
            <th className="check-col" />
            <th>{t('tasks.title')}</th>
            <th>{t('tasks.statusLabel')}</th>
            <th>{t('tasks.due')}</th>
            <th>{t('plan.col.who')}</th>
            <th>{t('tasks.area')}</th>
            {list.projects.length > 1 && <th>{t('tasks.project')}</th>}
            <th>{t('tasks.planLink')}</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            {g.label && (
              <tr className="group-row">
                <td colSpan={8}>
                  {g.label} <span className="muted">({g.tasks.length})</span>
                </td>
              </tr>
            )}
            {g.tasks.map((x) => (
              <tr
                key={x.id}
                className={`plan-row${x.id === selected ? ' is-selected' : ''}${x.done ? ' is-done' : ''}`}
                onClick={() => onSelect(x.id)}
              >
                <td className="check-col" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={x.done} disabled={!x.canEdit} onChange={() => onToggle(x)} aria-label={t('tasks.done')} />
                </td>
                <td>
                  <PriorityMark task={x} /> <span className="plan-title">{x.title}</span>
                  {x.internal && <span className="badge muted">{t('plan.internal')}</span>}
                  {x.commentCount > 0 && <span className="muted small"> 💬 {x.commentCount}</span>}
                </td>
                <td>
                  <span className="status-pill">{statusLabel(t, list.statuses, x.statusId)}</span>
                </td>
                <td>
                  <DueDate due={x.due} done={x.done} />
                </td>
                <td>
                  <Who ids={x.assignees} nameOf={nameOf} />
                </td>
                <td className="small">{x.area}</td>
                {list.projects.length > 1 && <td className="small">{projectName(x.projectId)}</td>}
                <td className="small muted">{x.planItemTitle}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** One column per status plus "done"; drag cards to change status or order. */
function Kanban({
  list,
  tasks,
  selected,
  onSelect,
  onMove,
  nameOf,
}: {
  list: TaskList;
  tasks: Task[];
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (task: Task, patch: Record<string, unknown>) => void;
  nameOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const columns = [
    ...list.statuses.map((s) => ({
      id: s.id,
      label: statusLabel(t, list.statuses, s.id),
      tasks: tasks.filter((x) => !x.done && x.statusId === s.id),
    })),
    {
      id: '__done',
      label: t('tasks.dueGroup.done'),
      tasks: tasks
        .filter((x) => x.done)
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
        .slice(0, 30),
    },
  ];
  const drop = (e: DragEvent, column: string, before: Task | null) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const task = list.tasks.find((x) => x.id === dragId);
    setDragId(null);
    if (!task || !task.canEdit) return;
    const col = columns.find((c) => c.id === column)!;
    const others = col.tasks.filter((x) => x.id !== task.id);
    const i = before ? others.findIndex((x) => x.id === before.id) : others.length;
    const prev = others[i - 1]?.sort;
    const next = others[i]?.sort;
    const sort =
      prev !== undefined && next !== undefined
        ? (prev + next) / 2
        : prev !== undefined
          ? prev + 1024
          : next !== undefined
            ? next - 1024
            : task.sort;
    if (column === '__done') {
      if (!task.done) onMove(task, { done: true });
    } else onMove(task, { statusId: column, done: false, sort });
  };
  return (
    <div className="kanban">
      {columns.map((c) => (
        <section
          key={c.id}
          className={`kanban-col${over === c.id ? ' over' : ''}${c.id === '__done' ? ' done-col' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setOver(c.id))}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => drop(e, c.id, null)}
          aria-label={c.label}
        >
          <h3>
            {c.label} <span className="muted">{c.tasks.length}</span>
          </h3>
          {c.tasks.map((x) => (
            <article
              key={x.id}
              className={`kanban-card${x.id === selected ? ' is-selected' : ''}${x.done ? ' is-done' : ''}`}
              draggable={x.canEdit}
              onDragStart={(e) => (setDragId(x.id), e.dataTransfer.setData('text/plain', x.id))}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, c.id, x)}
              onClick={() => onSelect(x.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(x.id)}
            >
              <div className="card-title">
                <PriorityMark task={x} /> {x.title}
              </div>
              <div className="card-meta">
                <DueDate due={x.due} done={x.done} />
                {x.area && <span className="chip">{x.area}</span>}
                {x.internal && <span className="badge muted">{t('plan.internal')}</span>}
                {x.commentCount > 0 && <span className="muted small">💬 {x.commentCount}</span>}
                <span className="spacer" />
                <Who ids={x.assignees} nameOf={nameOf} />
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function StatusDialog({
  list,
  onClose,
  onSave,
}: {
  list: TaskList;
  onClose: () => void;
  onSave: (s: { id: string; label: string | null }[]) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(list.statuses.map((s) => ({ id: s.id, label: s.label ?? statusLabel(t, list.statuses, s.id) })));
  const { error, onSubmit, setError } = useSubmit(async () => {
    if (!rows.length || rows.some((r) => !r.label.trim())) return setError('validation');
    // Unchanged default names stay translatable; everything else is the project's own name.
    onSave(
      rows.map((r) => ({ id: r.id, label: r.label.trim() === t(`tasks.status.${r.id}`, { defaultValue: '' }) ? null : r.label.trim() })),
    );
  });
  return (
    <Dialog title={t('tasks.editStatuses')} onClose={onClose}>
      <form className="stack" onSubmit={onSubmit}>
        <p className="muted small">{t('tasks.statusesIntro')}</p>
        {rows.map((r, i) => (
          <div key={r.id} className="row">
            <input
              value={r.label}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              maxLength={60}
              aria-label={t('tasks.statusLabel')}
            />
            <button
              type="button"
              className="icon-button"
              disabled={i === 0}
              onClick={() => setRows([...rows.slice(0, i - 1), r, rows[i - 1]!, ...rows.slice(i + 1)])}
              aria-label={t('roles.up')}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              aria-label={t('plan.delete')}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="small" onClick={() => setRows([...rows, { id: `s${Date.now().toString(36)}`, label: '' }])}>
          + {t('tasks.addStatus')}
        </button>
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary">{t('common.save')}</button>
        </div>
      </form>
    </Dialog>
  );
}
