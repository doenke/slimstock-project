import { isLanguage, rightsOf, type Language } from '@spm/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import { chainOf, levelsForUser, loadTree } from './api/access.js';
import { LinkBox } from './auth/links.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { memberships, planVersions, projects, tasks, users } from './db/schema.js';
import { translator } from './i18n.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Sends mails through the SMTP server from the environment; without SMTP_HOST it does nothing. */
export function smtpMailer(config: Config): Mailer {
  if (!config.SMTP_HOST) return { enabled: false, send: async () => {} };
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } : undefined,
  });
  const from = config.SMTP_FROM ?? config.SMTP_USER ?? `projekte@${new URL(config.PUBLIC_URL).hostname}`;
  return {
    enabled: true,
    send: async (m) => {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

type Recipient = { id: string; name: string; email: string | null; kind: 'staff' | 'customer'; language: Language | null; notify: boolean };

/**
 * Notifications by mail. They run in the background: a failing mail server never makes a change fail.
 * Customers get their personal link in the mail (pointing at the right page), Slimstock a normal link.
 */
export class Notifier {
  private pending = new Set<Promise<void>>();
  private box: LinkBox;

  constructor(
    private db: Db,
    private config: Config,
    private mailer: Mailer,
    private log: FastifyBaseLogger,
  ) {
    this.box = new LinkBox(config.LINK_KEY ?? config.SESSION_KEY);
  }

  get enabled(): boolean {
    return this.mailer.enabled;
  }

  /** Waits for mails still being sent (tests). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private run(job: () => Promise<void>): void {
    if (!this.mailer.enabled) return;
    const p = job()
      .catch((e) => this.log.warn({ err: e }, 'notification failed'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** A link to a page: Slimstock people log in normally; customers get their personal link with a target. */
  private async linkFor(user: Recipient, projectId: string, path: string): Promise<string | null> {
    if (user.kind === 'staff') return `${this.config.PUBLIC_URL}${path}`;
    // The customer's membership in this project or one above it; create the link if there is none yet.
    const tree = await loadTree(this.db);
    const chain = chainOf(tree, projectId);
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), inArray(memberships.projectId, chain)));
    const m = chain.map((id) => rows.find((r) => r.projectId === id)).find(Boolean);
    if (!m) return null;
    let token = m.linkTokenEnc ? this.box.decrypt(m.linkTokenEnc) : null;
    if (!token) {
      token = LinkBox.newToken();
      await this.db
        .update(memberships)
        .set({ linkTokenHash: LinkBox.hash(token), linkTokenEnc: this.box.encrypt(token), linkCreatedAt: new Date() })
        .where(eq(memberships.id, m.id));
    }
    return `${this.config.PUBLIC_URL}/k/${token}?next=${encodeURIComponent(path)}`;
  }

  private async send(
    user: Recipient,
    projectLanguage: Language,
    key: string,
    vars: Record<string, string>,
    projectId: string,
    path: string,
  ) {
    if (!user.email || !user.notify) return;
    const link = await this.linkFor(user, projectId, path);
    if (!link) return;
    const t = translator(isLanguage(user.language) ? user.language : projectLanguage);
    await this.mailer.send({
      to: user.email,
      subject: t(`mail.${key}.subject`, vars),
      text: `${t('mail.greeting', { name: user.name })}\n\n${t(`mail.${key}.body`, vars)}\n\n${link}\n\n${t('mail.footer')}`,
    });
  }

  /** People of a project (incl. parents) with a given permission level. */
  private async peopleWith(
    projectId: string,
    check: (level: ReturnType<typeof rightsOf>, level2: string) => boolean,
  ): Promise<Recipient[]> {
    const tree = await loadTree(this.db);
    const chain = chainOf(tree, projectId);
    const candidates = await this.db
      .selectDistinct({
        id: users.id,
        name: users.name,
        email: users.email,
        kind: users.kind,
        language: users.language,
        notify: users.notify,
        active: users.active,
        isAdmin: users.isAdmin,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(inArray(memberships.projectId, chain));
    const out: Recipient[] = [];
    for (const c of candidates) {
      if (!c.active) continue;
      const level = (await levelsForUser(this.db, { ...c, isAdmin: false } as never, tree)).get(projectId) ?? null;
      if (level && check(rightsOf(level), level)) out.push(c);
    }
    return out;
  }

  /** A test mail to check the server settings (waits for the result, so errors show up). */
  async test(to: string, language: Language): Promise<void> {
    const t = translator(language);
    await this.mailer.send({ to, subject: t('mail.test.subject'), text: `${t('mail.test.body')}\n\n${this.config.PUBLIC_URL}` });
  }

  /** A draft was handed over for review: tell the customer's project leads. */
  reviewRequested(versionId: string, actorId: string): void {
    this.run(async () => {
      const [v] = await this.db.select().from(planVersions).where(eq(planVersions.id, versionId));
      const [p] = v ? await this.db.select().from(projects).where(eq(projects.id, v.projectId)) : [];
      if (!v || !p) return;
      const vars = { project: p.name, version: `V${v.no}${v.name ? ` ${v.name}` : ''}` };
      for (const u of await this.peopleWith(p.id, (r) => r.reviewDrafts)) {
        if (u.id === actorId) continue;
        await this.send(u, p.language, 'reviewRequested', vars, p.id, `/projects/${p.id}?tab=plan&version=${v.id}`);
      }
    });
  }

  /** The customer approved or rejected: tell Slimstock's project leads. */
  reviewed(versionId: string, actorId: string, verdict: 'approve' | 'reject', comment: string | null): void {
    this.run(async () => {
      const [v] = await this.db.select().from(planVersions).where(eq(planVersions.id, versionId));
      const [p] = v ? await this.db.select().from(projects).where(eq(projects.id, v.projectId)) : [];
      const [actor] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
      if (!v || !p || !actor) return;
      const vars = { project: p.name, version: `V${v.no}${v.name ? ` ${v.name}` : ''}`, name: actor.name, comment: comment ?? '–' };
      for (const u of await this.peopleWith(p.id, (r) => r.manageVersions)) {
        await this.send(
          u,
          p.language,
          verdict === 'approve' ? 'approved' : 'rejected',
          vars,
          p.id,
          `/projects/${p.id}?tab=plan&version=${v.id}`,
        );
      }
    });
  }

  /** People were added to a task: tell them (not the one who did it). */
  taskAssigned(taskId: string, userIds: string[], actorId: string): void {
    const targets = userIds.filter((id) => id !== actorId);
    if (!targets.length) return;
    this.run(async () => {
      const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
      const [p] = task ? await this.db.select().from(projects).where(eq(projects.id, task.projectId)) : [];
      const [root] = task ? await this.db.select().from(projects).where(eq(projects.id, task.rootId)) : [];
      const [actor] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
      if (!task || !p || !root) return;
      const recipients = await this.db
        .select({ id: users.id, name: users.name, email: users.email, kind: users.kind, language: users.language, notify: users.notify })
        .from(users)
        .where(and(inArray(users.id, targets), eq(users.active, true)));
      const due = task.due
        ? new Intl.DateTimeFormat(root.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${task.due}T00:00:00Z`))
        : '–';
      const vars = { project: p.name, task: task.title, name: actor?.name ?? '', due };
      for (const u of recipients) {
        // Customers never hear about internal tasks.
        if (task.internal && u.kind !== 'staff') continue;
        await this.send(u, root.language, 'taskAssigned', vars, p.id, `/projects/${p.id}?tab=tasks&task=${task.id}`);
      }
    });
  }
}
