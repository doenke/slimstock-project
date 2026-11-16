import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** A tiny router on top of the History API – the app has only a handful of pages. */

const listeners = new Set<() => void>();

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function useLocation(): { path: string; query: URLSearchParams } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

/** Matches "/projects/:id" against a path; returns the parameters or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = path.replace(/\/$/, '').split('/');
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(':')) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
