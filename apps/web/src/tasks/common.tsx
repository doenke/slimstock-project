import { dueGroup, today, type Task, type TaskStatus } from '@spm/shared';
import type { TFunction } from 'i18next';
import { formatDate } from '../format';

export function statusLabel(t: TFunction, statuses: TaskStatus[], id: string): string {
  const s = statuses.find((x) => x.id === id);
  return s?.label ?? t(`tasks.status.${id}`, { defaultValue: id });
}

/** Due date with its urgency (overdue red, today orange). */
export function DueDate({ due, done }: { due: string | null; done?: boolean }) {
  if (!due) return null;
  const g = done ? 'none' : dueGroup(due, today());
  return <span className={`due due-${g}`}>{formatDate(due)}</span>;
}

export function PriorityMark({ task }: { task: Pick<Task, 'priority'> }) {
  if (task.priority === 'normal') return null;
  return (
    <span className={`prio prio-${task.priority}`} aria-hidden="true">
      {task.priority === 'high' ? '▲' : '▽'}
    </span>
  );
}
