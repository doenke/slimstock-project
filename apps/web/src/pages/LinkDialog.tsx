import type { Member, MemberLink, ProjectDetail } from '@spm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../api';
import { Dialog, ErrorText, Loading, useLoad, useSubmit } from '../components/ui';
import { formatDateTime } from '../format';

/** The personal link of a customer person for this project: copy, share, send by e-mail, renew. */
export function LinkDialog({ project, member, onClose }: { project: ProjectDetail; member: Member; onClose: () => void }) {
  const { t } = useTranslation();
  const base = `/api/projects/${project.id}/members/${member.membershipId}/link`;
  const { data, error, setData } = useLoad(() => get<MemberLink>(base), [base]);
  const [copied, setCopied] = useState(false);
  const renew = useSubmit(async () => {
    if (!window.confirm(t('links.confirmRenew', { name: member.name }))) return;
    setData(await post<MemberLink>(`${base}/renew`));
    setCopied(false);
  });
  const text = data ? t('links.mailBody', { name: member.name, project: project.name, url: data.url }) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data!.url);
      setCopied(true);
    } catch {
      // Clipboard not allowed: the field is selected, so Ctrl+C works.
      (document.getElementById('member-link') as HTMLInputElement | null)?.select();
    }
  };
  return (
    <Dialog title={t('links.title', { name: member.name })} onClose={onClose}>
      <div className="stack">
        <p className="muted small">{t('links.intro')}</p>
        {error ? (
          <ErrorText code={error} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <div className="row">
              <input id="member-link" readOnly value={data.url} onFocus={(e) => e.currentTarget.select()} aria-label={t('links.link')} />
              <button type="button" className="primary" onClick={() => void copy()}>
                {copied ? t('links.copied') : t('links.copy')}
              </button>
            </div>
            <div className="row wrap">
              {'share' in navigator && (
                <button type="button" onClick={() => void navigator.share({ title: project.name, text, url: data.url }).catch(() => {})}>
                  {t('links.share')}
                </button>
              )}
              <a
                className="button"
                href={`mailto:${member.email ?? ''}?subject=${encodeURIComponent(t('links.mailSubject', { project: project.name }))}&body=${encodeURIComponent(text)}`}
              >
                {t('links.mail')}
              </a>
            </div>
            <p className="small muted">
              {data.lastUsedAt ? t('links.lastUsed', { date: formatDateTime(data.lastUsedAt) }) : t('links.neverUsed')}
            </p>
            <p className="small warn-text">{t('links.warning')}</p>
          </>
        )}
        <ErrorText code={renew.error} />
        <div className="actions">
          <button type="button" className="danger" onClick={() => void renew.onSubmit()} disabled={renew.busy || !data}>
            {t('links.renew')}
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
