export type StatusSeverity = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

/** The colour of a booking or approval status, so the same word looks the same everywhere. */
export function statusSeverity(status: string | null | undefined): StatusSeverity {
  switch (status?.toLowerCase()) {
    case 'approved':
    case 'confirmed':
    case 'completed':
      return 'success';
    case 'pending':
    case 'in review':
      return 'warn';
    case 'rejected':
    case 'cancelled':
      return 'danger';
    case 'draft':
      return 'info';
    default:
      return 'secondary';
  }
}
