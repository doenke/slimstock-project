import {
  CreateTaskInput,
  TaskCommentInput,
  TaskStatusesInput,
  UpdateTaskInput,
  rightsOf,
  taskStatusesOf,
  type MyTask,
  type PermissionLevel,
  type Task,
  type TaskList,
} from '@spm/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { SessionUser } from '../auth/sessions.js';
import type { Db, DbOrTx } from '../db/index.js';
import { memberships, planItems, planVersions, projects, taskComments, tasks, users } from '../db/schema.js';
import { chainOf, levelsForUser, loadTree, type ProjectNode } from './access.js';
import { ApiError, forbidden, notFound, parse } from './errors.js';
import { subprojectIds } from './plan.js';

type TaskRow = typeof tasks.$inferSelect;

const rootOf = (tree: Map<string, ProjectNode>, id: string) => chainOf(tree, id).at(-1)!;

/** What a user may do with one task, from their level in the task's project. */
function taskRights(
  level: PermissionLevel | null | undefined,
  task: Pick<TaskRow, 'internal' | 'createdBy' | 'assignees'>,
  user: SessionUser,
) {
  const r = rightsOf(level ?? null);
  const see = r.view && (!task.internal || r.viewInternal);
  const own = task.createdBy === user.id || task.assignees.includes(user.id);
  const edit = see && (r.editPlan || level === 'pl_customer' || (level === 'team_customer' && own));
  return { see, edit, delete: see && (r.editPlan || task.createdBy === user.id), comment: see && r.comment };
}

async function context(db: DbOrTx, user: SessionUser, projectId: string) {
  const tree = await loadTree(db);
  if (!tree.has(projectId)) throw notFound();
  const levels = await levelsForUser(db, user, tree);
  if (!levels.has(projectId)) throw notFound();
  const rootId = rootOf(tree, projectId);
  const [root] = await db.select().from(projects).where(eq(projects.id, rootId));
  return { tree, levels, rootId, root: root! };
}

/** Titles of plan tasks in the working version (internal ones only for Slimstock). */
async function planTitles(db: DbOrTx, rootId: string, internalOk: boolean) {
  const rows = await db
    .select({ key: planItems.key, title: planItems.title, internal: planItems.internal, sort: planItems.sort })
    .from(planItems)
    .innerJoin(planVersions, eq(planVersions.id, planItems.versionId))
    .where(and(eq(planVersions.projectId, rootId), eq(planVersions.kind, 'working')))
    .orderBy(asc(planItems.sort));
  return rows.filter((r) => internalOk || !r.internal);
}

function toTask(r: TaskRow, canEdit: boolean, planTitle: string | null, commentCount: number): Task {
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title,
    description: r.description,
    statusId: r.statusId,
    due: r.due,
    priority: r.priority,
    area: r.area,
    assignees: r.assignees,
    planItemKey: r.planItemKey,
    planItemTitle: planTitle,
    internal: r.internal,
    done: r.done,
    doneAt: r.doneAt?.toISOString() ?? null,
    doneBy: r.doneBy,
    sort: r.sort,
    links: r.links,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    rev: r.rev,
    canEdit,
    commentCount,
  };
}

