import { z } from 'zod';
import { LANGUAGES } from './languages.js';
import { PERMISSION_LEVELS } from './permissions.js';

export const PASSWORD_MIN_LENGTH = 12;

const language = z.enum(LANGUAGES);
const permission = z.enum(PERMISSION_LEVELS);
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
/** YYYY-MM-DD; an empty field means "no date". */
const isoDate = z
  .preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullish(),
  )
  .transform((v) => v ?? null);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'invalid_email')
  .nullish()
  .transform((v) => v || null);
export const password = z.string().min(PASSWORD_MIN_LENGTH).max(200);
const localizedText = z.partialRecord(language, z.string().trim().max(120)).refine((v) => Object.values(v).some(Boolean), 'name_required');

export const LoginInput = z.object({ username: trimmed(100), password: z.string().min(1).max(200) });
export const ChangePasswordInput = z.object({ current: z.string().min(1).max(200), password });
export const UpdateMeInput = z.object({
  name: trimmed(120).optional(),
  email: email.optional(),
  /** null = use the project language. */
  language: language.nullable().optional(),
});

export const CreateUserInput = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,50}$/, 'invalid_username'),
  name: trimmed(120),
  email,
  isAdmin: z.boolean().default(false),
  password,
});
export const UpdateUserInput = z.object({
  name: trimmed(120).optional(),
  email: email.optional(),
  isAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const ResetPasswordInput = z.object({ password });

export const RoleInput = z.object({
  side: z.enum(['slimstock', 'customer']),
  names: localizedText,
  calculated: z.boolean().default(true),
  defaultPermission: permission,
  active: z.boolean().default(true),
});
export const UpdateRoleInput = RoleInput.omit({ side: true }).partial();
export const ReorderRolesInput = z.object({ ids: z.array(z.uuid()).min(1) });

export const CustomerInput = z.object({ name: trimmed(160) });

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'done', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CreateProjectInput = z.object({
  customerId: z.uuid().optional(),
  /** Creates the customer on the fly. */
  customerName: trimmed(160).optional(),
  parentId: z.uuid().optional(),
  name: trimmed(160),
  code: optionalText(40),
  description: optionalText(4000),
  language: language.optional(),
  startDate: isoDate,
  endDate: isoDate,
});
export const UpdateProjectInput = z.object({
  name: trimmed(160).optional(),
  code: optionalText(40).optional(),
  description: optionalText(4000).optional(),
  language: language.optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});

export const AddMemberInput = z
  .object({
    /** An existing user (Slimstock staff, or a customer person already known). */
    userId: z.uuid().optional(),
    /** Or a new customer person. */
    name: trimmed(120).optional(),
    email,
    roleIds: z.array(z.uuid()).default([]),
    permissionOverride: permission.nullable().default(null),
  })
  .refine((v) => v.userId || v.name, 'user_or_name_required');
export const UpdateMemberInput = z.object({
  roleIds: z.array(z.uuid()).optional(),
  permissionOverride: permission.nullable().optional(),
});

export type LoginInput = z.infer<typeof LoginInput>;
export type CreateUserInput = z.input<typeof CreateUserInput>;
export type RoleInput = z.input<typeof RoleInput>;
export type CreateProjectInput = z.input<typeof CreateProjectInput>;
export type UpdateProjectInput = z.input<typeof UpdateProjectInput>;
export type AddMemberInput = z.input<typeof AddMemberInput>;

// --- Plan ---

const planDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const pmValue = <T extends z.ZodType>(v: T) => z.object({ v, src: z.enum(['set', 'calc']) });
const minutes = z.number().int().min(0).max(10_000_000);
export const PmDepInput = z.object({ type: z.enum(['FS', 'SS', 'FF', 'SF']), lag: z.number().int().min(-10_000_000).max(10_000_000) });

/** Changes to the planning fields; null removes a field. `deps` replaces all predecessors. */
export const PlanPmPatch = z.object({
  start: pmValue(planDate).nullable().optional(),
  end: pmValue(planDate).nullable().optional(),
  dur: pmValue(minutes).nullable().optional(),
  milestone: z.boolean().optional(),
  notBefore: planDate.nullable().optional(),
  deadline: planDate.nullable().optional(),
  deps: z.record(z.uuid(), PmDepInput).optional(),
});

export const CreatePlanItemInput = z.object({
  title: trimmed(300),
  milestone: z.boolean().default(false),
  /** Where: after this task, or at the end of this phase or subproject; nothing = at the end of the plan. */
  anchor: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('item'), key: z.uuid() }),
      z.object({ kind: z.literal('subproject'), id: z.uuid() }),
    ])
    .nullable()
    .default(null),
});

