import { DAY_MINUTES, type AcceptPreview, type PlanPayload, type PlanVersionInfo } from '@spm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const days = (n: number) => ({ v: n * DAY_MINUTES, src: 'set' });

async function setup() {
  const root = await t.call(t.admin.cookie, 'POST', '/api/projects', {
    customerName: 'Muster',
    name: 'Einführung',
    startDate: '2026-11-16',
  });
  const rootId = root.body.id as string;
  let plan = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
  const add = async (vid: string, title: string, dur: number, deps: string[] = []) => {
    const res = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${vid}/items`, { title });
    const key = res.body.key as string;
    plan = res.body.plan;
    const it = plan.items.find((i) => i.key === key)!;
    plan = (
      await t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${vid}/items/${key}`, {
        rev: it.rev,
        pm: { dur: days(dur), deps: Object.fromEntries(deps.map((d) => [d, { type: 'FS', lag: 0 }])) },
      })
    ).body;
    return key;
  };
  const a = await add(plan.version.id, 'Analyse', 3);
  const b = await add(plan.version.id, 'Konzept', 2, [a]);
  return { rootId, workingId: plan.version.id, a, b, add };
}

const getPlan = async (rootId: string, version?: string, compare?: string) =>
  (
    await t.call(
      t.admin.cookie,
      'GET',
      `/api/projects/${rootId}/plan?${version ? `version=${version}&` : ''}${compare ? `compare=${compare}` : ''}`,
    )
  ).body as PlanPayload;
