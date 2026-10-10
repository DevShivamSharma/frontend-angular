/** Readable wording and an icon for each audit action. */
const ACTIONS: Record<string, { label: string; icon: string }> = {
  'auth.login': { label: 'Signed in', icon: 'login' },
  'auth.login_failed': { label: 'Failed sign-in', icon: 'gpp_maybe' },
  'auth.password_reset': { label: 'Reset password', icon: 'key' },
  'organisation.created': { label: 'Created organisation', icon: 'add_business' },
  'organisation.updated': { label: 'Changed plan or features', icon: 'tune' },
  'organisation.slug_changed': { label: 'Changed link', icon: 'link' },
  'organisation.suspended': { label: 'Suspended organisation', icon: 'block' },
  'organisation.activated': { label: 'Re-activated organisation', icon: 'check_circle' },
  'organisation.config_updated': { label: 'Changed settings', icon: 'palette' },
  'organisation.config_restored': { label: 'Restored settings', icon: 'history' },
  'invitation.created': { label: 'Invited', icon: 'forward_to_inbox' },
  'invitation.revoked': { label: 'Revoked invitation', icon: 'cancel_schedule_send' },
  'invitation.accepted': { label: 'Accepted invitation', icon: 'how_to_reg' },
  'membership.role_changed': { label: 'Changed role', icon: 'manage_accounts' },
  'membership.removed': { label: 'Removed member', icon: 'person_remove' },
  'role.created': { label: 'Created role', icon: 'add_moderator' },
  'role.updated': { label: 'Changed role permissions', icon: 'shield_person' },
  'role.deleted': { label: 'Deleted role', icon: 'remove_moderator' },
  'rules.updated': { label: 'Changed rules', icon: 'rule' },
  'event.created': { label: 'Created event', icon: 'event' },
  'event.updated': { label: 'Changed event', icon: 'event' },
  'event.deleted': { label: 'Deleted event', icon: 'delete' },
  'event.halls_added': { label: 'Added halls to event', icon: 'meeting_room' },
  'event.hall_removed': { label: 'Removed hall from event', icon: 'meeting_room' },
  'event.hall_rules_changed': { label: 'Switched rules for event hall', icon: 'rule' },
  'event.hall_rules_reset': { label: 'Copied rules to event hall again', icon: 'rule' },
  'event.person_added': { label: 'Gave organiser an event', icon: 'person_add' },
  'event.person_removed': { label: 'Removed organiser from event', icon: 'person_remove' },
  'event.invitation_revoked': { label: 'Cancelled organiser invitation', icon: 'cancel' },
  'event.hall_categories_changed': { label: 'Changed categories of event hall', icon: 'category' },
  'category.created': { label: 'Added stall category', icon: 'category' },
  'category.updated': { label: 'Changed stall category', icon: 'category' },
  'category.deleted': { label: 'Deleted stall category', icon: 'delete' },
  'category.imported': { label: 'Imported stall categories', icon: 'upload_file' },
  'plan.saved': { label: 'Saved stall plan', icon: 'save' },
  'plan.published': { label: 'Published stall plan', icon: 'check_circle' },
};

export function auditLabel(action: string): string {
  return ACTIONS[action]?.label ?? action;
}

export function auditIcon(action: string): string {
  return ACTIONS[action]?.icon ?? 'history';
}

/** Actions worth drawing the eye to. */
export function auditIsWarning(action: string): boolean {
  return [
    'auth.login_failed',
    'organisation.suspended',
    'role.deleted',
    'membership.removed',
  ].includes(action);
}