/** Everyone on the project tree (for "who"). */
async function treePeople(db: DbOrTx, ids: string[]) {
  const rows = await db
    .selectDistinct({ userId: users.id, name: users.name, kind: users.kind })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(inArray(memberships.projectId, ids));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function taskRoutes(app: FastifyInstance, { db }: { db: Db }) {
  async function list(user: SessionUser, projectId: string): Promise<TaskList> {
    const { tree, levels, rootId, root } = await context(db, user, projectId);
    // On a subproject: its tasks and those of its own subprojects.
    const scope = [...tree.keys()].filter((id) => chainOf(tree, id).includes(projectId));
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.rootId, rootId), inArray(tasks.projectId, scope)))
      .orderBy(asc(tasks.sort), asc(tasks.createdAt));
    const visible = rows.map((r) => ({ r, rights: taskRights(levels.get(r.projectId), r, user) })).filter((x) => x.rights.see);
    const ids = visible.map((x) => x.r.id);
    const internalOk = [...levels.values()].some((l) => rightsOf(l).viewInternal);
    const comments = ids.length
      ? (
          await db
            .select({ c: taskComments, userName: users.name, kind: users.kind })
            .from(taskComments)
            .innerJoin(users, eq(users.id, taskComments.userId))
            .where(inArray(taskComments.taskId, ids))
            .orderBy(asc(taskComments.createdAt))
        )
          .filter(({ c }) => internalOk || !c.internal)
          .map(({ c, userName, kind }) => ({
            id: c.id,
            taskId: c.taskId,
            userId: c.userId,
            userName,
            kind,
            text: c.text,
            internal: c.internal,
            at: c.createdAt.toISOString(),
          }))
      : [];
    const titles = await planTitles(db, rootId, internalOk);
    const titleOf = new Map(titles.map((t) => [t.key, t.title]));
    const projectRows = await db
      .select({ id: projects.id, name: projects.name, parentId: projects.parentId })
      .from(projects)
      .where(
        inArray(
          projects.id,
          scope.filter((id) => levels.has(id)),
        ),
      );
    const level = levels.get(projectId) ?? null;
    const r = rightsOf(level);
    return {
      rootId,
      statuses: taskStatusesOf(root.settings.taskStatuses),
      tasks: visible.map(({ r: t, rights }) =>
        toTask(
          t,
          rights.edit,
          t.planItemKey ? (titleOf.get(t.planItemKey) ?? null) : null,
          comments.filter((c) => c.taskId === t.id).length,
        ),
      ),
      comments,
      people: await treePeople(db, [rootId, ...subprojectIds(tree, rootId)]),
      projects: projectRows.sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.name.localeCompare(b.name))),
      planItems: titles.map(({ key, title }) => ({ key, title })),
      rights: {
        create: r.editTasks,
        editAll: r.editPlan || level === 'pl_customer',
        internal: r.viewInternal,
        editStatuses: rightsOf(levels.get(rootId) ?? null).editProject,
        comment: r.comment,
      },
    };
  }

  /** Checks the target project, statuses, people and plan link of new or changed task data. */
  async function validate(
    user: SessionUser,
    ctx: Awaited<ReturnType<typeof context>>,
    input: { projectId?: string; statusId?: string; assignees?: string[]; planItemKey?: string | null; internal?: boolean },
  ) {
    if (input.projectId) {
      if (!ctx.tree.has(input.projectId) || rootOf(ctx.tree, input.projectId) !== ctx.rootId) throw new ApiError(400, 'unknown_subproject');
      if (!rightsOf(ctx.levels.get(input.projectId) ?? null).editTasks) throw forbidden();
    }
    if (input.statusId && !taskStatusesOf(ctx.root.settings.taskStatuses).some((s) => s.id === input.statusId))
      throw new ApiError(400, 'unknown_status');
    if (input.assignees?.length) {
      const ids = [...new Set(input.assignees)];
      const known = await db
        .selectDistinct({ userId: memberships.userId })
        .from(memberships)
        .where(and(inArray(memberships.projectId, [ctx.rootId, ...subprojectIds(ctx.tree, ctx.rootId)]), inArray(memberships.userId, ids)));
      if (known.length !== ids.length) throw new ApiError(400, 'assignee_not_member');
    }
    if (input.planItemKey) {
      const internalOk = [...ctx.levels.values()].some((l) => rightsOf(l).viewInternal);
      if (!(await planTitles(db, ctx.rootId, internalOk)).some((p) => p.key === input.planItemKey)) throw new ApiError(400, 'unknown_item');
    }
    if (input.internal && user.kind !== 'staff') throw forbidden();
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/tasks', async (request) => list(request.user, request.params.id));

  app.post<{ Params: { id: string } }>('/api/projects/:id/tasks', async (request, reply) => {
    const ctx = await context(db, request.user, request.params.id);
    const input = parse(CreateTaskInput, request.body);
    const projectId = input.projectId ?? request.params.id;
    if (!rightsOf(ctx.levels.get(projectId) ?? null).editTasks) throw forbidden();
    await validate(request.user, ctx, { ...input, projectId });
    const statuses = taskStatusesOf(ctx.root.settings.taskStatuses);
    const [last] = await db
      .select({ sort: sql<number>`coalesce(max(${tasks.sort}), 0)` })
      .from(tasks)
      .where(eq(tasks.rootId, ctx.rootId));
    const [row] = await db
      .insert(tasks)
      .values({
        ...input,
        projectId,
        rootId: ctx.rootId,
        statusId: input.statusId ?? statuses[0]!.id,
        assignees: [...new Set(input.assignees)],
        internal: input.internal && request.user.kind === 'staff',
        sort: (last?.sort ?? 0) + 1024,
        createdBy: request.user.id,
      })
      .returning({ id: tasks.id });
    return reply.code(201).send({ id: row!.id, list: await list(request.user, request.params.id) });
  });

  app.patch<{ Params: { tid: string }; Querystring: { view?: string } }>('/api/tasks/:tid', async (request) => {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, request.params.tid));
    if (!task) throw notFound();
    const ctx = await context(db, request.user, task.projectId).catch(() => {
      throw notFound();
    });
    const rights = taskRights(ctx.levels.get(task.projectId), task, request.user);
    if (!rights.see) throw notFound();
    if (!rights.edit) throw forbidden();
    const input = parse(UpdateTaskInput, request.body);
    if (input.rev !== task.rev) throw new ApiError(409, 'conflict');
    if (input.internal !== undefined && request.user.kind !== 'staff') throw forbidden();
    await validate(request.user, ctx, input);
    const { rev: _rev, done, ...fields } = input;
    await db
      .update(tasks)
      .set({
        ...fields,
        ...(fields.assignees && { assignees: [...new Set(fields.assignees)] }),
        ...(done !== undefined && done !== task.done && { done, doneAt: done ? new Date() : null, doneBy: done ? request.user.id : null }),
        rev: task.rev + 1,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id));
    return list(request.user, request.query.view ?? task.projectId);
  });

  app.delete<{ Params: { tid: string }; Querystring: { view?: string } }>('/api/tasks/:tid', async (request) => {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, request.params.tid));
    if (!task) throw notFound();
    const ctx = await context(db, request.user, task.projectId);
    const rights = taskRights(ctx.levels.get(task.projectId), task, request.user);
    if (!rights.see) throw notFound();
    if (!rights.delete) throw forbidden();
    await db.delete(tasks).where(eq(tasks.id, task.id));
    return list(request.user, request.query.view ?? ctx.rootId);
  });

  app.post<{ Params: { tid: string } }>('/api/tasks/:tid/comments', async (request, reply) => {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, request.params.tid));
    if (!task) throw notFound();
    const ctx = await context(db, request.user, task.projectId);
    const rights = taskRights(ctx.levels.get(task.projectId), task, request.user);
    if (!rights.see) throw notFound();
    if (!rights.comment) throw forbidden();
    const input = parse(TaskCommentInput, request.body);
    const [row] = await db
      .insert(taskComments)
      .values({ taskId: task.id, userId: request.user.id, text: input.text, internal: input.internal && request.user.kind === 'staff' })
      .returning({ id: taskComments.id });
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { cid: string } }>('/api/task-comments/:cid', async (request) => {
    const [row] = await db
      .select({ c: taskComments, task: tasks })
      .from(taskComments)
      .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
      .where(eq(taskComments.id, request.params.cid));
    if (!row) throw notFound();
    const ctx = await context(db, request.user, row.task.projectId);
    if (row.c.userId !== request.user.id && !rightsOf(ctx.levels.get(ctx.rootId) ?? null).editProject) throw forbidden();
    await db.delete(taskComments).where(eq(taskComments.id, row.c.id));
    return { ok: true };
  });

  /** Statuses of a project's task list; tasks in a removed status move to the first one. */
  app.put<{ Params: { id: string } }>('/api/projects/:id/task-statuses', async (request) => {
    const ctx = await context(db, request.user, request.params.id);
    if (!rightsOf(ctx.levels.get(ctx.rootId) ?? null).editProject) throw forbidden();
    const { statuses } = parse(TaskStatusesInput, request.body);
    if (new Set(statuses.map((s) => s.id)).size !== statuses.length) throw new ApiError(400, 'validation');
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ settings: { ...ctx.root.settings, taskStatuses: statuses } })
        .where(eq(projects.id, ctx.rootId));
      const ids = statuses.map((s) => s.id);
      await tx
        .update(tasks)
        .set({ statusId: statuses[0]!.id })
        .where(
          and(
            eq(tasks.rootId, ctx.rootId),
            sql`${tasks.statusId} NOT IN (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          ),
        );
    });
    return list(request.user, request.params.id);
  });

  /** Open tasks assigned to me, in all projects I can see. */
  app.get('/api/my-tasks', async (request): Promise<MyTask[]> => {
    const user = request.user;
    const tree = await loadTree(db);
    const levels = await levelsForUser(db, user, tree);
    if (!levels.size) return [];
    const rows = await db
      .select({ t: tasks, projectName: projects.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.done, false), sql`${tasks.assignees} @> ${JSON.stringify([user.id])}::jsonb`))
      .orderBy(asc(tasks.due), asc(tasks.sort));
    const roots = new Map(
      (
        await db
          .select({ id: projects.id, name: projects.name, settings: projects.settings })
          .from(projects)
          .where(sql`${projects.parentId} IS NULL`)
      ).map((p) => [p.id, p]),
    );
    return rows
      .filter(({ t }) => taskRights(levels.get(t.projectId), t, user).see)
      .map(({ t, projectName }) => {
        const root = roots.get(t.rootId);
        return {
          ...toTask(t, taskRights(levels.get(t.projectId), t, user).edit, null, 0),
          projectName,
          rootId: t.rootId,
          rootName: root?.name ?? '',
          statusLabel: taskStatusesOf(root?.settings.taskStatuses).find((s) => s.id === t.statusId)?.label ?? null,
        };
      });
  });
}
