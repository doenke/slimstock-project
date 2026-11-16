import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, runMigrations } from './db/index.js';
import { ensureAdmin, seedRoles } from './db/seed.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);
await seedRoles(db);
const { app } = await buildApp({ config, db });
await ensureAdmin(db, config, app.log);
app.addHook('onClose', async () => close());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
