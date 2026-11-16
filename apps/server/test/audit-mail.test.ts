import type { AuditRow, Member, MemberLink, PlanPayload, PlanVersionInfo, TaskList } from '@spm/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await t.db.update(users).set({ email: 'admin@slimstock.example', name: 'Anna Admin' }).where(eq(users.id, t.admin.id));
});
afterAll(async () => t.close());

let n = 0;
async function setup() {
  const root = await t.call(t.admin.cookie, 'POST', '/api/projects', { customerName: 'Muster', name: `Projekt ${++n}`, language: 'de' });
  const rootId = root.body.id as string;
  const members = (
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, {
      name: 'Lena Lead',
      email: `lena${n}@kunde.example`,
      roleIds: [t.role('cu_pl')],
    })
  ).body as Member[];
  const lena = members.find((m) => m.name === 'Lena Lead')!;
  return { rootId, lena };
}

async function openLink(url: string) {
  const u = new URL(url);
  const res = await t.app.inject({ method: 'GET', url: u.pathname + u.search });
  return { location: res.headers.location as string, cookie: String(res.headers['set-cookie']).split(';')[0]! };
}

describe('change log', () => {
  it('records who changed what; customers only see what is shared with them', async () => {
    const { rootId, lena } = await setup();
    const plan = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
    const item = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${plan.version.id}/items`, { title: 'Analyse' });
    const it0 = (item.body.plan as PlanPayload).items[0]!;
    await t.call(t.admin.cookie, 'PATCH', `/api/plan-versions/${plan.version.id}/items/${it0.key}`, {
      rev: it0.rev,
      progress: 30,
      pm: { dur: { v: 960, src: 'set' } },
    });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/tasks`, { title: 'Daten liefern' });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/tasks`, { title: 'Geheim', internal: true });

    const log = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/audit`)).body as AuditRow[];
    expect(log.map((r) => r.action)).toEqual([
      'task.created',
      'task.created',
      'plan.itemUpdated',
      'plan.itemCreated',
      'member.added',
      'project.created',
    ]);
    expect(log[2]).toMatchObject({
      userName: 'Anna Admin',
      details: { title: 'Analyse', version: 'V1', fields: expect.arrayContaining(['progress', 'dates']) },
    });

    const link = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink;
    const s = await openLink(link.url);
    // The plan is not shared yet, internal tasks never.
    const seen = (await t.call(s.cookie, 'GET', `/api/projects/${rootId}/audit`)).body as AuditRow[];
    expect(seen.map((r) => [r.action, r.details.title ?? r.details.name])).toEqual([
      ['task.created', 'Daten liefern'],
      ['member.added', 'Lena Lead'],
      ['project.created', `Projekt ${n}`],
    ]);
    expect(
      ((await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/audit?area=plan`)).body as AuditRow[]).every((r) =>
        r.action.startsWith('plan.'),
      ),
    ).toBe(true);
  });
});

describe('notifications', () => {
  it('a draft for review mails the customer lead a personal link straight to it; the verdict mails Slimstock', async () => {
    const { rootId } = await setup();
    t.mails.length = 0;
    const draft = (await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/plan/versions`, { name: 'Später live' }))
      .body as PlanVersionInfo;
    await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${draft.id}/status`, { status: 'in_review' });
    await t.sent();
    expect(t.mails).toHaveLength(1);
    const mail = t.mails[0]!;
    expect(mail).toMatchObject({ to: `lena${n}@kunde.example` });
    expect(mail.subject).toContain('V2 Später live');
    expect(mail.text).toContain('Hallo Lena Lead');
    const url = mail.text.match(/http:\/\/localhost:43871\/k\/\S+/)![0];
    const opened = await openLink(url);
    expect(opened.location).toBe(`/projects/${rootId}?tab=plan&version=${draft.id}`);

    t.mails.length = 0;
    await t.call(opened.cookie, 'POST', `/api/plan-versions/${draft.id}/review`, { verdict: 'reject', comment: 'Zu spät für uns' });
    await t.sent();
    expect(t.mails.map((m) => m.to)).toEqual(['admin@slimstock.example']);
    expect(t.mails[0]!.text).toContain('Zu spät für uns');
    expect(t.mails[0]!.text).toContain(`http://localhost:43871/projects/${rootId}?tab=plan&version=${draft.id}`);
  });

  it('assigning a task mails the new people, not the one who assigned; opting out stops mails', async () => {
    const { rootId, lena } = await setup();
    t.mails.length = 0;
    const res = await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/tasks`, {
      title: 'Testzugang',
      assignees: [lena.userId, t.admin.id],
      due: '2026-11-20',
    });
    await t.sent();
    expect(t.mails.map((m) => m.to)).toEqual([`lena${n}@kunde.example`]);
    expect(t.mails[0]!.text).toContain('Testzugang');

    // Internal tasks never reach customers.
    t.mails.length = 0;
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/tasks`, { title: 'Intern', assignees: [lena.userId], internal: true });
    await t.sent();
    expect(t.mails).toEqual([]);

    // Only newly added people get a mail when a task changes.
    const team = await t.createUser(`team${n}`, { email: `team${n}@slimstock.example` });
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: team.id, roleIds: [t.role('ss_c')] });
    const task = (res.body.list as TaskList).tasks.find((x) => x.title === 'Testzugang')!;
    await t.call(t.admin.cookie, 'PATCH', `/api/tasks/${task.id}`, { rev: task.rev, assignees: [lena.userId, team.id] });
    await t.sent();
    expect(t.mails.map((m) => m.to)).toEqual([`team${n}@slimstock.example`]);
    expect(t.mails[0]!.text).toContain(`/projects/${rootId}?tab=tasks&task=${task.id}`);

    t.mails.length = 0;
    expect((await t.call(team.cookie, 'PATCH', '/api/me', { notify: false })).body.notify).toBe(false);
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/tasks`, { title: 'Noch eine', assignees: [team.id] });
    await t.sent();
    expect(t.mails).toEqual([]);
  });

  it('only follows links to project pages after opening a personal link', async () => {
    const { rootId, lena } = await setup();
    const link = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/members/${lena.membershipId}/link`)).body as MemberLink;
    expect((await openLink(`${link.url}?next=${encodeURIComponent('https://evil.example')}`)).location).toBe(`/projects/${rootId}`);
    expect((await openLink(`${link.url}?next=${encodeURIComponent('//evil.example/x')}`)).location).toBe(`/projects/${rootId}`);
  });

  it('admins can send a test mail', async () => {
    t.mails.length = 0;
    expect((await t.call(t.admin.cookie, 'POST', '/api/admin/test-mail')).body).toEqual({ ok: true, to: 'admin@slimstock.example' });
    expect(t.mails[0]!.to).toBe('admin@slimstock.example');
    expect((await t.call(null, 'GET', '/api/config')).body.mail).toBe(true);
  });
});
