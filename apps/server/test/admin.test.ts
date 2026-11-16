import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('users', () => {
  it('only admins manage users', async () => {
    const anna = await t.createUser('anna');
    expect((await t.call(anna.cookie, 'GET', '/api/admin/users')).status).toBe(403);
    expect(
      (await t.call(anna.cookie, 'POST', '/api/admin/users', { username: 'x1', name: 'X', password: 'long-enough-pass' })).status,
    ).toBe(403);
    const list = await t.call(t.admin.cookie, 'GET', '/api/admin/users');
    expect(list.body.map((u: { username: string }) => u.username).sort()).toEqual(['admin', 'anna']);
  });

  it('rejects duplicate and invalid user names', async () => {
    const dup = await t.call(t.admin.cookie, 'POST', '/api/admin/users', { username: 'ANNA', name: 'A', password: 'long-enough-pass' });
    expect(dup.status).toBe(409);
    const bad = await t.call(t.admin.cookie, 'POST', '/api/admin/users', { username: 'a b', name: 'A', password: 'long-enough-pass' });
    expect(bad.status).toBe(400);
  });

  it('admins cannot demote themselves', async () => {
    expect((await t.call(t.admin.cookie, 'PATCH', `/api/admin/users/${t.admin.id}`, { isAdmin: false })).body.error).toBe(
      'cannot_demote_self',
    );
  });

  it('resets a password and forces a change', async () => {
    const carl = await t.createUser('carl');
    expect((await t.call(t.admin.cookie, 'POST', `/api/admin/users/${carl.id}/password`, { password: 'reset-password-1' })).status).toBe(
      200,
    );
    // Old sessions end.
    expect((await t.call(carl.cookie, 'GET', '/api/me')).status).toBe(401);
    const login = await t.call(null, 'POST', '/api/auth/login', { username: 'carl', password: 'reset-password-1' });
    expect(login.body.mustChangePassword).toBe(true);
  });

  it('staff can list colleagues for the member picker, customers cannot', async () => {
    const anna = await t.createUser('anna2');
    const kunde = await t.createUser('kunde', { kind: 'customer' });
    expect((await t.call(anna.cookie, 'GET', '/api/staff')).status).toBe(200);
    expect((await t.call(kunde.cookie, 'GET', '/api/staff')).status).toBe(403);
  });
});

describe('project roles', () => {
  it('seeds the Slimstock and customer roles', async () => {
    const { body } = await t.call(t.admin.cookie, 'GET', '/api/roles');
    expect(body.filter((r: { side: string }) => r.side === 'slimstock')).toHaveLength(6);
    expect(body.filter((r: { side: string }) => r.side === 'customer')).toHaveLength(8);
    expect(body[0].names).toMatchObject({ de: 'Projektleiter', en: 'Project Lead' });
  });

  it('admins add, change and reorder roles', async () => {
    const created = await t.call(t.admin.cookie, 'POST', '/api/admin/roles', {
      side: 'customer',
      names: { de: 'Einkauf', en: 'Purchasing' },
      defaultPermission: 'team_customer',
    });
    expect(created.status).toBe(201);
    expect(created.body.calculated).toBe(true);
    const changed = await t.call(t.admin.cookie, 'PATCH', `/api/admin/roles/${created.body.id}`, { active: false, calculated: false });
    expect(changed.body).toMatchObject({ active: false, calculated: false });
    const all = (await t.call(t.admin.cookie, 'GET', '/api/roles')).body.map((r: { id: string }) => r.id);
    const reordered = await t.call(t.admin.cookie, 'POST', '/api/admin/roles/order', { ids: [...all].reverse() });
    expect(reordered.body[0].id).toBe(created.body.id);
  });

  it('keeps permission levels on the right side', async () => {
    const res = await t.call(t.admin.cookie, 'POST', '/api/admin/roles', {
      side: 'customer',
      names: { de: 'Falsch' },
      defaultPermission: 'pl_slimstock',
    });
    expect(res.body.error).toBe('permission_not_for_side');
    expect(
      (await t.call(t.admin.cookie, 'POST', '/api/admin/roles', { side: 'customer', names: {}, defaultPermission: 'reader' })).status,
    ).toBe(400);
  });

  it('non-admins cannot change roles', async () => {
    const anna = await t.createUser('anna3');
    expect(
      (await t.call(anna.cookie, 'POST', '/api/admin/roles', { side: 'customer', names: { de: 'X' }, defaultPermission: 'reader' })).status,
    ).toBe(403);
  });
});

describe('customers', () => {
  it('admins create and rename customers, staff can list them', async () => {
    const c = await t.call(t.admin.cookie, 'POST', '/api/admin/customers', { name: 'Muster GmbH' });
    expect(c.status).toBe(201);
    await t.call(t.admin.cookie, 'PATCH', `/api/admin/customers/${c.body.id}`, { name: 'Muster AG' });
    const anna = await t.createUser('anna4');
    const list = await t.call(anna.cookie, 'GET', '/api/customers');
    expect(list.body).toEqual([{ id: c.body.id, name: 'Muster AG' }]);
  });
});
