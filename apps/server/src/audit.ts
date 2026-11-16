import type { DbOrTx } from './db/index.js';
import { auditLog } from './db/schema.js';

export interface AuditEntry {
  rootId: string;
  projectId?: string | null;
  userId: string | null;
  /** e.g. "task.created", "version.accepted" – the web app translates audit.<action>. */
  action: string;
  details?: Record<string, unknown>;
  /** Only for Slimstock (default). Mark false only for what customers may see anyway. */
  internal?: boolean;
}

/** Writes a change-log entry. Never lets the actual change fail. */
export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      rootId: entry.rootId,
      projectId: entry.projectId ?? entry.rootId,
      userId: entry.userId,
      action: entry.action,
      details: entry.details ?? {},
      internal: entry.internal ?? true,
    });
  } catch {
    // The log is a convenience; the change itself already happened.
  }
}

/** Version label for log entries ("V3 Go-live später"). */
export const versionLabel = (v: { no: number; name: string }) => `V${v.no}${v.name ? ` ${v.name}` : ''}`;
