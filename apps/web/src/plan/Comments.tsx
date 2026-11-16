import type { PlanPayload } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, del, post } from '../api';
import { Avatar, ErrorText } from '../components/ui';
import { formatDateTime } from '../format';
import { useMe } from '../session';

/** Comments on the version (itemKey null) or on one task. */
export function Comments({ plan, itemKey, onChanged }: { plan: PlanPayload; itemKey: string | null; onChanged: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const list = plan.comments.filter((c) => c.itemKey === itemKey);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim()) return;
    try {
      await post(`/api/plan-versions/${plan.version.id}/comments`, { itemKey, text, internal });
      setText('');
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  };
  return (
    <div className="comments">
      {list.length === 0 && !plan.rights.comment ? null : list.length === 0 ? (
        <p className="muted small">{t('comments.none')}</p>
      ) : (
        <ul>
          {list.map((c) => (
            <li key={c.id} className={c.internal ? 'internal' : undefined}>
              <Avatar name={c.userName} kind={c.kind} />
              <div className="comment-body">
                <div className="small muted">
                  <strong className="comment-author">{c.userName}</strong> · {formatDateTime(c.at)}
                  {c.internal && <span className="badge muted">{t('comments.internal')}</span>}
                </div>
                <p>{c.text}</p>
              </div>
              {(c.userId === me.id || plan.rights.manageVersions) && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('comments.delete')}
                  onClick={() => window.confirm(t('comments.confirmDelete')) && void del(`/api/plan-comments/${c.id}`).then(onChanged)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {plan.rights.comment && (
        <form
          className="comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('comments.placeholder')}
            aria-label={t('comments.placeholder')}
            maxLength={4000}
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
          <ErrorText code={error} />
        </form>
      )}
    </div>
  );
}
