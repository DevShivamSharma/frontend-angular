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
  'event.updated': { label: 'Changed event', icon: 'edit_calendar' },
  'event.status_changed': { label: 'Changed event status', icon: 'event_available' },
  'event.deleted': { label: 'Deleted event', icon: 'event_busy' },
  'event.hall_added': { label: 'Booked hall for event', icon: 'add_location' },
  'event.hall_removed': { label: 'Removed hall from event', icon: 'wrong_location' },
  'exhibitor.created': { label: 'Added exhibitor', icon: 'add_business' },
  'exhibitor.updated': { label: 'Changed exhibitor', icon: 'storefront' },
  'exhibitor.deleted': { label: 'Deleted exhibitor', icon: 'domain_disabled' },
  'exhibitor.registered': { label: 'Registered exhibitor for event', icon: 'how_to_reg' },
  'exhibitor.unregistered': { label: 'Unregistered exhibitor from event', icon: 'person_off' },
  'stall_plan.saved': { label: 'Saved stall plan', icon: 'grid_view' },
  'stall_plan.approved': { label: 'Approved stall plan', icon: 'verified' },
  'stall_plan.published': { label: 'Published stall plan', icon: 'publish' },
  'stall_plan.reopened': { label: 'Reopened stall plan', icon: 'lock_open' },
  'stall_plan.deleted': { label: 'Deleted stall plan', icon: 'delete' },
  'booking.held': { label: 'Held stall', icon: 'pending' },
  'booking.confirmed': { label: 'Confirmed booking', icon: 'confirmation_number' },
  'booking.cancelled': { label: 'Cancelled booking', icon: 'cancel' },
  'booking.moved': { label: 'Moved booking', icon: 'move_down' },
  'booking.venue_confirmed': { label: 'Venue system confirmed booking', icon: 'task_alt' },
  'booking.venue_expired': { label: 'Venue system timed out booking', icon: 'timer_off' },
  'booking.venue_cancelled': { label: 'Venue system cancelled booking', icon: 'cancel' },
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
    'event.deleted',
    'exhibitor.deleted',
    'booking.cancelled',
    'booking.venue_cancelled',
    'booking.venue_expired',
  ].includes(action);
}
