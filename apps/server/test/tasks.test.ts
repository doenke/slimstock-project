import type { MyTask, PlanPayload, TaskList } from '@spm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

let n = 0;
async function setup() {
  const root = await t.call(t.admin.cookie, 'POST', '/api/projects', { customerName: 'Muster', name: `Einführung ${++n}` });
  const rootId = root.body.id as string;
  const sub = await t.call(t.admin.cookie, 'POST', '/api/projects', { parentId: rootId, name: 'Schnittstellen' });
  const people = {
    lead: await t.createUser(`lead${n}`, { kind: 'customer' }),
    key: await t.createUser(`key${n}`, { kind: 'customer' }),
    reader: await t.createUser(`reader${n}`, { kind: 'customer' }),
    team: await t.createUser(`team${n}`),
  };
  for (const [u, role] of [
    [people.lead, 'cu_pl'],
    [people.key, 'cu_ku'],
    [people.reader, 'cu_u'],
    [people.team, 'ss_c'],
  ] as const) {
    await t.call(t.admin.cookie, 'POST', `/api/projects/${rootId}/members`, { userId: u.id, roleIds: [t.role(role)] });
  }
  return { rootId, subId: sub.body.id as string, ...people };
}

const create = async (cookie: string, projectId: string, body: Record<string, unknown>) =>
  t.call(cookie, 'POST', `/api/projects/${projectId}/tasks`, body);
const list = async (cookie: string, projectId: string) =>
  (await t.call(cookie, 'GET', `/api/projects/${projectId}/tasks`)).body as TaskList;

