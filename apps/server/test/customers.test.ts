import type { MemberLink, Member, PlanPayload, PlanVersionInfo } from '@spm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

/** A project with a task, a customer project lead and a key user (no sessions yet – they come by link). */
async function setup() {
  const root = await t.call(t.admin.cookie, 'POST', '/api/projects', {
    customerName: 'Muster',
    name: 'Einführung',
    startDate: '2026-11-16',
  });
  const rootId = root.body.id as string;
  const plan = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
  const add = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${plan.version.id}/items`, { title: 'Analyse' });
  const hidden = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${plan.version.id}/items`, { title: 'Intern' });
  const hiddenItem = (hidden.body.plan as PlanPayload).items.find((i) => i.title === 'Intern')!;
  await t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${plan.version.id}/items/${hiddenItem.key}`, {
    rev: hiddenItem.rev,
    internal: true,
  });
  const members = (
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, {
      name: 'Lena Lead',
      email: `lena${Date.now()}@kunde.example`,
      roleIds: [t.role('cu_pl')],
    })
  ).body as Member[];
  const lena = members.find((m) => m.name === 'Lena Lead')!;
  const key = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { name: 'Kai Key', roleIds: [t.role('cu_ku')] }))
    .body as Member[];
  const kai = key.find((m) => m.name === 'Kai Key')!;
  return { rootId, workingId: plan.version.id, itemKey: add.body.key as string, hiddenKey: hiddenItem.key, lena, kai };
}

/** Opens a personal link like a browser: returns the session cookie and where it redirects. */
async function open(url: string) {
  const path = new URL(url).pathname;
  const res = await t.app.inject({ method: 'GET', url: path });
  const raw = res.headers['set-cookie'];
  const cookie = raw ? String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]! : null;
  return { status: res.statusCode, location: res.headers.location as string, cookie };
}

describe('personal links', () => {
  it('a link logs the customer in and opens the project; the same link can be shown again', async () => {
    const { rootId, lena } = await setup();
    const link = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink;
    expect(link.url).toMatch(/^http:\/\/localhost:43871\/k\/[\w-]{43}$/);
    expect((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body.url).toBe(link.url);

    const opened = await open(link.url);
    expect(opened.status).toBe(302);
    expect(opened.location).toBe(`/projects/${rootId}`);
    const me = await t.call(opened.cookie, 'GET', '/api/me');
    expect(me.body).toMatchObject({ kind: 'customer', name: 'Lena Lead' });
    expect((await t.call(opened.cookie, 'GET', '/api/projects')).body.map((p: { id: string }) => p.id)).toEqual([rootId]);

    const members = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members`)).body as Member[];
    expect(members.find((m) => m.userId === lena.userId)).toMatchObject({ hasLink: true });
    expect(members.find((m) => m.userId === lena.userId)!.linkLastUsedAt).not.toBeNull();
  });

  it('renewing stops the old link and ends sessions; removing the person locks them out', async () => {
    const { rootId, lena } = await setup();
    const old = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink;
    const session = await open(old.url);
    const renewed = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members/${lena.membershipId}/link/renew`))
      .body as MemberLink;
    expect(renewed.url).not.toBe(old.url);
    expect((await t.call(session.cookie, 'GET', '/api/me')).status).toBe(401);
    expect((await open(old.url)).location).toBe('/?link=invalid');
    const fresh = await open(renewed.url);
    expect(fresh.location).toBe(`/projects/${rootId}`);

    await t.call(t.admin.cookie, 'DELETE', `/api/projects/${rootId}/members/${lena.membershipId}`);
    expect((await t.call(fresh.cookie, 'GET', `/api/projects/${rootId}`)).status).toBe(404);
    expect((await open(renewed.url)).location).toBe('/?link=invalid');
  });

  it('only customer people get links; customer leads may hand them to their people', async () => {
    const { rootId, lena, kai } = await setup();
    const members = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members`)).body as Member[];
    const admin = members.find((m) => m.kind === 'staff')!;
    expect((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${admin.membershipId}/link`)).body.error).toBe(
      'link_only_for_customers',
    );
    const lenaLink = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink;
    const lenaSession = await open(lenaLink.url);
    expect((await t.call(lenaSession.cookie, 'GET', `/api/projects/${rootId}/members/${kai.membershipId}/link`)).status).toBe(200);
    const kaiLink = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${kai.membershipId}/link`)).body as MemberLink;
    const kaiSession = await open(kaiLink.url);
    expect((await t.call(kaiSession.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).status).toBe(403);
  });

  it('unknown links are slowed down', async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await t.app.inject({ method: 'GET', url: '/k/nope', remoteAddress: '10.9.9.9' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('customer view and review', () => {
  it('shows only shared versions, never internal tasks; reviews and comments a draft in review', async () => {
    const { rootId, workingId, itemKey, hiddenKey, lena, kai } = await setup();
    const lenaS = await open(
      ((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink).url,
    );
    const kaiS = await open(
      ((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${kai.membershipId}/link`)).body as MemberLink).url,
    );

    expect((await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan`)).body.error).toBe('plan_not_shared');
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${workingId}/visibility`, { customerVisible: true });
    let p = (await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
    expect(p.items.map((i) => i.title)).toEqual(['Analyse']);
    expect(p.rights).toMatchObject({ edit: false, review: false, comment: true, createDraft: false });

    // A draft handed over for review becomes visible and is what the customer sees first.
    const draft = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'Später live' }))
      .body as PlanVersionInfo;
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/visibility`, { customerVisible: false });
    expect(
      ((await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan/versions`)).body as PlanVersionInfo[]).map((v) => v.id),
    ).toEqual([workingId]);
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'in_review' });
    p = (await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
    expect(p.version.id).toBe(workingId);
    p = (await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan?version=${draft.id}&compare=${workingId}`)).body as PlanPayload;
    expect(p.rights.review).toBe(true);
    expect(p.compare).not.toBeNull();

    // Comments: customers never internal, never on internal tasks; Slimstock may write internal notes.
    expect(
      (await t.call(lenaS.cookie, 'POST', `/api/plan-versions/${draft.id}/comments`, { itemKey, text: 'Passt so', internal: true })).status,
    ).toBe(201);
    expect(
      (await t.call(lenaS.cookie, 'POST', `/api/plan-versions/${draft.id}/comments`, { itemKey: hiddenKey, text: 'x' })).body.error,
    ).toBe('unknown_item');
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/comments`, { text: 'Nur für uns', internal: true });
    p = (await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan?version=${draft.id}`)).body as PlanPayload;
    expect(p.comments.map((c) => [c.text, c.internal])).toEqual([['Passt so', false]]);
    expect((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan?version=${draft.id}`)).body.comments).toHaveLength(2);

    // Review: only the customer's lead; rejecting needs a reason.
    expect((await t.call(kaiS.cookie, 'POST', `/api/plan-versions/${draft.id}/review`, { verdict: 'approve' })).status).toBe(403);
    expect((await t.call(lenaS.cookie, 'POST', `/api/plan-versions/${draft.id}/review`, { verdict: 'reject' })).body.error).toBe(
      'reason_required',
    );
    await t.call(lenaS.cookie, 'POST', `/api/plan-versions/${draft.id}/review`, { verdict: 'reject', comment: 'Zu spät' });
    const v = (await t.call(lenaS.cookie, 'POST', `/api/plan-versions/${draft.id}/review`, { verdict: 'approve', comment: 'Doch ok' }))
      .body as PlanVersionInfo;
    expect(v.reviews.map((r) => [r.verdict, r.stale])).toEqual([['approve', false]]);

    // Taking it back hides it and voids the approval.
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'editing' });
    expect((await t.call(lenaS.cookie, 'GET', `/api/projects/${rootId}/plan?version=${draft.id}`)).status).toBe(403);
    const again = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan?version=${draft.id}`)).body as PlanPayload;
    expect(again.version.reviews.map((r) => r.stale)).toEqual([true]);
    expect((await t.call(lenaS.cookie, 'POST', `/api/plan-versions/${draft.id}/review`, { verdict: 'approve' })).status).toBe(404);
  });

  it('customers cannot change the plan or see bookings, and cannot delete others’ comments', async () => {
    const { rootId, workingId, itemKey, lena } = await setup();
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${workingId}/visibility`, { customerVisible: true });
    const s = await open(
      ((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink).url,
    );
    expect((await t.call(s.cookie, 'POST', `/api/plan-versions/${workingId}/items`, { title: 'x' })).status).toBe(403);
    expect((await t.call(s.cookie, 'PATCH', `/api/plan-versions/${workingId}/items/${itemKey}`, { rev: 1, title: 'x' })).status).toBe(403);
    expect((await t.call(s.cookie, 'POST', `/api/plan-versions/${workingId}/visibility`, { customerVisible: false })).status).toBe(403);
    expect((await t.call(s.cookie, 'POST', `/api/projects/${rootId}/effort-entries`, {})).status).toBe(403);
    const c = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${workingId}/comments`, { text: 'Von Slimstock' });
    expect((await t.call(s.cookie, 'DELETE', `/api/plan-comments/${c.body.id}`)).status).toBe(403);
    const own = await t.call(s.cookie, 'POST', `/api/plan-versions/${workingId}/comments`, { text: 'Meins' });
    expect((await t.call(s.cookie, 'DELETE', `/api/plan-comments/${own.body.id}`)).status).toBe(200);
    expect((await t.call(s.cookie, 'POST', '/api/me/password', { current: 'x', password: 'long-enough-pass' })).status).toBe(403);
  });
});
