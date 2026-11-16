import { resolveLanguage, type Language, type Me, type PublicConfig, type Role } from '@spm/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, get, onUnauthorized, patch, post } from './api';
import { setLanguage, storedLanguage, storeLanguage } from './i18n';

interface Session {
  config: PublicConfig;
  me: Me | null;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
  roles: Role[];
  reloadRoles: () => Promise<void>;
  /** Language of the project currently open (null outside projects). */
  projectLanguage: Language | null;
  setProjectLanguage: (language: Language | null) => void;
  /** Own choice; null = project language. */
  chooseLanguage: (language: Language | null) => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** The logged-in user – only inside the logged-in part of the app. */
export function useMe(): Me {
  const me = useSession().me;
  if (!me) throw new Error('not logged in');
  return me;
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [projectLanguage, setProjectLanguage] = useState<Language | null>(null);
  const [anonymousLanguage, setAnonymousLanguage] = useState<Language | null>(storedLanguage());

  useEffect(() => {
    void (async () => {
      const cfg = await get<PublicConfig>('/api/config').catch(() => ({ version: '?', defaultLanguage: 'de' as Language }));
      const user = await get<Me>('/api/me').catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        return null;
      });
      setMe(user);
      setConfig(cfg);
    })();
    return onUnauthorized(() => setMe(null));
  }, []);

  const reloadRoles = useCallback(async () => {
    setRoles(await get<Role[]>('/api/roles'));
  }, []);

  useEffect(() => {
    if (me && !me.mustChangePassword) void reloadRoles();
  }, [me?.id, me?.mustChangePassword, reloadRoles]);

  const language = resolveLanguage({
    own: me ? me.language : anonymousLanguage,
    project: projectLanguage,
    browser: navigator.languages,
    fallback: config?.defaultLanguage,
  });
  useEffect(() => setLanguage(language), [language]);

  const chooseLanguage = useCallback(
    async (lang: Language | null) => {
      storeLanguage(lang);
      setAnonymousLanguage(lang);
      if (me) setMe(await patch<Me>('/api/me', { language: lang }));
    },
    [me],
  );

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {});
    setMe(null);
    setProjectLanguage(null);
  }, []);

  const value = useMemo<Session | null>(
    () => (config ? { config, me, setMe, logout, roles, reloadRoles, projectLanguage, setProjectLanguage, chooseLanguage } : null),
    [config, me, logout, roles, reloadRoles, projectLanguage, chooseLanguage],
  );
  if (!value) return <>{fallback}</>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
