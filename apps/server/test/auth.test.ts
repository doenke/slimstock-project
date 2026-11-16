import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoginLimiter } from '../src/auth/limiter.js';
import { users } from '../src/db/schema.js';
import { ADMIN_PASSWORD, createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first).split(';')[0]!;
};

describe('health and config', () => {
  it('reports ok with version and db check', async () => {
    const { status, body } = await t.call(null, 'GET', '/healthz');
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', checks: { db: 'ok' } });
  });

  it('serves the public config without login', async () => {
    const { status, body } = await t.call(null, 'GET', '/api/config');
    expect(status).toBe(200);
    expect(body.defaultLanguage).toBe('de');
  });

  it('rejects api calls without login', async () => {
    expect((await t.call(null, 'GET', '/api/projects')).status).toBe(401);
  });
});

describe('password login', () => {
  it('logs in with username and password, case-insensitive name', async () => {
    const { status, body, res } = await t.call(null, 'POST', '/api/auth/login', { username: 'Admin', password: ADMIN_PASSWORD });
    expect(status).toBe(200);
    expect(body).toMatchObject({ username: 'admin', isAdmin: true });
    const me = await t.call(cookieOf(res), 'GET', '/api/me');
    expect(me.body.id).toBe(t.admin.id);
  });

  it('rejects a wrong password and unknown users the same way', async () => {
    const wrong = await t.call(null, 'POST', '/api/auth/login', { username: 'admin', password: 'nope' });
    const unknown = await t.call(null, 'POST', '/api/auth/login', { username: 'ghost', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe('invalid_credentials');
    expect(unknown.body.error).toBe('invalid_credentials');
  });

  it('forces a password change before anything else', async () => {
    const created = await t.call(t.admin.cookie, 'POST', '/api/admin/users', {
      username: 'anna',
      name: 'Anna Berater',
      password: 'start-password-anna',
    });
    expect(created.status).toBe(201);
    const login = await t.call(null, 'POST', '/api/auth/login', { username: 'anna', password: 'start-password-anna' });
    expect(login.body.mustChangePassword).toBe(true);
    const cookie = cookieOf(login.res);
    expect((await t.call(cookie, 'GET', '/api/projects')).body.error).toBe('password_change_required');
    expect((await t.call(cookie, 'POST', '/api/me/password', { current: 'wrong', password: 'new-password-anna' })).body.error).toBe(
      'wrong_password',
    );
    expect((await t.call(cookie, 'POST', '/api/me/password', { current: 'start-password-anna', password: 'short' })).status).toBe(400);
    const changed = await t.call(cookie, 'POST', '/api/me/password', { current: 'start-password-anna', password: 'new-password-anna' });
    expect(changed.status).toBe(200);
    expect((await t.call(cookie, 'GET', '/api/projects')).status).toBe(200);
    expect((await t.call(null, 'POST', '/api/auth/login', { username: 'anna', password: 'new-password-anna' })).status).toBe(200);
  });

  it('logs out', async () => {
    const login = await t.call(null, 'POST', '/api/auth/login', { username: 'admin', password: ADMIN_PASSWORD });
    const cookie = cookieOf(login.res);
    await t.call(cookie, 'POST', '/api/auth/logout');
    expect((await t.call(cookie, 'GET', '/api/me')).status).toBe(401);
  });

  it('deactivated users are logged out and cannot log in', async () => {
    const bob = await t.createUser('bob');
    expect((await t.call(bob.cookie, 'GET', '/api/me')).status).toBe(200);
    await t.call(t.admin.cookie, 'PATCH', `/api/admin/users/${bob.id}`, { active: false });
    expect((await t.call(bob.cookie, 'GET', '/api/me')).status).toBe(401);
    expect((await t.call(null, 'POST', '/api/auth/login', { username: 'bob', password: 'bob-password-123' })).status).toBe(401);
  });

  it('customers cannot log in with a password', async () => {
    await t.db
      .update(users)
      .set({ username: 'kunde' })
      .where(eq(users.id, (await t.createUser('kunde', { kind: 'customer' })).id));
    expect((await t.call(null, 'POST', '/api/auth/login', { username: 'kunde', password: 'x' })).status).toBe(401);
  });

  it('stores the own language choice', async () => {
    const res = await t.call(t.admin.cookie, 'PATCH', '/api/me', { language: 'en' });
    expect(res.body.language).toBe('en');
    expect((await t.call(t.admin.cookie, 'PATCH', '/api/me', { language: null })).body.language).toBeNull();
    expect((await t.call(t.admin.cookie, 'PATCH', '/api/me', { language: 'fr' })).status).toBe(400);
  });
});

describe('login limiter', () => {
  it('locks a name/address pair after 5 failures and doubles the lock', () => {
    let now = 0;
    const l = new LoginLimiter(() => now);
    for (let i = 0; i < 4; i++) l.fail('anna', '1.2.3.4');
    expect(l.wait('anna', '1.2.3.4')).toBe(0);
    l.fail('anna', '1.2.3.4');
    expect(l.wait('anna', '1.2.3.4')).toBe(5 * 60_000);
    expect(l.wait('anna', '5.6.7.8')).toBe(0);
    now += 5 * 60_000;
    expect(l.wait('anna', '1.2.3.4')).toBe(0);
    for (let i = 0; i < 5; i++) l.fail('anna', '1.2.3.4');
    expect(l.wait('anna', '1.2.3.4')).toBe(10 * 60_000);
    l.succeed('anna', '1.2.3.4');
    expect(l.wait('anna', '1.2.3.4')).toBe(0);
  });

  it('answers 429 after too many attempts', async () => {
    for (let i = 0; i < 5; i++) await t.call(null, 'POST', '/api/auth/login', { username: 'victim', password: 'x' });
    const res = await t.call(null, 'POST', '/api/auth/login', { username: 'victim', password: 'x' });
    expect(res.status).toBe(429);
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });
});