export const UpdatePlanItemInput = z.object({
  rev: z.number().int(),
  title: trimmed(300).optional(),
  pm: PlanPmPatch.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  actualStart: planDate.nullable().optional(),
  actualEnd: planDate.nullable().optional(),
  assignees: z.array(z.uuid()).max(50).optional(),
  internal: z.boolean().optional(),
  /** Planned effort per role in minutes; null removes a role. */
  efforts: z.record(z.uuid(), minutes.nullable()).optional(),
  /** Remaining effort per role in minutes; null = back to "plan − actual". */
  remaining: z.record(z.uuid(), minutes.nullable()).optional(),
});

export const MovePlanRowInput = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), key: z.uuid() }),
    z.object({ kind: z.literal('subproject'), id: z.uuid() }),
  ]),
  direction: z.enum(['up', 'down', 'indent', 'outdent']),
});

export const PlanSettingsInput = z.object({
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  projectStart: planDate.nullable().optional(),
  level: z.boolean().optional(),
  durationFromEffort: z.boolean().optional(),
  effortView: z.enum(['none', 'customer', 'plan', 'full']).optional(),
  warnPct: z.number().min(0).max(1000).optional(),
  critPct: z.number().min(0).max(1000).optional(),
});

export const EffortEntryInput = z.object({
  itemKey: z.uuid(),
  userId: z.uuid(),
  roleId: z.uuid(),
  date: planDate,
  minutes: z
    .number()
    .int()
    .min(1)
    .max(30 * 480),
  note: optionalText(500),
});
export const UpdateEffortEntryInput = EffortEntryInput.omit({ itemKey: true }).partial();

export const BillingInput = z.object({ unitId: z.uuid(), billing: z.enum(['tm', 'fixed']) });

/** Per fixed-price unit whose effort changed: true = change request (budget follows the plan). */
export const AcceptInput = z.object({ changeRequests: z.record(z.uuid(), z.boolean()).default({}) });

export const CreateDraftInput = z.object({
  /** Copy of this version; default: the working version. */
  fromVersionId: z.uuid().optional(),
  name: trimmed(160),
  description: optionalText(4000),
});
export const UpdateVersionInput = z.object({ name: trimmed(160).optional(), description: optionalText(4000).optional() });
export const VersionStatusInput = z.object({ status: z.enum(['editing', 'in_review', 'discarded']) });

export const VisibilityInput = z.object({ customerVisible: z.boolean() });
export const ReviewInput = z.object({ verdict: z.enum(['approve', 'reject']), comment: optionalText(2000) });
export const CommentInput = z.object({
  itemKey: z.uuid().nullable().default(null),
  text: trimmed(4000),
  internal: z.boolean().default(false),
});

// --- Tasks ---

const taskLink = z.object({
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'invalid_url'),
  label: optionalText(200),
});

export const CreateTaskInput = z.object({
  title: trimmed(300),
  /** Subproject (or the project itself) the task belongs to. */
  projectId: z.uuid().optional(),
  description: optionalText(8000),
  statusId: z.string().max(40).optional(),
  due: isoDate,
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  area: optionalText(80),
  assignees: z.array(z.uuid()).max(50).default([]),
  planItemKey: z.uuid().nullable().default(null),
  internal: z.boolean().default(false),
});

export const UpdateTaskInput = z.object({
  rev: z.number().int(),
  title: trimmed(300).optional(),
  projectId: z.uuid().optional(),
  description: optionalText(8000).optional(),
  statusId: z.string().max(40).optional(),
  due: isoDate.optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  area: optionalText(80).optional(),
  assignees: z.array(z.uuid()).max(50).optional(),
  planItemKey: z.uuid().nullable().optional(),
  internal: z.boolean().optional(),
  done: z.boolean().optional(),
  sort: z.number().finite().optional(),
  links: z.array(taskLink).max(20).optional(),
});

export const TaskCommentInput = z.object({ text: trimmed(4000), internal: z.boolean().default(false) });

export const TaskStatusesInput = z.object({
  statuses: z
    .array(z.object({ id: z.string().trim().min(1).max(40), label: optionalText(60) }))
    .min(1)
    .max(12),
});
