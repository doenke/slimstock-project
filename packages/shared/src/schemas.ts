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
