import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { PublicConfig } from '@spm/shared';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { adminRoutes } from './api/admin.js';
import { authRoutes } from './api/auth.js';
import { ApiError, errorHandler } from './api/errors.js';
import { planRoutes } from './api/plan.js';
import { versionRoutes } from './api/versions.js';
import { effortRoutes } from './api/effort.js';
import { exportRoutes } from './api/export.js';
import { linkRoutes } from './api/links.js';
import { taskRoutes } from './api/tasks.js';
import { projectRoutes } from './api/projects.js';
import { SessionStore, type SessionUser } from './auth/sessions.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser;
  }
  interface FastifyContextConfig {
    /** Route works without login. */
    public?: boolean;
  }
}

export const appVersion = () => process.env.APP_VERSION || 'dev';

export async function buildApp({ config, db }: { config: Config; db: Db }) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUSTED_PROXY,
    bodyLimit: 1024 * 1024,
  });
  const secure = config.PUBLIC_URL.startsWith('https://');
  const sessions = new SessionStore(db, secure);

  app.setErrorHandler(errorHandler);
  await app.register(cookie, { secret: config.SESSION_KEY });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/') || request.url.startsWith('/healthz')) reply.header('Cache-Control', 'no-store');
  });

  // Every /api route needs a login unless it says otherwise.
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/') || request.routeOptions.config.public) return;
    const user = await sessions.resolve(request);
    if (!user) throw new ApiError(401, 'unauthorized');
    // Until the start password is changed, only "who am I", logout and the password change work.
    const allowed = ['/api/me', '/api/me/password', '/api/auth/logout'];
    if (user.mustChangePassword && !allowed.includes(request.routeOptions.url ?? '')) throw new ApiError(403, 'password_change_required');
    request.user = user;
  });

  // Docker/Compose health check: healthy only if the database answers.
  app.get('/healthz', { logLevel: 'warn' }, async (_request, reply) => {
    try {
      await Promise.race([db.execute(sql`SELECT 1`), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
      return { status: 'ok', version: appVersion(), checks: { db: 'ok' } };
    } catch {
      return reply.code(503).send({ status: 'error', version: appVersion(), checks: { db: 'error' } });
    }
  });
  app.get('/healthz/live', { logLevel: 'warn' }, async () => ({ status: 'ok' }));

  app.get('/api/config', { config: { public: true } }, async (): Promise<PublicConfig> => ({
    version: appVersion(),
    defaultLanguage: config.DEFAULT_LANGUAGE,
  }));

  await app.register(authRoutes, { db, sessions });
  await app.register(adminRoutes, { db, sessions });
  await app.register(projectRoutes, { db, config });
  await app.register(planRoutes, { db });
  await app.register(versionRoutes, { db });
  await app.register(effortRoutes, { db });
  await app.register(exportRoutes, { db });
  await app.register(linkRoutes, { db, config, sessions });
  await app.register(taskRoutes, { db });

  app.all('/api/*', async () => {
    throw new ApiError(404, 'not_found');
  });

  // The web app (built by Vite). Unknown paths get index.html so the client router can take over.
  const webDist = config.WEB_DIST ? resolve(config.WEB_DIST) : resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist');
  if (existsSync(resolve(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders: (reply, path) => {
        // Hashed assets never change; everything else is checked on every load.
        reply.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) => {
      // Only page navigations get the app; a missing file (old asset, typo) is a real 404.
      const path = request.url.split('?')[0]!;
      if (request.method !== 'GET' || path.startsWith('/api/') || path.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(path)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  const prune = setInterval(() => sessions.prune().catch((e) => app.log.warn(e)), 6 * 60 * 60_000);
  prune.unref();
  app.addHook('onClose', async () => clearInterval(prune));

  return { app, sessions };
}
