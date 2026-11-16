import { DAY_MINUTES as D, type AcceptPreview, type PlanPayload, type PlanVersionInfo } from '@spm/shared';
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
  const rootId = root.body.id as string;
  const sub = await t.call(t.admin.cookie, 'POST', '/api/projects', { parentId: rootId, name: 'Schnittstellen' });
  let plan = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
  const add = async (title: string, anchor: unknown = null) => {
    const res = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${plan.version.id}/items`, { title, anchor });
    plan = res.body.plan;
    return res.body.key as string;
  };
  const a = await add('Analyse');
  const s1 = await add('SAP-Export', { kind: 'subproject', id: sub.body.id });
  return {
    rootId,
    subId: sub.body.id as string,
    vid: plan.version.id,
    a,
    s1,
    get plan() {
      return plan;
    },
  };
}

const patchItem = async (plan: PlanPayload, key: string, body: Record<string, unknown>) => {
  const it = plan.items.find((i) => i.key === key)!;
  return t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${plan.version.id}/items/${key}`, { rev: it.rev, ...body });
};
const getPlan = async (rootId: string, query = '', cookie = t.admin.cookie) =>
  (await t.call(cookie, 'GET', `/api/projects/${rootId}/plan${query}`)).body as PlanPayload;

describe('effort', () => {
  it('plans days per role, sums them up and books actual effort', async () => {
    const { rootId, subId, a, s1, plan } = await setup();
    let res = await patchItem(plan, a, { efforts: { [t.role('ss_sa')]: 3 * D, [t.role('cu_ku')]: 2 * D } });
    expect(res.status).toBe(200);
    res = await patchItem(res.body, s1, { efforts: { [t.role('ss_tc')]: 4 * D } });
    let p = res.body as PlanPayload;
    expect(p.effort!.roleIds[0]).toBe(t.role('ss_pl'));
    expect(p.effort!.roleIds).not.toContain(t.role('ss_sp'));
    expect(p.effort!.total.plan).toEqual({ [t.role('ss_sa')]: 3 * D, [t.role('cu_ku')]: 2 * D, [t.role('ss_tc')]: 4 * D });
    expect(p.effort!.byRow[`sub:${subId}`]!.plan).toEqual({ [t.role('ss_tc')]: 4 * D });

    const book = await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, {
      itemKey: a,
      userId: t.admin.id,
      roleId: t.role('ss_sa'),
      date: '2026-11-17',
      minutes: D,
      note: 'Workshop',
    });
    expect(book.status).toBe(201);
    p = await getPlan(rootId);
    expect(p.effort!.byRow[a]).toMatchObject({
      actual: { [t.role('ss_sa')]: D },
      remaining: { [t.role('ss_sa')]: 2 * D, [t.role('cu_ku')]: 2 * D },
    });
    expect(p.effort!.entries).toMatchObject([{ itemKey: a, minutes: D, note: 'Workshop', userName: 'admin' }]);

    // A remaining estimate by hand raises the forecast.
    p = (await patchItem(p, a, { remaining: { [t.role('ss_sa')]: 4 * D } })).body;
    expect(p.effort!.byRow[a]!.forecast[t.role('ss_sa')]).toBe(5 * D);
    const root = p.effort!.budgets.find((b) => b.unitId === rootId)!;
    expect(root).toMatchObject({ billing: 'tm', budget: 3 * D, forecast: 5 * D, level: 'crit' });

    // Edit and delete bookings.
    expect((await t.call(t.admin.cookie, 'PATCH', `/api/effort-entries/${book.body.id}`, { minutes: 2 * D })).status).toBe(200);
    expect((await getPlan(rootId)).effort!.byRow[a]!.actual[t.role('ss_sa')]).toBe(2 * D);
    await t.call(t.admin.cookie, 'DELETE', `/api/effort-entries/${book.body.id}`);
    expect((await getPlan(rootId)).effort!.entries).toEqual([]);
  });

  it('rejects bookings for strangers, unknown tasks and roles', async () => {
    const { rootId, a } = await setup();
    const stranger = await t.createUser(`x${Date.now()}`);
    const base = { itemKey: a, userId: t.admin.id, roleId: t.role('ss_sa'), date: '2026-11-17', minutes: D };
    expect(
      (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, { ...base, userId: stranger.id })).body.error,
    ).toBe('assignee_not_member');
    expect(
      (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, { ...base, itemKey: stranger.id })).body.error,
    ).toBe('unknown_item');
    expect(
      (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, { ...base, roleId: t.role('ss_sp') })).body.error,
    ).toBe('unknown_role');
    expect((await t.call(stranger.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, base)).status).toBe(404);
  });

  it('derives durations from effort when switched on', async () => {
    const { rootId, a, plan } = await setup();
    await patchItem(plan, a, { efforts: { [t.role('ss_pl')]: 3 * D }, assignees: [t.admin.id] });
    expect((await getPlan(rootId)).computed[a]!.duration).toBe(D);
    const p = (await t.call(t.admin.cookie, 'PATCH', `/api/projects/${rootId}/plan/settings`, { durationFromEffort: true }))
      .body as PlanPayload;
    expect(p.computed[a]).toMatchObject({ duration: 3 * D, end: '2026-11-18' });
  });

  it('shows customers only what the project allows', async () => {
    const { rootId, vid, a, plan } = await setup();
    await patchItem(plan, a, { efforts: { [t.role('ss_sa')]: 3 * D, [t.role('cu_ku')]: 2 * D } });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, {
      itemKey: a,
      userId: t.admin.id,
      roleId: t.role('ss_sa'),
      date: '2026-11-17',
      minutes: D,
    });
    const customer = await t.createUser(`kunde${Date.now()}`, { kind: 'customer' });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: customer.id, roleIds: [t.role('cu_pl')] });
    const { planVersions } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await t.db.update(planVersions).set({ customerVisible: true }).where(eq(planVersions.id, vid));

    let p = await getPlan(rootId, '', customer.cookie);
    expect(p.effort).toMatchObject({ withActual: false, entries: [], budgets: [] });
    expect(p.effort!.total.plan).toEqual({ [t.role('ss_sa')]: 3 * D, [t.role('cu_ku')]: 2 * D });
    expect(p.effort!.total.actual).toEqual({});
    expect(p.items.find((i) => i.key === a)!.remaining).toEqual({});

    const setView = (effortView: string) => t.call(t.admin.cookie, 'PATCH', `/api/projects/${rootId}/plan/settings`, { effortView });
    await setView('customer');
    p = await getPlan(rootId, '', customer.cookie);
    expect(p.effort!.total.plan).toEqual({ [t.role('cu_ku')]: 2 * D });
    expect(p.items.find((i) => i.key === a)!.efforts).toEqual({ [t.role('cu_ku')]: 2 * D });
    await setView('full');
    p = await getPlan(rootId, '', customer.cookie);
    expect(p.effort!.total.actual).toEqual({ [t.role('ss_sa')]: D });
    expect(p.effort!.entries).toEqual([]);
    await setView('none');
    p = await getPlan(rootId, '', customer.cookie);
    expect(p.effort).toBeNull();
    expect(p.items.find((i) => i.key === a)!.efforts).toEqual({});
  });
});