const newDraft = async (rootId: string, name: string, fromVersionId?: string) => {
  const res = await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name, fromVersionId });
  expect(res.status).toBe(201);
  return res.body as PlanVersionInfo;
};
const patchItem = async (plan: PlanPayload, key: string, body: Record<string, unknown>) => {
  const it = plan.items.find((i) => i.key === key)!;
  const res = await t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${plan.version.id}/items/${key}`, { rev: it.rev, ...body });
  return res;
};

describe('drafts', () => {
  it('copies the working version with the same keys and can be edited separately', async () => {
    const { rootId, workingId, a, b } = await setup();
    const draft = await newDraft(rootId, 'Go-live später');
    expect(draft).toMatchObject({ kind: 'draft', status: 'editing', no: 2, basedOn: { id: workingId, no: 1 } });
    let d = await getPlan(rootId, draft.id);
    expect(d.items.map((i) => i.key).sort()).toEqual([a, b].sort());
    expect(d.rights.edit).toBe(true);
    d = (await patchItem(d, b, { pm: { dur: days(5) } })).body;
    // The working version is untouched.
    const w = await getPlan(rootId);
    expect(w.computed[b]!.end).toBe('2026-11-20');
    expect(d.computed[b]!.end).toBe('2026-11-25');

    const versions = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan/versions`)).body as PlanVersionInfo[];
    expect(versions.map((v) => [v.kind, v.no])).toEqual([
      ['working', 1],
      ['draft', 2],
    ]);
    expect(versions[1]!.end).toBe('2026-11-25');
  });

  it('compares versions: shifted, added and removed tasks and the project end', async () => {
    const { rootId, a, b, add } = await setup();
    const draft = await newDraft(rootId, 'Umbau');
    let d = await getPlan(rootId, draft.id);
    d = (await patchItem(d, a, { pm: { dur: days(5) }, title: 'Analyse lang' })).body;
    const c = await add(draft.id, 'Test', 1, [b]);
    await t.call(t.admin.cookie, 'DELETE', `/api/plan-versions/${draft.id}/items/${a}`);
    const working = (await getPlan(rootId)).version.id;
    d = await getPlan(rootId, draft.id, working);
    const diff = d.compare!.diff;
    expect(diff.rows.find((r) => r.key === c)!.kind).toBe('added');
    expect(diff.rows.find((r) => r.key === a)!.kind).toBe('removed');
    expect(diff.rows.find((r) => r.key === b)).toMatchObject({
      kind: 'changed',
      fields: expect.arrayContaining(['start', 'deps']),
      startShift: -3,
    });
    expect(diff.end).toEqual({ from: '2026-11-20', to: '2026-11-18', shift: -2 });
    expect(d.compare!.computed[a]).toMatchObject({ start: '2026-11-16', end: '2026-11-18' });
  });

  it('locks drafts in review; only the project lead hands over, takes back and accepts', async () => {
    const { rootId } = await setup();
    const team = await t.createUser(`team${Date.now()}`);
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: team.id, roleIds: [t.role('ss_c')] });
    const res = await t.call(team.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'Vom Team' });
    expect(res.status).toBe(201);
    const draft = res.body as PlanVersionInfo;
    expect((await t.call(team.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'in_review' })).status).toBe(409);
    expect((await t.call(team.cookie, 'POST', `/api/plan-versions/${draft.id}/accept`)).status).toBe(403);

    const review = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'in_review' });
    expect(review.body.status).toBe('in_review');
    const locked = await getPlan(rootId, draft.id);
    expect(locked.rights.edit).toBe(false);
    expect((await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/items`, { title: 'x' })).body.error).toBe(
      'version_locked',
    );
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'editing' });
    expect((await getPlan(rootId, draft.id)).rights.edit).toBe(true);

    // The creator may discard their own draft and bring it back.
    expect((await t.call(team.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'discarded' })).body.status).toBe(
      'discarded',
    );
    expect((await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/accept`)).body.error).toBe('status_not_allowed');
    expect((await t.call(team.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'editing' })).body.status).toBe('editing');
    expect(
      (await t.call(team.cookie, 'PATCH', `/api/plan-versions/${draft.id}`, { name: 'Neuer Name', description: 'Warum' })).body,
    ).toMatchObject({
      name: 'Neuer Name',
      description: 'Warum',
    });
  });

  it('accepting makes the draft the working version, keeps actual data and reports lost changes', async () => {
    const { rootId, workingId, a, b } = await setup();
    const draft = await newDraft(rootId, 'Neuer Plan');
    let d = await getPlan(rootId, draft.id);
    d = (await patchItem(d, b, { pm: { dur: days(4) } })).body;

    // Meanwhile in the working version: progress (goes along) and a planning change (gets lost).
    let w = await getPlan(rootId);
    w = (await patchItem(w, a, { progress: 40, actualStart: '2026-11-16' })).body;
    w = (await patchItem(w, b, { title: 'Konzept (neu)' })).body;

    const preview = (await t.call(t.admin.cookie, 'GET', `/api/plan-versions/${draft.id}/accept-preview`)).body as AcceptPreview;
    expect(preview.carried).toEqual([{ key: a, title: 'Analyse', fields: ['progress', 'actualStart'] }]);
    expect(preview.lost.map((r) => [r.key, r.fields])).toEqual([[b, ['title']]]);
    expect(preview.diff.rows.find((r) => r.key === b)!.fields).toEqual(expect.arrayContaining(['title', 'end', 'duration']));

    const accepted = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/accept`);
    expect(accepted.status).toBe(200);
    const now = await getPlan(rootId);
    expect(now.version).toMatchObject({ id: draft.id, kind: 'working', status: 'accepted', acceptedBy: 'admin' });
    expect(now.items.find((i) => i.key === a)).toMatchObject({ progress: 40, actualStart: '2026-11-16' });
    expect(now.items.find((i) => i.key === b)!.title).toBe('Konzept');
    expect(now.computed[b]!.end).toBe('2026-11-24');

    const old = await getPlan(rootId, workingId);
    expect(old.version.kind).toBe('history');
    expect(old.rights.edit).toBe(false);
    expect((await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${workingId}/items`, { title: 'x' })).body.error).toBe(
      'version_locked',
    );
    // A new draft from the history.
    const again = await newDraft(rootId, 'Zurück zum alten Plan', workingId);
    expect(again.basedOn!.id).toBe(workingId);
  });

  it('customers see no drafts', async () => {
    const { rootId } = await setup();
    const draft = await newDraft(rootId, 'Geheim');
    const customer = await t.createUser(`kunde${Date.now()}`, { kind: 'customer' });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: customer.id, roleIds: [t.role('cu_pl')] });
    expect((await t.call(customer.cookie, 'GET', `/api/projects/${rootId}/plan/versions`)).body).toEqual([]);
    expect((await t.call(customer.cookie, 'GET', `/api/projects/${rootId}/plan?version=${draft.id}`)).status).toBe(403);
    expect((await t.call(customer.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'x' })).status).toBe(403);
  });
});
