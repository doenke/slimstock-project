import { localized, type PermissionLevel, type Role } from '@spm/shared';
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api';
import { initials } from '../format';

/** Loads data and offers reload; `error` is the API error code. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  }, [run]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  return { data, error, reload, setData };
}

/** Runs a form submit, shows the translated error, prevents double submits. */
export function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'internal');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, onSubmit, setError };
}

export function ErrorText({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  return (
    <p className="error" role="alert">
      {t(`errors.${code}`, { defaultValue: t('errors.internal') })}
    </p>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} onCancel={(e) => (e.preventDefault(), onClose())}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}

/** Label + control + hint. The hint is linked via aria-describedby, so it is not part of the label. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { id: children.props.id ?? id, 'aria-describedby': hint ? `${id}-hint` : undefined })
    : children;
  return (
    <div className="field">
      <label className="label" htmlFor={isValidElement(children) ? ((children.props as { id?: string }).id ?? id) : undefined}>
        {label}
      </label>
      {control}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Avatar({ name, kind }: { name: string; kind?: 'staff' | 'customer' }) {
  return (
    <span className={`avatar ${kind ?? ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function PermissionBadge({ level }: { level: PermissionLevel | null }) {
  const { t } = useTranslation();
  if (!level) return null;
  return <span className={`badge level-${level}`}>{t(`permission.${level}`)}</span>;
}

export function RoleChips({ ids, roles, muted }: { ids: string[]; roles: Role[]; muted?: boolean }) {
  const { i18n } = useTranslation();
  return (
    <>
      {ids.map((id) => {
        const role = roles.find((r) => r.id === id);
        return (
          <span key={id} className={muted ? 'chip muted' : 'chip'}>
            {role ? localized(role.names, i18n.language as never) : '?'}
          </span>
        );
      })}
    </>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="muted loading">{t('common.loading')}</p>;
}

export function PageError({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <p>{t(`errors.${code}`, { defaultValue: t('errors.internal') })}</p>
    </div>
  );
}
