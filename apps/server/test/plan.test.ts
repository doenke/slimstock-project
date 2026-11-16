import { eq } from 'drizzle-orm';
import { planVersions } from '../src/db/schema.js';
import { DAY_MINUTES, type PlanPayload } from '@spm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

async function setup() {
  const root = await t.call(t.admin.cookie, 'POST', '/api/projects', {
    customerName: 'Muster',
    name: 'Einführung',
    startDate: '2026-11-16',
  });
  const sub = await t.call(t.admin.cookie, 'POST', '/api/projects', { parentId: root.body.id, name: 'Schnittstellen' });
  const plan = (await t.call(t.admin.cookie, 'GET', `/api/projects/${root.body.id}/plan`)).body as PlanPayload;
  return { rootId: root.body.id as string, subId: sub.body.id as string, vid: plan.version.id, plan };
}

async function add(vid: string, title: string, anchor: unknown = null, milestone = false) {
  const res = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/items`, { title, anchor, milestone });
  expect(res.status).toBe(201);
  return { key: res.body.key as string, plan: res.body.plan as PlanPayload };
}

const itemOf = (plan: PlanPayload, key: string) => plan.items.find((i) => i.key === key)!;

async function patch(vid: string, plan: PlanPayload, key: string, body: Record<string, unknown>) {
  return t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${vid}/items/${key}`, { rev: itemOf(plan, key).rev, ...body });
}

