import { LANGUAGES } from '@spm/shared';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const optional = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(43871),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Address as seen in the browser, e.g. https://projekte.example.org */
  PUBLIC_URL: z
    .string()
    .url()
    .transform((u) => u.replace(/\/$/, '')),
  /** Signs the session cookie. */
  SESSION_KEY: z.string().min(32, 'mindestens 32 Zeichen, z. B. `openssl rand -base64 32`'),
  /** Encrypts the customers' personal links (so they can be shown again). Default: derived from SESSION_KEY. */
  LINK_KEY: optional,
  /** First admin, created on the first start when there are no users yet. */
  ADMIN_USERNAME: optional,
  ADMIN_PASSWORD: optional,
  DEFAULT_LANGUAGE: z.enum(LANGUAGES).default('de'),
  /** Trust X-Forwarded-* only behind a reverse proxy. */
  TRUSTED_PROXY: bool,
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Konfiguration:\n${issues}`);
  }
  return parsed.data;
}
