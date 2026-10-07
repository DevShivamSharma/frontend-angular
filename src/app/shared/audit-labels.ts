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
