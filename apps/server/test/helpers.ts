import { createHash, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { loadConfig } from '../src/config.js';
import { createDb, runMigrations } from '../src/db/index.js';
import { projectRoles, sessions, users } from '../src/db/schema.js';
import { ensureAdmin, seedRoles } from '../src/db/seed.js';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
export const ADMIN_PASSWORD = 'admin-start-password-1';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** A fresh database with migrations, default roles and an admin "admin" (start password already changed). */
export async function createTestApp() {
  const name = `spm_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  await runMigrations(db);
  await seedRoles(db);
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    PUBLIC_URL: 'http://localhost:43871',
    SESSION_KEY: 'test-session-key-0123456789-0123456789',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD,
    LOG_LEVEL: 'error',
    WEB_DIST: '/nonexistent',
  });
  const { app } = await buildApp({ config, db });
  await app.ready();
  await ensureAdmin(db, config, app.log);

  const roles = await db.select().from(projectRoles);
  const role = (key: string) => roles.find((r) => r.key === key)!.id;

  /** A logged-in session cookie for any user, without going through the password login. */
  async function sessionFor(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    return `spm_sid=${app.signCookie(token)}`;
  }

  async function createUser(username: string, opts: { kind?: 'staff' | 'customer'; isAdmin?: boolean; email?: string } = {}) {
    const [u] = await db
      .insert(users)
      .values({
        kind: opts.kind ?? 'staff',
        username: opts.kind === 'customer' ? null : username,
        name: username,
        email: opts.email ?? null,
        isAdmin: opts.isAdmin ?? false,
        passwordHash: opts.kind === 'customer' ? null : await hashPassword(`${username}-password-123`),
      })
      .returning();
    return { id: u!.id, cookie: await sessionFor(u!.id) };
  }

  /** Small wrapper around inject: call(cookie, 'POST', '/api/…', body) → { status, body }. */
  async function call(cookie: string | null, method: Method, url: string, payload?: unknown) {
    const res = await app.inject({ method, url, payload: payload as object, headers: cookie ? { cookie } : {} });
    return { status: res.statusCode, body: res.body ? res.json() : null, res };
  }

  const adminUser = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.username, 'admin') });
  await db.update(users).set({ mustChangePassword: false });
  const adminCookie = await sessionFor(adminUser!.id);

  return {
    app,
    db,
    role,
    call,
    createUser,
    sessionFor,
    admin: { id: adminUser!.id, cookie: adminCookie },
    async close() {
      await app.close();
      await close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