describe('tasks', () => {
  it('creates tasks with defaults; subproject tasks show on the project and on the subproject', async () => {
    const { rootId, subId, key } = await setup();
    const a = await create(t.admin.cookie, rootId, { title: 'Testzugang einrichten', due: '2026-11-20', assignees: [key.id] });
    expect(a.status).toBe(201);
    const b = await create(t.admin.cookie, rootId, { title: 'Schnittstelle dokumentieren', projectId: subId });
    const all = b.body.list as TaskList;
    expect(all.tasks.map((x) => x.title)).toEqual(['Testzugang einrichten', 'Schnittstelle dokumentieren']);
    expect(all.tasks[0]).toMatchObject({
      statusId: 'new',
      priority: 'normal',
      due: '2026-11-20',
      assignees: [key.id],
      done: false,
      canEdit: true,
    });
    expect(all.statuses.map((s) => s.id)).toEqual(['new', 'doing', 'waiting']);
    expect((await list(t.admin.cookie, subId)).tasks.map((x) => x.title)).toEqual(['Schnittstelle dokumentieren']);
  });

  it('hides internal tasks from customers; customers cannot create internal ones', async () => {
    const { rootId, lead } = await setup();
    await create(t.admin.cookie, rootId, { title: 'Intern', internal: true });
    await create(t.admin.cookie, rootId, { title: 'Offen' });
    expect((await list(lead.cookie, rootId)).tasks.map((x) => x.title)).toEqual(['Offen']);
    expect((await create(lead.cookie, rootId, { title: 'x', internal: true })).status).toBe(403);
  });

  it('who may change what: lead all, key users their own, readers nothing', async () => {
    const { rootId, lead, key, reader } = await setup();
    const res = await create(t.admin.cookie, rootId, { title: 'Für Kai', assignees: [key.id] });
    const other = await create(t.admin.cookie, rootId, { title: 'Für niemanden' });
    const forKai = (other.body.list as TaskList).tasks.find((x) => x.title === 'Für Kai')!;
    const nobody = (other.body.list as TaskList).tasks.find((x) => x.title === 'Für niemanden')!;
    expect(res.status).toBe(201);

    const asKey = await list(key.cookie, rootId);
    expect(asKey.tasks.find((x) => x.id === forKai.id)!.canEdit).toBe(true);
    expect(asKey.tasks.find((x) => x.id === nobody.id)!.canEdit).toBe(false);
    const done = await t.call(key.cookie, 'PATCH', `/api/tasks/${forKai.id}`, { rev: forKai.rev, done: true, statusId: 'doing' });
    expect((done.body as TaskList).tasks.find((x) => x.id === forKai.id)).toMatchObject({ done: true, doneBy: key.id, statusId: 'doing' });
    expect((await t.call(key.cookie, 'PATCH', `/api/tasks/${nobody.id}`, { rev: nobody.rev, done: true })).status).toBe(403);
    // Key users may create; their own tasks are theirs to change.
    const mine = await create(key.cookie, rootId, { title: 'Von Kai' });
    expect((mine.body.list as TaskList).tasks.find((x) => x.title === 'Von Kai')!.canEdit).toBe(true);

    expect((await t.call(lead.cookie, 'PATCH', `/api/tasks/${nobody.id}`, { rev: nobody.rev, title: 'Neu' })).status).toBe(200);
    expect((await create(reader.cookie, rootId, { title: 'x' })).status).toBe(403);
    expect((await t.call(reader.cookie, 'PATCH', `/api/tasks/${nobody.id}`, { rev: 2, done: true })).status).toBe(403);
    expect((await t.call(reader.cookie, 'POST', `/api/tasks/${nobody.id}/comments`, { text: 'x' })).status).toBe(403);
    // Deleting: Slimstock or the creator.
    expect((await t.call(lead.cookie, 'DELETE', `/api/tasks/${nobody.id}`)).status).toBe(403);
    expect((await t.call(key.cookie, 'DELETE', `/api/tasks/${mine.body.id}`)).status).toBe(200);
  });

  it('rejects stale changes, unknown statuses and strangers as assignees', async () => {
    const { rootId } = await setup();
    const res = await create(t.admin.cookie, rootId, { title: 'A' });
    const task = (res.body.list as TaskList).tasks[0]!;
    await t.call(t.admin.cookie, 'PATCH', `/api/tasks/${task.id}`, { rev: task.rev, title: 'B' });
    expect((await t.call(t.admin.cookie, 'PATCH', `/api/tasks/${task.id}`, { rev: task.rev, title: 'C' })).body.error).toBe('conflict');
    expect((await create(t.admin.cookie, rootId, { title: 'x', statusId: 'nope' })).body.error).toBe('unknown_status');
    const stranger = await t.createUser(`s${Date.now()}`);
    expect((await create(t.admin.cookie, rootId, { title: 'x', assignees: [stranger.id] })).body.error).toBe('assignee_not_member');
    expect((await create(t.admin.cookie, rootId, { title: 'x', links: [{ url: 'javascript:alert(1)' }] })).status).toBe(201);
    const bad = await t.call(t.admin.cookie, 'PATCH', `/api/tasks/${task.id}`, {
      rev: task.rev + 1,
      links: [{ url: 'javascript:alert(1)' }],
    });
    expect(bad.status).toBe(400);
  });

  it('own statuses per project; removed statuses move tasks to the first one', async () => {
    const { rootId, team } = await setup();
    await create(t.admin.cookie, rootId, { title: 'A', statusId: 'waiting' });
    expect((await t.call(team.cookie, 'PUT', `/api/projects/${rootId}/task-statuses`, { statuses: [{ id: 'x' }] })).status).toBe(403);
    const res = await t.call(t.admin.cookie, 'PUT', `/api/projects/${rootId}/task-statuses`, {
      statuses: [
        { id: 'todo', label: 'Zu tun' },
        { id: 'doing', label: null },
      ],
    });
    const l = res.body as TaskList;
    expect(l.statuses).toEqual([
      { id: 'todo', label: 'Zu tun' },
      { id: 'doing', label: null },
    ]);
    expect(l.tasks[0]!.statusId).toBe('todo');
  });

  it('links to plan tasks and shows them in the plan; comments with internal notes', async () => {
    const { rootId, lead } = await setup();
    const plan = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
    const item = await t.call(t.admin.cookie, 'POST', `/api/plan-versions/${plan.version.id}/items`, { title: 'Datenanalyse' });
    const res = await create(t.admin.cookie, rootId, { title: 'Daten liefern', planItemKey: item.body.key });
    const task = (res.body.list as TaskList).tasks[0]!;
    expect(task).toMatchObject({ planItemKey: item.body.key, planItemTitle: 'Datenanalyse' });
    const p = (await t.call(t.admin.cookie, 'GET', `/api/projects/${rootId}/plan`)).body as PlanPayload;
    expect(p.linkedTasks).toMatchObject([{ id: task.id, title: 'Daten liefern', planItemKey: item.body.key }]);
    expect((await create(t.admin.cookie, rootId, { title: 'x', planItemKey: lead.id })).body.error).toBe('unknown_item');

    await t.call(t.admin.cookie, 'POST', `/api/tasks/${task.id}/comments`, { text: 'Nur intern', internal: true });
    await t.call(lead.cookie, 'POST', `/api/tasks/${task.id}/comments`, { text: 'Kommt Freitag', internal: true });
    expect((await list(lead.cookie, rootId)).comments.map((c) => [c.text, c.internal])).toEqual([['Kommt Freitag', false]]);
    expect((await list(t.admin.cookie, rootId)).tasks[0]!.commentCount).toBe(2);
  });

  it('"my tasks" lists open tasks assigned to me in all projects', async () => {
    const a = await setup();
    const b = await setup();
    // The same customer person in both projects.
    await t.call(t.admin.cookie, 'POST', `/api/projects/${b.rootId}/members`, { userId: a.key.id, roleIds: [t.role('cu_ku')] });
    await create(t.admin.cookie, a.rootId, { title: 'Eins', assignees: [a.key.id], due: '2026-11-18' });
    await create(t.admin.cookie, b.rootId, { title: 'Zwei', assignees: [a.key.id], due: '2026-11-17' });
    await create(t.admin.cookie, b.rootId, { title: 'Intern', assignees: [a.key.id], internal: true });
    const done = await create(t.admin.cookie, b.rootId, { title: 'Erledigt', assignees: [a.key.id] });
    const d = (done.body.list as TaskList).tasks.find((x) => x.title === 'Erledigt')!;
    await t.call(t.admin.cookie, 'PATCH', `/api/tasks/${d.id}`, { rev: d.rev, done: true });
    const mine = (await t.call(a.key.cookie, 'GET', '/api/my-tasks')).body as MyTask[];
    expect(mine.map((x) => [x.title, x.rootName])).toEqual([
      ['Zwei', `Einführung ${n}`],
      ['Eins', `Einführung ${n - 1}`],
    ]);
  });
});
