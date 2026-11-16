import type { PlanDiff, PlanItem, PlanSettings, PlanSubproject, RowPlan } from './plan.js';
import type { Language, LocalizedText } from './languages.js';
import type { PermissionLevel, Rights, Side } from './permissions.js';
import type { ProjectStatus } from './schemas.js';

/** API response shapes, shared by server and web. */

export interface PublicConfig {
  version: string;
  defaultLanguage: Language;
}

export interface Me {
  id: string;
  username: string | null;
  name: string;
  email: string | null;
  kind: 'staff' | 'customer';
  isAdmin: boolean;
  /** Own language choice; null = project language. */
  language: Language | null;
  mustChangePassword: boolean;
}

export interface UserRow {
  id: string;
  username: string | null;
  name: string;
  email: string | null;
  kind: 'staff' | 'customer';
  isAdmin: boolean;
  active: boolean;
  lastSeenAt: string | null;
}

export interface Role {
  id: string;
  side: Side;
  names: LocalizedText;
  calculated: boolean;
  defaultPermission: PermissionLevel;
  active: boolean;
  sort: number;
}

export interface Customer {
  id: string;
  name: string;
}

export interface ProjectSummary {
  id: string;
  parentId: string | null;
  customerId: string;
  customerName: string;
  name: string;
  code: string | null;
  status: ProjectStatus;
  language: Language;
  startDate: string | null;
  endDate: string | null;
  permission: PermissionLevel | null;
  subprojectCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null;
  /** Ancestors from the top-level project down to the parent. */
  path: { id: string; name: string }[];
  subprojects: ProjectSummary[];
  rights: Rights;
}

export interface Member {
  userId: string;
  name: string;
  email: string | null;
  kind: 'staff' | 'customer';
  /** Membership in this very project; null if the person only comes from a parent project. */
  membershipId: string | null;
  roleIds: string[];
  permissionOverride: PermissionLevel | null;
  /** Roles from parent projects (read-only here). */
  inheritedRoleIds: string[];
  inheritedFrom: { id: string; name: string }[];
  effectivePermission: PermissionLevel | null;
}

export interface PlanPerson {
  userId: string;
  name: string;
  kind: 'staff' | 'customer';
}

/** The plan as the server sends it: data plus the computed dates (always computed on the full plan). */
export interface PlanPayload {
  project: { id: string; name: string; startDate: string | null };
  version: PlanVersionInfo;
  settings: PlanSettings;
  subprojects: PlanSubproject[];
  items: PlanItem[];
  /** Computed per row id (item key, "sub:<id>"). */
  computed: Record<string, RowPlan>;
  total: RowPlan | null;
  projectStart: string;
  people: PlanPerson[];
  rights: { edit: boolean; editSettings: boolean; createDraft: boolean; manageVersions: boolean };
  /** With ?compare=<version>: the other version's dates per row and what changed (from it to this one). */
  compare: {
    version: PlanVersionInfo;
    computed: Record<string, { start: string; end: string; milestone: boolean }>;
    diff: PlanDiff;
  } | null;
}

export type VersionKind = 'working' | 'draft' | 'history';
export type VersionStatus = 'editing' | 'in_review' | 'accepted' | 'rejected' | 'discarded';

export interface PlanVersionInfo {
  id: string;
  no: number;
  kind: VersionKind;
  status: VersionStatus;
  name: string;
  description: string | null;
  createdAt: string;
  createdBy: string | null;
  basedOn: { id: string; no: number } | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  replacedAt: string | null;
  customerVisible: boolean;
  /** Planned end of the version (null when empty). */
  end: string | null;
}

/** What accepting a draft does to the working version. */
export interface AcceptPreview {
  /** Progress and actual dates taken over from the working version (per task). */
  carried: { key: string; title: string; fields: string[] }[];
  /** Planning changes made in the working version since the draft was started – they are not taken over. */
  lost: PlanDiff['rows'];
  /** What the draft changes compared to the current working version. */
  diff: PlanDiff;
}