describe('fixed price', () => {
  it('fixes the budget in the working version and asks for a change request on accept', async () => {
    const { rootId, subId, vid, s1, plan } = await setup();
    await patchItem(plan, s1, { efforts: { [t.role('ss_tc')]: 4 * D } });
    let p = (await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/billing`, { unitId: subId, billing: 'fixed' }))
      .body as PlanPayload;
    expect(p.effort!.terms[subId]).toEqual({ billing: 'fixed', budget: { [t.role('ss_tc')]: 4 * D } });
    expect(p.effort!.budgets.find((b) => b.unitId === subId)).toMatchObject({ billing: 'fixed', budget: 4 * D, pending: false });

    // A draft with more effort in the fixed-price part.
    const draft = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'Mehr Schnittstellen' }))
      .body as PlanVersionInfo;
    p = await getPlan(rootId, `?version=${draft.id}`);
    p = (await patchItem(p, s1, { efforts: { [t.role('ss_tc')]: 6 * D } })).body;
    // Within the fixed price the budget stays (forecast above it is Slimstock's risk).
    expect(p.effort!.budgets.find((b) => b.unitId === subId)).toMatchObject({ budget: 4 * D, plan: 6 * D, level: 'crit' });
    expect(p.compare === null).toBe(true);

    const preview = (await t.call(t.admin.cookie, 'GET', `/api/plan-versions/${draft.id}/accept-preview`)).body as AcceptPreview;
    expect(preview.fixedPrice).toEqual([{ unitId: subId, budget: 4 * D, plan: 6 * D }]);
    expect(preview.diff.effort.to[t.role('ss_tc')]).toBe(6 * D);
    expect(preview.diff.rows.find((r) => r.key === s1)!.effortDelta).toEqual({ [t.role('ss_tc')]: 2 * D });

    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/accept`, { changeRequests: { [subId]: true } });
    p = await getPlan(rootId);
    expect(p.effort!.terms[subId]!.budget).toEqual({ [t.role('ss_tc')]: 6 * D });
    const versions = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan/versions`)).body as PlanVersionInfo[];
    expect(versions.find((v) => v.id === draft.id)!.kind).toBe('working');
  });

  it('a fixed price chosen in a draft gets its budget on accept; within the fixed price it stays', async () => {
    const { rootId, subId, s1, plan } = await setup();
    await patchItem(plan, s1, { efforts: { [t.role('ss_tc')]: 2 * D } });
    const draft = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'Festpreis' }))
      .body as PlanVersionInfo;
    let p = (await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/billing`, { unitId: subId, billing: 'fixed' }))
      .body as PlanPayload;
    expect(p.effort!.terms[subId]).toEqual({ billing: 'fixed', budget: null });
    expect(p.effort!.budgets.find((b) => b.unitId === subId)).toMatchObject({ pending: true, budget: 2 * D });
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/accept`, {});
    p = await getPlan(rootId);
    expect(p.effort!.terms[subId]!.budget).toEqual({ [t.role('ss_tc')]: 2 * D });

    // Next draft raises the effort but stays within the fixed price.
    const d2 = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'Mehr' })).body as PlanVersionInfo;
    p = await getPlan(rootId, `?version=${d2.id}`);
    await patchItem(p, s1, { efforts: { [t.role('ss_tc')]: 5 * D } });
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${d2.id}/accept`, { changeRequests: { [subId]: false } });
    p = await getPlan(rootId);
    expect(p.effort!.terms[subId]!.budget).toEqual({ [t.role('ss_tc')]: 2 * D });
    expect(
      (await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${p.version.id}/billing`, { unitId: rootId, billing: 'fixed' })).status,
    ).toBe(200);
  });

  it('only the project lead decides billing', async () => {
    const { rootId, subId, vid } = await setup();
    const team = await t.createUser(`team${Date.now()}`);
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: team.id, roleIds: [t.role('ss_c')] });
    expect((await t.call(team.cookie, 'POST', `/api/plan-versions/${vid}/billing`, { unitId: subId, billing: 'fixed' })).status).toBe(403);
  });
});

describe('excel export', () => {
  it('exports plan, budget and bookings in the project language', async () => {
    const { rootId, a, plan } = await setup();
    await patchItem(plan, a, { efforts: { [t.role('ss_sa')]: 3 * D } });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, {
      itemKey: a,
      userId: t.admin.id,
      roleId: t.role('ss_sa'),
      date: '2026-11-17',
      minutes: D,
    });
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${rootId}/plan/export.xlsx`, headers: { cookie: t.admin.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''Einf%C3%BChrung_V1.xlsx");
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Plan und Aufwand', 'Budget', 'Ist-Buchungen']);
    const sheet = wb.worksheets[0]!;
    const header = (sheet.getRow(4).values as unknown[]).filter(Boolean);
    expect(header).toContain('Solution Architect');
    const analyse = sheet.getRows(5, 10)!.find((r) => String(r.getCell(1).value).includes('Analyse'))!;
    expect(analyse.getCell(header.indexOf('Solution Architect') + 1).value).toBe(3);
    const en = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${rootId}/plan/export.xlsx?lang=en`,
      headers: { cookie: t.admin.cookie },
    });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(en.rawPayload as never);
    expect(wb2.worksheets[0]!.name).toBe('Plan and effort');
  });
});
