import { TASK_PRIORITIES, type Task, type TaskList, type TaskPriority } from '@spm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, del, post } from '../api';
import { Avatar, ErrorText } from '../components/ui';
import { formatDateTime } from '../format';
import { Link } from '../router';
import { useMe } from '../session';
import { statusLabel } from './common';

/** A text field that saves on blur/Enter. */
function Commit({
  value,
  onCommit,
  multiline,
  ...rest
}: { value: string; onCommit: (v: string) => void; multiline?: boolean } & Record<string, unknown>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const props = {
    value: v,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: () => v !== value && onCommit(v),
    ...rest,
  };
  return multiline ? (
    <textarea rows={4} {...props} />
  ) : (
    <input {...props} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
  );
}

export function TaskPanel({
  list,
  task,
  onSave,
  onDelete,
  onClose,
  onChanged,
  rootId,
}: {
  list: TaskList;
  task: Task;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onClose: () => void;
  onChanged: () => void;
  rootId: string;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const edit = task.canEdit;
  const full = edit;
  const [linkUrl, setLinkUrl] = useState('');
  const comments = list.comments.filter((c) => c.taskId === task.id);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comment = async () => {
    try {
      await post(`/api/tasks/${task.id}/comments`, { text, internal });
      setText('');
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  };
  return (
    <aside className="plan-panel task-panel" aria-label={task.title}>
      <header>
        {full ? (
          <Commit
            className="title-input"
            value={task.title}
            onCommit={(v) => v.trim() && onSave({ title: v.trim() })}
            aria-label={t('tasks.title')}
            maxLength={300}
          />
        ) : (
          <h2 className="panel-title">{task.title}</h2>
        )}
        <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </header>
      <label className="check">
        <input type="checkbox" checked={task.done} disabled={!edit} onChange={(e) => onSave({ done: e.target.checked })} />
        {t('tasks.done')}
        {task.done && task.doneAt && <span className="muted small">· {formatDateTime(task.doneAt)}</span>}
      </label>
      <div className="panel-grid">
        <label className="field">
          <span className="label">{t('tasks.statusLabel')}</span>
          <select value={task.statusId} disabled={!edit} onChange={(e) => onSave({ statusId: e.target.value })}>
            {list.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {statusLabel(t, list.statuses, s.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t('tasks.due')}</span>
          <input type="date" value={task.due ?? ''} disabled={!full} onChange={(e) => onSave({ due: e.target.value || null })} />
        </label>
        <label className="field">
          <span className="label">{t('tasks.priority')}</span>
          <select value={task.priority} disabled={!full} onChange={(e) => onSave({ priority: e.target.value as TaskPriority })}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.prio.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t('tasks.area')}</span>
          <Commit value={task.area ?? ''} onCommit={(v) => onSave({ area: v })} disabled={!full} maxLength={80} />
        </label>
      </div>
      {list.projects.length > 1 && (
        <label className="field">
          <span className="label">{t('tasks.project')}</span>
          <select value={task.projectId} disabled={!full} onChange={(e) => onSave({ projectId: e.target.value })}>
            {list.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.parentId ? `↳ ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="label">{t('tasks.description')}</span>
        <Commit multiline value={task.description ?? ''} onCommit={(v) => onSave({ description: v })} disabled={!full} maxLength={8000} />
      </label>

      <h3>{t('plan.col.who')}</h3>
      <div className="people">
        {list.people.map((p) => (
          <label key={p.userId} className="check">
            <input
              type="checkbox"
              checked={task.assignees.includes(p.userId)}
              disabled={!full}
              onChange={(e) =>
                onSave({ assignees: e.target.checked ? [...task.assignees, p.userId] : task.assignees.filter((x) => x !== p.userId) })
              }
            />
            {p.name}
          </label>
        ))}
      </div>

      <h3>{t('tasks.planLink')}</h3>
      {full ? (
        <select
          value={task.planItemKey ?? ''}
          onChange={(e) => onSave({ planItemKey: e.target.value || null })}
          aria-label={t('tasks.planLink')}
        >
          <option value="">{t('tasks.noPlanLink')}</option>
          {list.planItems.map((p) => (
            <option key={p.key} value={p.key}>
              {p.title}
            </option>
          ))}
        </select>
      ) : (
        <p className="small">{task.planItemTitle ?? '—'}</p>
      )}
      {task.planItemKey && (
        <Link to={`/projects/${rootId}?tab=plan`} className="small">
          {t('tasks.openPlan')}
        </Link>
      )}

      <h3>{t('tasks.links')}</h3>
      <ul className="task-links">
        {task.links.map((l, i) => (
          <li key={i}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label || l.url}
            </a>
            {full && (
              <button
                type="button"
                className="icon-button"
                aria-label={t('tasks.removeLink')}
                onClick={() => onSave({ links: task.links.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {full && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^https?:\/\//i.test(linkUrl.trim())) return setError('invalid_url');
            onSave({ links: [...task.links, { url: linkUrl.trim(), label: null }] });
            setLinkUrl('');
          }}
        >
          <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" aria-label={t('tasks.addLink')} />
          <button className="small">{t('tasks.addLink')}</button>
        </form>
      )}

      {list.rights.internal && (
        <label className="check">
          <input type="checkbox" checked={task.internal} disabled={!full} onChange={(e) => onSave({ internal: e.target.checked })} />
          {t('tasks.internalLabel')}
        </label>
      )}

      <section>
        <h3>{t('comments.title')}</h3>
        <div className="comments">
          <ul>
            {comments.map((c) => (
              <li key={c.id} className={c.internal ? 'internal' : undefined}>
                <Avatar name={c.userName} kind={c.kind} />
                <div className="comment-body">
                  <div className="small muted">
                    <strong className="comment-author">{c.userName}</strong> · {formatDateTime(c.at)}
                    {c.internal && <span className="badge muted">{t('comments.internal')}</span>}
                  </div>
                  <p>{c.text}</p>
                </div>
                {c.userId === me.id && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('comments.delete')}
                    onClick={() => void del(`/api/task-comments/${c.id}`).then(onChanged)}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {list.rights.comment && (
            <form
              className="comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) void comment();
              }}
            >
              <textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('comments.placeholder')}
                aria-label={t('comments.placeholder')}
              />
              <div className="row">
                {me.kind === 'staff' && (
                  <label className="check small">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                    {t('comments.internalLabel')}
                  </label>
                )}
                <span className="spacer" />
                <button className="small primary" disabled={!text.trim()}>
                  {t('comments.send')}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
      <ErrorText code={error} />
      {(me.kind === 'staff' || task.createdBy === me.id) && (
        <div className="panel-actions">
          <span className="spacer" />
          <button
            type="button"
            className="small danger"
            onClick={() => window.confirm(t('tasks.confirmDelete', { title: task.title })) && onDelete()}
          >
            {t('plan.delete')}
          </button>
        </div>
      )}
    </aside>
  );
}
