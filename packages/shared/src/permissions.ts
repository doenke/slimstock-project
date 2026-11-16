/**
 * Permission levels inside a project, lowest first. A person's level comes from their project roles
 * (each role has a default level) and can be overridden per membership. See PLAN.md, section 7.
 */
export const PERMISSION_LEVELS = ['reader', 'team_customer', 'pl_customer', 'team_slimstock', 'pl_slimstock'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const CUSTOMER_LEVELS: readonly PermissionLevel[] = ['reader', 'team_customer', 'pl_customer'];
export const SLIMSTOCK_LEVELS: readonly PermissionLevel[] = ['reader', 'team_slimstock', 'pl_slimstock'];

export type Side = 'slimstock' | 'customer';
export const SIDES: readonly Side[] = ['slimstock', 'customer'];

export function rank(level: PermissionLevel | null | undefined): number {
  return level ? PERMISSION_LEVELS.indexOf(level) : -1;
}

export function maxLevel(levels: Iterable<PermissionLevel | null | undefined>): PermissionLevel | null {
  let best: PermissionLevel | null = null;
  for (const l of levels) if (l && rank(l) > rank(best)) best = l;
  return best;
}

/** Levels a person of this side can have (customers never get Slimstock levels and vice versa). */
export function levelsForSide(side: Side): readonly PermissionLevel[] {
  return side === 'slimstock' ? SLIMSTOCK_LEVELS : CUSTOMER_LEVELS;
}

export function isSlimstockLevel(level: PermissionLevel | null | undefined): boolean {
  return level === 'team_slimstock' || level === 'pl_slimstock';
}

/** What a level may do. The server checks these; the UI only hides what is not allowed. */
export function rightsOf(level: PermissionLevel | null) {
  const r = rank(level);
  return {
    view: r >= 0,
    viewInternal: isSlimstockLevel(level),
    editProject: level === 'pl_slimstock',
    createSubproject: level === 'pl_slimstock',
    manageMembers: level === 'pl_slimstock' || level === 'pl_customer',
    /** Customer project leads only manage the customer side. */
    manageAllMembers: level === 'pl_slimstock',
    editPlan: isSlimstockLevel(level),
    editTasks: r >= rank('team_customer'),
  };
}
export type Rights = ReturnType<typeof rightsOf>;
