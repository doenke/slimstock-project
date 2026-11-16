import type { Language, LocalizedText, PermissionLevel, PlanItem, PlanPm, ProjectStatus, Side } from '@spm/shared';
import { sql } from 'drizzle-orm';

import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Slimstock staff (username + password) and customer people (later: personal link per project). */
export const users = pgTable(
  'users',
  {
    id: id(),
    kind: text('kind').$type<'staff' | 'customer'>().notNull(),
    username: text('username'),
    passwordHash: text('password_hash'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    name: text('name').notNull(),
    email: text('email'),
    isAdmin: boolean('is_admin').notNull().default(false),
    active: boolean('active').notNull().default(true),
    language: text('language').$type<Language>(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_username_idx').on(t.username)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token in the cookie. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_idx').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const customers = pgTable('customers', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

/** Projects and subprojects (a tree via parent_id). */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    parentId: uuid('parent_id').references((): any => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    language: text('language').$type<Language>().notNull(),
    status: text('status').$type<ProjectStatus>().notNull().default('planned'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    sort: integer('sort').notNull().default(0),
    /** Plan settings of a top-level project (working days, plan start, levelling). */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Later: where the project came from (template, version, modules). */
    origin: jsonb('origin'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('projects_parent_idx').on(t.parentId), index('projects_customer_idx').on(t.customerId)],
);

/** What people do in a project (Projektrollen). Extensible by admins. */
export const projectRoles = pgTable('project_roles', {
  id: id(),
  key: text('key'),
  side: text('side').$type<Side>().notNull(),
  names: jsonb('names').$type<LocalizedText>().notNull(),
  calculated: boolean('calculated').notNull().default(true),
  defaultPermission: text('default_permission').$type<PermissionLevel>().notNull(),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionOverride: text('permission_override').$type<PermissionLevel>(),
    invitedBy: uuid('invited_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memberships_project_user_idx').on(t.projectId, t.userId), index('memberships_user_idx').on(t.userId)],
);

export const memberRoles = pgTable(
  'member_roles',
  {
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => projectRoles.id),
  },
  (t) => [uniqueIndex('member_roles_pk').on(t.membershipId, t.roleId)],
);

/**
 * Versions of a project's plan (one plan per top-level project). Exactly one is the working version;
 * any number of drafts; former working versions become history.
 */
export const planVersions = pgTable(
  'plan_versions',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Running number per project (V1, V2, …). */
    no: integer('no').notNull().default(1),
    kind: text('kind').$type<'working' | 'draft' | 'history'>().notNull(),
    status: text('status').$type<'editing' | 'in_review' | 'accepted' | 'rejected' | 'discarded'>().notNull().default('editing'),
    name: text('name').notNull().default(''),
    description: text('description'),
    basedOnVersionId: uuid('based_on_version_id'),
    /** The items of the version a draft was copied from, as they were then (to see later changes there). */
    baseSnapshot: jsonb('base_snapshot').$type<PlanItem[]>(),
    customerVisible: boolean('customer_visible').notNull().default(false),
    /** Positions of the subprojects in the plan: { subprojects: { <id>: sort } }. */
    layout: jsonb('layout').$type<{ subprojects?: Record<string, number> }>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    replacedAt: timestamp('replaced_at', { withTimezone: true }),
  },
  (t) => [
    index('plan_versions_project_idx').on(t.projectId),
    uniqueIndex('plan_versions_one_working_idx')
      .on(t.projectId)
      .where(sql`kind = 'working'`),
  ],
);

export const planItems = pgTable(
  'plan_items',
  {
    id: id(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => planVersions.id, { onDelete: 'cascade' }),
    /** Stable across versions; dependencies and tasks refer to it. */
    key: uuid('key').notNull(),
    parentKey: uuid('parent_key'),
    subprojectId: uuid('subproject_id').references(() => projects.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    sort: doublePrecision('sort').notNull().default(0),
    pm: jsonb('pm').$type<PlanPm>().notNull().default({ deps: {} }),
    progress: integer('progress').notNull().default(0),
    actualStart: date('actual_start'),
    actualEnd: date('actual_end'),
    assignees: jsonb('assignees').$type<string[]>().notNull().default([]),
    internal: boolean('internal').notNull().default(false),
    rev: integer('rev').notNull().default(1),
    origin: jsonb('origin'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id),
  },
  (t) => [uniqueIndex('plan_items_version_key_idx').on(t.versionId, t.key)],
);
