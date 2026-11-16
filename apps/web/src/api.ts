/** Error from the server: `code` is translated via errors.<code>. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called when the server says the session is gone (401), so the app can show the login. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data && typeof data.error === 'string' && data.error) || 'internal';
    if (res.status === 401 && url !== '/api/auth/login') unauthorizedListeners.forEach((l) => l());
    throw new ApiError(res.status, code, data ?? {});
  }
  return data as T;
}

export const get = <T>(url: string) => api<T>('GET', url);
export const post = <T>(url: string, body?: unknown) => api<T>('POST', url, body ?? {});
export const patch = <T>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);
