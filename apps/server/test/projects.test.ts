import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

async function newProject(name = 'Slim4-Einführung', extra: Record<string, unknown> = {}) {
  const res = await t.call(t.admin.cookie, 'POST', '/api/projects', { customerName: 'Muster GmbH', name, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('projects', () => {
  it('admins create projects; the creator leads them', async () => {
    const id = await newProject('Projekt A', { language: 'en', code: 'MUS-01' });
    const detail = await t.call(t.admin.cookie, 'GET', `/api/projects/${id}`);
    expect(detail.body).toMatchObject({
      name: 'Projekt A',
      language: 'en',
      code: 'MUS-01',
      customerName: 'Muster GmbH',
      status: 'planned',
    });
    expect(detail.body.rights.editProject).toBe(true);
    const members = await t.call(t.admin.cookie, 'GET', `/api/projects/${id}/members`);
    expect(members.body).toHaveLength(1);
    expect(members.body[0]).toMatchObject({ userId: t.admin.id, roleIds: [t.role('ss_pl')], effectivePermission: 'pl_slimstock' });
  });

  it('only admins create top-level projects', async () => {
    const anna = await t.createUser('anna');
    expect((await t.call(anna.cookie, 'POST', '/api/projects', { customerName: 'X', name: 'Y' })).status).toBe(403);
  });

  it('accepts empty optional fields from forms', async () => {
    const res = await t.call(t.admin.cookie, 'POST', '/api/projects', {
      customerName: 'Leer AG',
      name: 'Leer',
      code: '',
      startDate: '',
      endDate: '',
      description: '',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: null, startDate: null, endDate: null });
    expect((await t.call(t.admin.cookie, 'POST', '/api/projects', { customerName: 'X', name: 'Y', startDate: '1.12.2026' })).status).toBe(
      400,
    );
  });

  it('needs a customer', async () => {
    expect((await t.call(t.admin.cookie, 'POST', '/api/projects', { name: 'Ohne Kunde' })).body.error).toBe('customer_required');
  });

  it('non-members see nothing, not even that the project exists', async () => {
    const id = await newProject();
    const bob = await t.createUser('bob');
    expect((await t.call(bob.cookie, 'GET', '/api/projects')).body).toEqual([]);
    expect((await t.call(bob.cookie, 'GET', `/api/projects/${id}`)).status).toBe(404);
  });
});

describe('members and permissions', () => {
  it('the permission comes from the roles; team members view but do not manage', async () => {
    const id = await newProject();
    const carl = await t.createUser('carl');
    const add = await t.call(t.admin.cookie, 'POST', `/api/projects/${id}/members`, {
      userId: carl.id,
      roleIds: [t.role('ss_c'), t.role('ss_tr')],
    });
    expect(add.status).toBe(201);
    const me = add.body.find((m: { userId: string }) => m.userId === carl.id);
    expect(me).toMatchObject({ effectivePermission: 'team_slimstock' });
    expect(me.roleIds.sort()).toEqual([t.role('ss_c'), t.role('ss_tr')].sort());

    const detail = await t.call(carl.cookie, 'GET', `/api/projects/${id}`);
    expect(detail.body.permission).toBe('team_slimstock');
    expect(detail.body.rights).toMatchObject({ view: true, viewInternal: true, editProject: false, manageMembers: false });
    expect((await t.call(carl.cookie, 'PATCH', `/api/projects/${id}`, { name: 'Neu' })).status).toBe(403);
    expect((await t.call(carl.cookie, 'POST', `/api/projects/${id}/members`, { name: 'Kunde', roleIds: [] })).status).toBe(403);

    // A second role with a higher default raises the level.
    await t.call(t.admin.cookie, 'PATCH', `/api/projects/${id}/members/${me.membershipId}`, { roleIds: [t.role('ss_c'), t.role('ss_pl')] });
    expect((await t.call(carl.cookie, 'GET', `/api/projects/${id}`)).body.permission).toBe('pl_slimstock');
    expect((await t.call(carl.cookie, 'PATCH', `/api/projects/${id}`, { name: 'Neu', language: 'en' })).body).toMatchObject({
      name: 'Neu',
      language: 'en',
    });
  });

  it('roles must match the side of the person', async () => {
    const id = await newProject();
    const dora = await t.createUser('dora');
    const res = await t.call(t.admin.cookie, 'POST', `/api/projects/${id}/members`, { userId: dora.id, roleIds: [t.role('cu_ku')] });
    expect(res.body.error).toBe('role_not_for_side');
    const cust = await t.call(t.admin.cookie, 'POST', `/api/projects/${id}/members`, {
      name: 'Kim Kunde',
      roleIds: [t.role('cu_ku')],
      permissionOverride: 'team_slimstock',
    });
    expect(cust.body.error).toBe('permission_not_for_side');
  });

  it('customer people are reused by e-mail across projects', async () => {
    const a = await newProject('A');
    const b = await newProject('B');
    const one = await t.call(t.admin.cookie, 'POST', `/api/projects/${a}/members`, {
      name: 'Kim',
      email: 'Kim@Example.org',
      roleIds: [t.role('cu_ku')],
    });
    const two = await t.call(t.admin.cookie, 'POST', `/api/projects/${b}/members`, {
      name: 'Kim K.',
      email: 'kim@example.org',
      roleIds: [t.role('cu_u')],
    });
    const kimA = one.body.find((m: { kind: string }) => m.kind === 'customer');
    const kimB = two.body.find((m: { kind: string }) => m.kind === 'customer');
    expect(kimA.userId).toBe(kimB.userId);
    expect(kimB.effectivePermission).toBe('reader');
    expect((await t.call(t.admin.cookie, 'POST', `/api/projects/${b}/members`, { userId: kimA.userId })).body.error).toBe('already_member');
  });

  it('customer project leads manage customer people only, up to their own level', async () => {
    const id = await newProject();
    const lead = await t.createUser('lena', { kind: 'customer' });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${id}/members`, { userId: lead.id, roleIds: [t.role('cu_pl')] });
    const detail = await t.call(lead.cookie, 'GET', `/api/projects/${id}`);
    expect(detail.body.rights).toMatchObject({ manageMembers: true, manageAllMembers: false, viewInternal: false });

    const added = await t.call(lead.cookie, 'POST', `/api/projects/${id}/members`, { name: 'Max Key', roleIds: [t.role('cu_ku')] });
    expect(added.status).toBe(201);
    const max = added.body.find((m: { name: string }) => m.name === 'Max Key');
    expect(
      (await t.call(lead.cookie, 'PATCH', `/api/projects/${id}/members/${max.membershipId}`, { permissionOverride: 'pl_customer' })).status,
    ).toBe(200);

    const erik = await t.createUser('erik');
    expect((await t.call(lead.cookie, 'POST', `/api/projects/${id}/members`, { userId: erik.id })).status).toBe(403);
    const admin = added.body.find((m: { userId: string }) => m.userId === t.admin.id);
    expect((await t.call(lead.cookie, 'DELETE', `/api/projects/${id}/members/${admin.membershipId}`)).status).toBe(403);
    expect((await t.call(lead.cookie, 'POST', `/api/projects/${id}/members`, { name: 'X', roleIds: [t.role('ss_c')] })).body.error).toBe(
      'role_not_for_side',
    );
    expect((await t.call(lead.cookie, 'GET', '/api/staff')).status).toBe(403);
  });

  it('readers can view only', async () => {
    const id = await newProject();
    const user = await t.createUser('ulla', { kind: 'customer' });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${id}/members`, { userId: user.id, roleIds: [t.role('cu_u')] });
    const detail = await t.call(user.cookie, 'GET', `/api/projects/${id}`);
    expect(detail.body.permission).toBe('reader');
    expect(detail.body.rights).toMatchObject({ view: true, manageMembers: false, editTasks: false });
  });
});

describe('subprojects', () => {
  it('inherit members from the parent and can add roles', async () => {
    const id = await newProject('Gesamt');
    const sub = await t.call(t.admin.cookie, 'POST', '/api/projects', { parentId: id, name: 'Schnittstellen' });
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({ parentId: id, customerName: 'Muster GmbH', language: 'de' });

    const fred = await t.createUser('fred');
    await t.call(t.admin.cookie, 'POST', `/api/projects/${id}/members`, { userId: fred.id, roleIds: [t.role('ss_tc')] });
    const detail = await t.call(fred.cookie, 'GET', `/api/projects/${sub.body.id}`);
    expect(detail.body.permission).toBe('team_slimstock');
    expect(detail.body.path).toEqual([{ id, name: 'Gesamt' }]);
    expect((await t.call(fred.cookie, 'GET', `/api/projects/${id}`)).body.subprojects).toHaveLength(1);

    const members = await t.call(t.admin.cookie, 'POST', `/api/projects/${sub.body.id}/members`, {
      userId: fred.id,
      roleIds: [t.role('ss_pl')],
    });
    const f = members.body.find((m: { userId: string }) => m.userId === fred.id);
    expect(f).toMatchObject({ roleIds: [t.role('ss_pl')], inheritedRoleIds: [t.role('ss_tc')], effectivePermission: 'pl_slimstock' });
    expect(f.inheritedFrom).toEqual([{ id, name: 'Gesamt' }]);
    // The lead role in the subproject does not reach up to the parent.
    expect((await t.call(fred.cookie, 'GET', `/api/projects/${id}`)).body.permission).toBe('team_slimstock');
    expect((await t.call(fred.cookie, 'GET', `/api/projects/${sub.body.id}`)).body.permission).toBe('pl_slimstock');
    // Subproject leads may create sub-subprojects.
    expect((await t.call(fred.cookie, 'POST', '/api/projects', { parentId: sub.body.id, name: 'SAP' })).status).toBe(201);
  });

  it('a member of a subproject only does not see the parent', async () => {
    const id = await newProject('Gesamt 2');
    const sub = await t.call(t.admin.cookie, 'POST', '/api/projects', { parentId: id, name: 'Schulung' });
    const gina = await t.createUser('gina');
    await t.call(t.admin.cookie, 'POST', `/api/projects/${sub.body.id}/members`, { userId: gina.id, roleIds: [t.role('ss_tr')] });
    const list = await t.call(gina.cookie, 'GET', '/api/projects');
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Schulung']);
    expect((await t.call(gina.cookie, 'GET', `/api/projects/${id}`)).status).toBe(404);
  });
});
