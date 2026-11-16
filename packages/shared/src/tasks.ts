/**
 * Task list: open points and to-dos of a project (not versioned). Statuses are set per top-level
 * project; "done" is a check mark, not a status. Due groups as in the Shopping app.
 */

export interface TaskStatus {
  id: string;
  /** Own name; without one the default statuses are translated (tasks.status.<id>). */
  label: string | null;
}

export const DEFAULT_TASK_STATUSES: TaskStatus[] = [
  { id: 'new', label: null },
  { id: 'doing', label: null },
  { id: 'waiting', label: null },
];

export function taskStatusesOf(raw: unknown): TaskStatus[] {
  if (!Array.isArray(raw)) return DEFAULT_TASK_STATUSES;
  const out = raw
    .filter((s): s is { id: string; label?: unknown } => !!s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string')
    .map((s) => ({ id: s.id, label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : null }));
  return out.length ? out : DEFAULT_TASK_STATUSES;
}

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskLink {
  url: string;
  label: string | null;
}

export interface Task {
  id: string;
  /** The project or subproject the task belongs to. */
  projectId: string;
  title: string;
  description: string | null;
  statusId: string;
  due: string | null;
  priority: TaskPriority;
  area: string | null;
  assignees: string[];
  /** Linked plan task (key, valid in every version) and its title in the working version. */
  planItemKey: string | null;
  planItemTitle: string | null;
  internal: boolean;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  sort: number;
  links: TaskLink[];
  createdBy: string | null;
  createdAt: string;
  rev: number;
  /** May the current user change it (all fields) / only status, done and comments. */
  canEdit: boolean;
  commentCount: number;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  kind: 'staff' | 'customer';
  text: string;
  internal: boolean;
  at: string;
}

export type DueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none';
export const DUE_GROUPS: readonly DueGroup[] = ['overdue', 'today', 'week', 'later', 'none'];

/** Which due group a date falls in, seen from `today` ("YYYY-MM-DD"). */
export function dueGroup(due: string | null, today: string): DueGroup {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const week = new Date(`${today}T00:00:00Z`);
  week.setUTCDate(week.getUTCDate() + 7);
  return due <= week.toISOString().slice(0, 10) ? 'week' : 'later';
}
