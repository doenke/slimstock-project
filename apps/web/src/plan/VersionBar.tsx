import type { AcceptPreview, PlanPayload, PlanVersionInfo } from '@spm/shared';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '../api';
import { Dialog, ErrorText, Field, Loading, useLoad, useSubmit } from '../components/ui';
import { formatDate, formatDateTime } from '../format';
import { DiffSummary } from './DiffPanel';
import { fmtDays } from './EffortView';

interface Props {
  projectId: string;
  plan: PlanPayload;
  versions: PlanVersionInfo[];
  compareId: string | null;
  /** Show another version (null = working version) and/or compare with another (null = none). */
  onShow: (versionId: string | null, compareId?: string | null) => void;
  onChanged: () => void;
}

export function versionLabel(t: TFunction, v: PlanVersionInfo): string {
  // The first working version has no name of its own: it is the initial plan.
  const name = v.name || (v.no === 1 ? t('versions.workingName') : t('versions.unnamed'));
  return `V${v.no} · ${name}`;
}

/** Which version is shown, what it is compared with, and what can be done with it. */
export function VersionBar({ projectId, plan, versions, compareId, onShow, onChanged }: Props) {
  const { t } = useTranslation();
  const v = plan.version;
  const [dialog, setDialog] = useState<'new' | 'edit' | 'accept' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown at once; the server's answer (reload) confirms it.
  const [visible, setVisible] = useState(v.customerVisible);
  const [shownFor, setShownFor] = useState(`${v.id}${v.customerVisible}`);
  if (shownFor !== `${v.id}${v.customerVisible}`) {
    setShownFor(`${v.id}${v.customerVisible}`);
    setVisible(v.customerVisible);
  }
  const status = async (next: 'editing' | 'in_review' | 'discarded') => {
    setBusy(true);
    try {
      await post(`/api/plan-versions/${v.id}/status`, { status: next });
      onChanged();
      setError(null);
    } catch (e) {
      setError((e as { code?: string }).code ?? 'internal');
    } finally {
      setBusy(false);
    }
  };
  const groups: [string, PlanVersionInfo[]][] = [
    [t('versions.group.working'), versions.filter((x) => x.kind === 'working')],
    [t('versions.group.drafts'), versions.filter((x) => x.kind === 'draft' && x.status !== 'discarded')],
    [t('versions.group.history'), versions.filter((x) => x.kind === 'history' || x.status === 'discarded')],
  ];
  const working = versions.find((x) => x.kind === 'working');
  const isDraft = v.kind === 'draft';

  return (
    <div className={`version-bar kind-${v.kind}`}>
      <div className="version-row">
        <label className="version-select">
          <span className="sr-only">{t('versions.version')}</span>
          <select value={v.id} onChange={(e) => onShow(e.target.value === working?.id ? null : e.target.value)}>
            {groups.map(([label, list]) =>
              list.length ? (
                <optgroup key={label} label={label}>
                  {list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {versionLabel(t, x)}
                      {x.kind === 'draft' && x.status !== 'editing' ? ` (${t(`versions.status.${x.status}`)})` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
        </label>
        <span className={`badge version-badge status-${v.kind === 'draft' ? v.status : v.kind}`}>
          {v.kind === 'draft' ? t(`versions.status.${v.status}`) : t(`versions.kind.${v.kind}`)}
        </span>
        {v.customerVisible && plan.rights.createDraft && <span className="badge visible-badge">👁 {t('versions.customerVisible')}</span>}
        <label className="version-compare">
          <span className="small muted">{t('versions.compareWith')}</span>
          <select value={compareId ?? ''} onChange={(e) => onShow(v.kind === 'working' ? null : v.id, e.target.value || null)}>
            <option value="">{t('versions.noCompare')}</option>
            {versions
              .filter((x) => x.id !== v.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {versionLabel(t, x)}
                </option>
              ))}
          </select>
        </label>
        <span className="spacer" />
        {plan.rights.createDraft && (
          <button type="button" className="small" onClick={() => setDialog('new')}>
            + {t('versions.newDraft')}
          </button>
        )}
      </div>

      <div className="version-row">
        <p className="version-meta small muted">
          {v.kind === 'working' && v.acceptedAt
            ? t('versions.metaWorking', { date: formatDateTime(v.acceptedAt), by: v.acceptedBy ?? '?' })
            : v.kind === 'history'
              ? t('versions.metaHistory', { from: formatDate(v.acceptedAt ?? v.createdAt), to: formatDate(v.replacedAt) })
              : v.kind === 'draft'
                ? t('versions.metaDraft', {
                    date: formatDateTime(v.createdAt),
                    by: v.createdBy ?? '?',
                    base: v.basedOn ? `V${v.basedOn.no}` : '—',
                  })
                : t('versions.metaInitial')}
          {v.description && <span className="version-desc"> – {v.description}</span>}
        </p>
        <span className="spacer" />
        {isDraft && (
          <div className="row wrap version-actions">
            {plan.rights.createDraft && v.status !== 'discarded' && (
              <button type="button" className="small" onClick={() => setDialog('edit')}>
                {t('versions.rename')}
              </button>
            )}
            {plan.rights.manageVersions && v.status === 'editing' && (
              <button
                type="button"
                className="small"
                disabled={busy}
                onClick={() => void status('in_review')}
                title={t('versions.toReviewHint')}
              >
                {t('versions.toReview')}
              </button>
            )}
            {plan.rights.manageVersions && v.status === 'in_review' && (
              <button type="button" className="small" disabled={busy} onClick={() => void status('editing')}>
                {t('versions.backToEditing')}
              </button>
            )}
            {plan.rights.createDraft && v.status !== 'discarded' && (
              <button
                type="button"
                className="small danger"
                disabled={busy}
                onClick={() => window.confirm(t('versions.confirmDiscard')) && void status('discarded')}
              >
                {t('versions.discard')}
              </button>
            )}
            {plan.rights.createDraft && v.status === 'discarded' && (
              <button type="button" className="small" disabled={busy} onClick={() => void status('editing')}>
                {t('versions.revive')}
              </button>
            )}
            {plan.rights.manageVersions && v.status !== 'discarded' && (
              <button type="button" className="small primary" onClick={() => setDialog('accept')}>
                {t('versions.accept')}
              </button>
            )}
          </div>
        )}
      </div>
      {plan.rights.manageVersions && (
        <label className="check small visibility-toggle">
          <input
            type="checkbox"
            checked={visible}
            disabled={busy}
            onChange={async (e) => {
              const next = e.target.checked;
              setVisible(next);
              setBusy(true);
              try {
                await post(`/api/plan-versions/${v.id}/visibility`, { customerVisible: next });
                onChanged();
              } catch (err) {
                setVisible(!next);
                setError((err as { code?: string }).code ?? 'internal');
              } finally {
                setBusy(false);
              }
            }}
          />
          {t('versions.visibleLabel')}
        </label>
      )}
      <Reviews version={v} />
      {plan.rights.review && <ReviewBox version={v} onChanged={onChanged} />}
      <ErrorText code={error} />

      {dialog === 'new' && (
        <DraftDialog
          title={t('versions.newDraftFrom', { version: versionLabel(t, v) })}
          onClose={() => setDialog(null)}
          onSubmit={async (name, description) => {
            const created = await post<PlanVersionInfo>(`/api/projects/${projectId}/plan/versions`, {
              name,
              description,
              fromVersionId: v.id,
            });
            setDialog(null);
            onChanged();
            onShow(created.id, working?.id ?? null);
          }}
        />
      )}
      {dialog === 'edit' && (
        <DraftDialog
          title={t('versions.rename')}
          initial={{ name: v.name, description: v.description ?? '' }}
          onClose={() => setDialog(null)}
          onSubmit={async (name, description) => {
            await patch(`/api/plan-versions/${v.id}`, { name, description });
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog === 'accept' && (
        <AcceptDialog
          plan={plan}
          version={v}
          onClose={() => setDialog(null)}
          onAccepted={() => {
            setDialog(null);
            onChanged();
            onShow(null, null);
          }}
        />
      )}
    </div>
  );
}

function DraftDialog({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: { name: string; description: string };
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const { busy, error, onSubmit: submit } = useSubmit(() => onSubmit(name, description));
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!initial && <p className="muted small">{t('versions.newDraftIntro')}</p>}
        <Field label={t('versions.name')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={160}
            placeholder={t('versions.namePlaceholder')}
          />
        </Field>
        <Field label={t('versions.description')} hint={t('versions.descriptionHint')}>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        </Field>
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy}>
            {initial ? t('common.save') : t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AcceptDialog({
  plan,
  version,
  onClose,
  onAccepted,
}: {
  plan: PlanPayload;
  version: PlanVersionInfo;
  onClose: () => void;
  onAccepted: () => void;
}) {
  const { t } = useTranslation();
  const { data, error: loadError } = useLoad(() => get<AcceptPreview>(`/api/plan-versions/${version.id}/accept-preview`), [version.id]);
  const [changeRequests, setChangeRequests] = useState<Record<string, boolean>>({});
  const { busy, error, onSubmit } = useSubmit(async () => {
    await post(`/api/plan-versions/${version.id}/accept`, { changeRequests });
    onAccepted();
  });
  const unitName = (id: string) =>
    id === plan.project.id ? t('effort.projectLevel') : (plan.subprojects.find((s) => s.id === id)?.name ?? '?');
  return (
    <Dialog title={t('versions.acceptTitle', { version: versionLabel(t, version) })} onClose={onClose} wide>
      <form className="stack" onSubmit={onSubmit}>
        <p>{t('versions.acceptIntro')}</p>
        {version.customerVisible && !version.reviews.some((r) => !r.stale && r.verdict === 'approve') && (
          <p className="warn-box small">⚠ {t('reviews.noApproval')}</p>
        )}
        {loadError ? (
          <ErrorText code={loadError} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <section>
              <h3 className="small-head">{t('versions.acceptChanges')}</h3>
              <DiffSummary diff={data.diff} />
            </section>
            <section>
              <h3 className="small-head">{t('versions.carriedTitle')}</h3>
              {data.carried.length === 0 ? (
                <p className="muted small">{t('versions.carriedNone')}</p>
              ) : (
                <ul className="small plain">
                  {data.carried.map((c) => (
                    <li key={c.key}>
                      {c.title}: {c.fields.map((f) => t(`versions.actual.${f}`)).join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {data.fixedPrice.length > 0 && (
              <section className="warn-box">
                <h3 className="small-head">{t('effort.fixedTitle')}</h3>
                {data.fixedPrice.map((f) =>
                  f.budget === null ? (
                    <p key={f.unitId} className="small">
                      {t('effort.fixedNew', { unit: unitName(f.unitId), plan: fmtDays(f.plan) || '0' })}
                    </p>
                  ) : (
                    <fieldset key={f.unitId} className="fixed-choice">
                      <legend className="small">
                        {t('effort.fixedChanged', {
                          unit: unitName(f.unitId),
                          budget: fmtDays(f.budget) || '0',
                          plan: fmtDays(f.plan) || '0',
                        })}
                      </legend>
                      <label className="check small">
                        <input
                          type="radio"
                          name={`cr-${f.unitId}`}
                          checked={!!changeRequests[f.unitId]}
                          onChange={() => setChangeRequests({ ...changeRequests, [f.unitId]: true })}
                        />
                        {t('effort.asChangeRequest')}
                      </label>
                      <label className="check small">
                        <input
                          type="radio"
                          name={`cr-${f.unitId}`}
                          checked={!changeRequests[f.unitId]}
                          onChange={() => setChangeRequests({ ...changeRequests, [f.unitId]: false })}
                        />
                        {t('effort.withinFixed')}
                      </label>
                    </fieldset>
                  ),
                )}
              </section>
            )}
            {data.lost.length > 0 && (
              <section className="warn-box">
                <h3 className="small-head">⚠ {t('versions.lostTitle')}</h3>
                <p className="small">{t('versions.lostIntro')}</p>
                <ul className="small plain">
                  {data.lost.map((r) => (
                    <li key={r.key}>
                      {r.title}: {r.kind === 'changed' ? r.fields.map((f) => t(`diff.field.${f}`)).join(', ') : t(`diff.kind.${r.kind}`)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <ErrorText code={error} />
        <div className="actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary" disabled={busy || !data}>
            {t('versions.acceptConfirm')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Verdicts of the customer on this draft (voided ones greyed out). */
function Reviews({ version }: { version: PlanVersionInfo }) {
  const { t } = useTranslation();
  if (!version.reviews.length) return null;
  return (
    <ul className="reviews">
      {version.reviews.map((r) => (
        <li key={`${r.userId}${r.at}`} className={r.stale ? 'stale' : undefined}>
          <span className={`badge review-${r.verdict}`}>{t(`reviews.${r.verdict}d`)}</span> <strong>{r.userName}</strong>{' '}
          <span className="muted small">{formatDateTime(r.at)}</span>
          {r.stale && <span className="muted small"> · {t('reviews.stale')}</span>}
          {r.comment && <div className="small">„{r.comment}“</div>}
        </li>
      ))}
    </ul>
  );
}

/** For the customer's project lead: approve or reject the draft in review. */
function ReviewBox({ version, onChanged }: { version: PlanVersionInfo; onChanged: () => void }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (verdict: 'approve' | 'reject') => {
    if (verdict === 'reject' && !comment.trim()) return setError('reason_required');
    setBusy(true);
    try {
      await post(`/api/plan-versions/${version.id}/review`, { verdict, comment });
      setComment('');
      setError(null);
      onChanged();
    } catch (e) {
      setError((e as { code?: string }).code ?? 'internal');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="review-box">
      <p className="small">{t('reviews.intro')}</p>
      <textarea
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t('reviews.commentPlaceholder')}
        maxLength={2000}
        aria-label={t('reviews.commentPlaceholder')}
      />
      <div className="row">
        <button type="button" className="primary" disabled={busy} onClick={() => void send('approve')}>
          ✓ {t('reviews.approve')}
        </button>
        <button type="button" className="danger" disabled={busy} onClick={() => void send('reject')}>
          ✕ {t('reviews.reject')}
        </button>
      </div>
      <ErrorText code={error} />
    </div>
  );
}
