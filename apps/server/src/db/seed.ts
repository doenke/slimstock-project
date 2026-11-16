import { DEFAULT_ROLES } from '@spm/shared';
import { count, eq } from 'drizzle-orm';
import { hashPassword } from '../auth/password.js';
import type { Config } from '../config.js';
import type { Db } from './index.js';
import { projectRoles, users } from './schema.js';

/** The default project roles, on the very first start only (afterwards admins own the list). */
export async function seedRoles(db: Db): Promise<void> {
  const [row] = await db.select({ n: count() }).from(projectRoles);
  if (row && row.n > 0) return;
  await db.insert(projectRoles).values(
    DEFAULT_ROLES.map((r, i) => ({
      key: r.key,
      side: r.side,
      names: r.names,
      calculated: r.calculated,
      defaultPermission: r.defaultPermission,
      sort: i,
    })),
  );
}

/** Creates the first admin from ADMIN_USERNAME/ADMIN_PASSWORD when there is no staff user yet. */
export async function ensureAdmin(db: Db, config: Config, log: { info: (msg: string) => void; warn: (msg: string) => void }) {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.kind, 'staff'));
  if (row && row.n > 0) return;
  if (!config.ADMIN_USERNAME || !config.ADMIN_PASSWORD) {
    log.warn('Noch kein Benutzer vorhanden: ADMIN_USERNAME und ADMIN_PASSWORD setzen, um den ersten Admin anzulegen.');
    return;
  }
  await db.insert(users).values({
    kind: 'staff',
    username: config.ADMIN_USERNAME.toLowerCase(),
    name: config.ADMIN_USERNAME,
    passwordHash: await hashPassword(config.ADMIN_PASSWORD),
    mustChangePassword: true,
    isAdmin: true,
  });
  log.info(`Erster Admin „${config.ADMIN_USERNAME}“ angelegt – beim ersten Login muss das Passwort geändert werden.`);
}
