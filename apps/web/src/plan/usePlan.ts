import { PlanTree, type PlanPayload, type PlanRow } from '@spm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, get } from '../api';

/** Loads the plan and runs changes; every change answers with the whole plan. */
export function usePlan(projectId: string, versionId: string | null, compareId: string | null) {
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPlan(await get<PlanPayload>(`/api/projects/${projectId}/plan${query(versionId, compareId)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'internal');
    }
  }, [projectId, versionId, compareId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => setPlan(null), [projectId, versionId]);

  /** Runs a change. On a conflict (someone else was faster) the plan is reloaded and a notice shown. */
  const run = useCallback(
    async <T = PlanPayload>(
      method: 'POST' | 'PATCH' | 'DELETE',
      url: string,
      body?: unknown,
      pick?: (r: T) => PlanPayload,
    ): Promise<T | null> => {
      try {
        // Changes answer with the plan as shown here, including the comparison.
        const res = await api<T>(method, compareId ? `${url}?compare=${compareId}` : url, body);
        setPlan(pick ? pick(res) : (res as unknown as PlanPayload));
        setNotice(null);
        return res;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'internal';
        setNotice(code);
        if (code === 'conflict' || code === 'not_found') await reload();
        return null;
      }
    },
    [reload, compareId],
  );

  const tree = useMemo(() => (plan ? new PlanTree(plan.items, plan.subprojects, plan.project.id) : null), [plan]);
  return { plan, tree, error, notice, setNotice, reload, run };
}

function query(version: string | null, compare: string | null): string {
  const q = new URLSearchParams();
  if (version) q.set('version', version);
  if (compare) q.set('compare', compare);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Rows without the ones inside collapsed rows (and, optionally, only one subproject's part). */
export function visibleRows(rows: PlanRow[], collapsed: Set<string>, only: string | null): PlanRow[] {
  const out: PlanRow[] = [];
  const hidden = new Set<string>();
  let inside = only === null;
  let onlyDepth = -1;
  for (const r of rows) {
    if (only !== null) {
      if (r.id === only) {
        inside = true;
        onlyDepth = r.depth;
      } else if (inside && r.depth <= onlyDepth) inside = false;
      if (!inside) continue;
    }
    if (r.parentRow && hidden.has(r.parentRow)) {
      hidden.add(r.id);
      continue;
    }
    out.push(r);
    if (collapsed.has(r.id)) hidden.add(r.id);
  }
  return out;
}

export function loadSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function saveSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // Only a convenience.
  }
}

export function loadValue<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function saveValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
}