describe('plan', () => {
  it('starts empty with a working version and the subprojects as rows', async () => {
    const { plan } = await setup();
    expect(plan.version.kind).toBe('working');
    expect(plan.items).toEqual([]);
    expect(plan.subprojects.map((s) => s.name)).toEqual(['Schnittstellen']);
    expect(plan.projectStart).toBe('2026-11-16');
    expect(plan.rights).toEqual({ edit: true, editSettings: true });
    expect(plan.people.map((p) => p.name)).toEqual(['admin']);
  });

  it('schedules tasks with links and rolls up the subproject', async () => {
    const { vid, subId } = await setup();
    const a = await add(vid, 'Analyse');
    const b = await add(vid, 'Schnittstelle bauen', { kind: 'subproject', id: subId });
    let res = await patch(vid, a.plan, a.key, { pm: { dur: { v: 3 * DAY_MINUTES, src: 'set' } } });
    expect(res.status).toBe(200);
    res = await patch(vid, res.body, b.key, { pm: { dur: { v: 2 * DAY_MINUTES, src: 'set' }, deps: { [a.key]: { type: 'FS', lag: 0 } } } });
    const plan = res.body as PlanPayload;
    expect(plan.computed[a.key]).toMatchObject({ start: '2026-11-16', end: '2026-11-18', critical: true });
    expect(plan.computed[b.key]).toMatchObject({ start: '2026-11-19', end: '2026-11-20' });
    expect(plan.computed[`sub:${subId}`]).toMatchObject({ start: '2026-11-19', end: '2026-11-20' });
    expect(plan.total).toMatchObject({ start: '2026-11-16', end: '2026-11-20' });
    expect(itemOf(plan, b.key).subprojectId).toBe(subId);
  });

  it('rejects circles, unknown links and stale changes', async () => {
    const { vid } = await setup();
    const a = await add(vid, 'A');
    const b = await add(vid, 'B');
    let res = await patch(vid, b.plan, b.key, { pm: { deps: { [a.key]: { type: 'FS', lag: 0 } } } });
    expect(res.status).toBe(200);
    const plan = res.body as PlanPayload;
    expect((await patch(vid, plan, a.key, { pm: { deps: { [b.key]: { type: 'FS', lag: 0 } } } })).body.error).toBe('dependency_cycle');
    expect((await patch(vid, plan, a.key, { pm: { deps: { [a.key]: { type: 'FS', lag: 0 } } } })).body.error).toBe('unknown_item');
    // Someone else changed B in the meantime.
    const stale = await t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${vid}/items/${b.key}`, { rev: 1, title: 'Alt' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('conflict');
  });

  it('builds phases by indenting; phases only take "after the end" links', async () => {
    const { vid } = await setup();
    const phase = await add(vid, 'Phase 1');
    const p1 = await add(vid, 'Aufgabe 1', { kind: 'item', key: phase.key });
    let res = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/move`, {
      target: { kind: 'item', key: p1.key },
      direction: 'indent',
    });
    let plan = res.body as PlanPayload;
    expect(itemOf(plan, p1.key).parentKey).toBe(phase.key);
    const after = await add(vid, 'Abnahme', null, true);
    plan = after.plan;
    expect((await patch(vid, plan, after.key, { pm: { deps: { [phase.key]: { type: 'SS', lag: 0 } } } })).body.error).toBe(
      'dependency_type',
    );
    res = await patch(vid, plan, after.key, { pm: { deps: { [phase.key]: { type: 'FS', lag: 0 } } } });
    expect(res.body.computed[after.key]).toMatchObject({ milestone: true, start: '2026-11-16' });
    // Out again.
    res = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/move`, {
      target: { kind: 'item', key: p1.key },
      direction: 'outdent',
    });
    expect(itemOf(res.body, p1.key).parentKey).toBeNull();
  });

  it('deleting a phase removes its tasks and links to them', async () => {
    const { vid } = await setup();
    const phase = await add(vid, 'Phase');
    const inner = await add(vid, 'Innen');
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/move`, {
      target: { kind: 'item', key: inner.key },
      direction: 'indent',
    });
    const x = await add(vid, 'Danach');
    await patch(vid, x.plan, x.key, { pm: { deps: { [inner.key]: { type: 'FS', lag: 0 } } } });
    const res = await t.call(t.admin.cookie, 'DELETE', `/api/plan-versions/${vid}/items/${phase.key}`);
    const plan = res.body as PlanPayload;
    expect(plan.items.map((i) => i.title)).toEqual(['Danach']);
    expect(itemOf(plan, x.key).pm.deps).toEqual({});
  });

  it('moves subprojects among the top rows', async () => {
    const { vid, subId } = await setup();
    await add(vid, 'Projektebene');
    const res = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/move`, {
      target: { kind: 'subproject', id: subId },
      direction: 'up',
    });
    const plan = res.body as PlanPayload;
    const sub = plan.subprojects.find((s) => s.id === subId)!;
    expect(sub.sort).toBeLessThan(plan.items[0]!.sort);
  });

  it('only accepts project members as assignees and keeps settings', async () => {
    const { vid, rootId } = await setup();
    const a = await add(vid, 'A');
    const stranger = await t.createUser('fremd');
    expect((await patch(vid, a.plan, a.key, { assignees: [stranger.id] })).body.error).toBe('assignee_not_member');
    const ok = await patch(vid, a.plan, a.key, { assignees: [t.admin.id], progress: 50, actualStart: '2026-11-16' });
    expect(itemOf(ok.body, a.key)).toMatchObject({ assignees: [t.admin.id], progress: 50, actualStart: '2026-11-16' });
    const s = await t.call(t.admin.cookie, 'PATCH', `/api/projects/${rootId}/plan/settings`, {
      workDays: [1, 2, 3, 4],
      projectStart: '2026-11-19',
    });
    expect(s.body.settings).toEqual({ workDays: [1, 2, 3, 4], projectStart: '2026-11-19', level: false });
    expect(s.body.computed[a.key].start).toBe('2026-11-19');
  });
});

describe('plan permissions', () => {
  it('team members edit, readers of the root only read, customers do not see an unshared plan', async () => {
    const { vid, rootId, subId } = await setup();
    const a = await add(vid, 'Öffentlich');
    const hidden = await add(vid, 'Intern', null);
    await patch(vid, hidden.plan, hidden.key, { internal: true });

    const team = await t.createUser('team');
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: team.id, roleIds: [t.role('ss_c')] });
    const teamPlan = await t.call(team.cookie, 'GET', `/api/projects/${rootId}/plan`);
    expect(teamPlan.body.rights).toEqual({ edit: true, editSettings: false });
    expect(teamPlan.body.items).toHaveLength(2);
    expect((await t.call(team.cookie, 'PATCH', `/api/projects/${rootId}/plan/settings`, { level: true })).status).toBe(403);

    const customer = await t.createUser('kunde', { kind: 'customer' });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: customer.id, roleIds: [t.role('cu_pl')] });
    expect((await t.call(customer.cookie, 'GET', `/api/projects/${rootId}/plan`)).body.error).toBe('plan_not_shared');
    expect((await t.call(customer.cookie, 'PATCH', `/api/plan-versions/${vid}/items/${a.key}`, { rev: 1, title: 'x' })).status).toBe(403);

    // Once shared (stage 5 adds the switch): no internal rows.
    await t.db.update(planVersions).set({ customerVisible: true }).where(eq(planVersions.id, vid));
    const shared = await t.call(customer.cookie, 'GET', `/api/projects/${rootId}/plan`);
    expect(shared.body.items.map((i: { title: string }) => i.title)).toEqual(['Öffentlich']);
    expect(shared.body.computed[hidden.key]).toBeUndefined();
    expect(shared.body.rights.edit).toBe(false);

    // Someone only on the subproject sees only its rows.
    const subOnly = await t.createUser('sub');
    await t.call(t.admin.cookie, 'POST', `/api/projects/${subId}/members`, { userId: subOnly.id, roleIds: [t.role('ss_tc')] });
    const s1 = await add(vid, 'Im Teilprojekt', { kind: 'subproject', id: subId });
    const subPlan = await t.call(subOnly.cookie, 'GET', `/api/projects/${subId}/plan`);
    expect(subPlan.body.items.map((i: { key: string }) => i.key)).toEqual([s1.key]);
    expect(subPlan.body.total).toBeNull();
    expect(subPlan.body.rights.edit).toBe(false);
  });
});
