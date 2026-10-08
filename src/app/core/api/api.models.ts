import type { FloorGeometry } from '../venues/floor-plan.models';
/** Response shapes of the platform API. They mirror the backend's view interfaces. */

export type FontFamily = 'Inter' | 'Roboto' | 'Poppins' | 'Noto Sans' | 'Lato' | 'Source Sans 3';
export const FONT_FAMILIES: readonly FontFamily[] = [
  'Inter',
  'Roboto',
  'Poppins',
  'Noto Sans',
  'Lato',
  'Source Sans 3',
];

export type Language = 'en' | 'hi';
export const LANGUAGES: readonly { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
];

export interface OrganisationBranding {
  primaryColor: string;
  accentColor: string | null;
  fontFamily: FontFamily;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
}

export interface OrganisationConfig {
  branding: OrganisationBranding;
  locale: { defaultLanguage: Language; languages: Language[]; currency: string; timezone: string };
  legal: {
    legalName: string | null;
    gstin: string | null;
    address: string | null;
    invoicePrefix: string | null;
    supportEmail: string | null;
  };
  email: { senderName: string | null; replyTo: string | null; footer: string | null };
}

export interface PublicConfig {
  slug: string;
  name: string;
  branding: OrganisationBranding;
  locale: { defaultLanguage: Language; languages: Language[] };
}

export type BookingMode = 'own_portal' | 'embed' | 'sync' | 'hybrid_hold';
export const BOOKING_MODES: readonly { value: BookingMode; label: string; hint: string }[] = [
  { value: 'own_portal', label: 'Our portal', hint: 'Exhibitors book on the white-label portal' },
  { value: 'embed', label: 'Embedded', hint: 'Our stall map inside the venue’s own site' },
  { value: 'sync', label: 'Sync', hint: 'Layouts go to the venue’s booking system' },
  { value: 'hybrid_hold', label: 'Hybrid hold', hint: 'We hold the stall; they take payment' },
];

export interface OrganisationFeatures {
  aiAssist: boolean;
  pdfPlot: boolean;
  exhibitorPortal: boolean;
  wayfinding: boolean;
}
export const FEATURE_LABELS: Record<keyof OrganisationFeatures, string> = {
  aiAssist: 'AI Assist',
  pdfPlot: 'Stalls from an architect’s PDF',
  exhibitorPortal: 'Exhibitor portal',
  wayfinding: 'Wayfinding',
};

export interface OrganisationLimits {
  venues: number;
  users: number;
  storageMb: number;
}

export type OrganisationStatus = 'active' | 'suspended';

export interface OrganisationView {
  id: string;
  slug: string;
  name: string;
  status: OrganisationStatus;
  suspendedReason: string | null;
  bookingMode: BookingMode;
  features: OrganisationFeatures;
  limits: OrganisationLimits;
  config: OrganisationConfig;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationSummary {
  id: string;
  slug: string;
  name: string;
  status: OrganisationStatus;
  bookingMode: BookingMode;
  primaryColor: string;
  logoUrl: string | null;
  memberCount: number;
  openInvitationCount: number;
  createdAt: string;
}

export interface OrganisationDetail extends OrganisationView {
  aliases: string[];
  members: MemberView[];
  invitations: InvitationView[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SlugCheck {
  slug: string;
  available: boolean;
  reason: string | null;
}

export interface ConfigVersion {
  version: number;
  config: OrganisationConfig;
  changedBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  current: boolean;
}

export interface RoleRef {
  id: string;
  key: string;
  name: string;
}

export type RoleScopeKind = 'organisation' | 'event';

export interface RoleView extends RoleRef {
  description: string | null;
  scopeKind: RoleScopeKind;
  permissions: string[];
  isSystem: boolean;
  isLocked: boolean;
  organisation: { id: string; slug: string; name: string } | null;
}

export interface AdminRoleView extends RoleView {
  memberCount: number;
  openInvitationCount: number;
}

export interface AssignableRoleView extends RoleView {
  assignable: boolean;
  reason: string | null;
}

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  available: boolean;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDefinition[];
}

/** Where a membership applies: an event role names its events; whole-organisation roles none. */
export interface MembershipScope {
  eventIds?: string[];
  hallIds?: string[];
  /** The exhibitor an event-scoped member who books stalls acts for. */
  exhibitorId?: string;
}

export interface MemberView {
  id: string;
  user: { id: string; name: string; email: string; lastLoginAt: string | null };
  role: RoleRef;
  scope: MembershipScope;
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  email: string;
  role: RoleRef;
  /** The events (and exhibitor) an event role is given for; empty for the whole organisation. */
  scope: MembershipScope;
  invitedBy: { name: string; email: string } | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface CreatedInvitation extends InvitationView {
  /** Present only while email goes to the server log; the inviter passes it on. */
  inviteUrl: string | null;
}

/**
 * An invitation. An event role names the events the person works on and, when it books
 * stalls, the exhibitor it books for; a whole-organisation role names neither.
 */
export interface InviteInput {
  email: string;
  roleId: string;
  eventIds?: string[];
  exhibitorId?: string | null;
}

export interface InvitationPreview {
  organisation: { slug: string; name: string };
  email: string;
  role: RoleRef;
  accountExists: boolean;
  expiresAt: string;
}

export interface UserView {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: UserView;
}

export interface MembershipSummary {
  id: string;
  organisation: { id: string; slug: string; name: string };
  role: RoleRef;
}

export interface Me {
  user: UserView;
  memberships: MembershipSummary[];
}

export interface OrgContext {
  organisation: {
    id: string;
    slug: string;
    name: string;
    bookingMode: BookingMode;
    features: OrganisationFeatures;
  };
  membership: { id: string; role: RoleRef & { scopeKind: RoleScopeKind }; scope: MembershipScope };
  permissions: string[];
}

export interface OrgSettings {
  config: OrganisationConfig;
  configVersion: number;
}

export interface AuditEntry {
  id: string;
  organisationId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminOverview {
  organisations: { total: number; active: number; suspended: number };
  people: { users: number; memberships: number; openInvitations: number };
  roles: { platform: number; custom: number };
  attention: {
    id: string;
    slug: string;
    name: string;
    reason: 'suspended' | 'awaiting_admin';
    since: string;
  }[];
  latestOrganisations: OrganisationSummary[];
  recentActivity: AuditEntry[];
}

// ---- Venues and halls (Module B) ----------------------------------------------------------

export interface VenueView {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  hallCount: number;
  createdAt: string;
}

/** What a rectangle of a hall's floor is. Mirrors the backend's `FloorAreaKind`. */
export type FloorAreaKind =
  | 'outside'
  | 'wall'
  | 'column'
  | 'passage'
  | 'fire_curtain'
  | 'no_build'
  | 'utility'
  | 'entry'
  | 'unavailable'
  | 'void'
  | 'facility'
  | 'marking';

export interface FloorArea {
  kind: FloorAreaKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  color?: string;
  hidden?: boolean;
}

/**
 * A hall's empty floor: metres, top-left origin, y down. Geometry may reach past
 * `width` x `depth`; labels and icons often sit outside the hall.
 */
export interface HallFloor {
  geometry?: FloorGeometry;
  schema: 'floor/1';
  width: number;
  depth: number;
  areas: FloorArea[];
  labels: { text: string; x: number; y: number; width?: number; height?: number }[];
  iconGroups: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    icons: { kind: string; label: string }[];
  }[];
  north: { x: number; y: number; size: number; rotation: number; label: string } | null;
  legend: {
    label: string;
    color?: string;
    kind?: FloorAreaKind;
    code?: string;
    showInView: boolean;
  }[];
}

export interface HallUses {
  fnb?: boolean;
  branding?: boolean;
  horseshoe?: boolean;
  openArea?: boolean;
}

export interface HallView {
  id: string;
  venueId: string;
  name: string;
  code: string | null;
  level: string | null;
  uses: HallUses;
  width: number;
  depth: number;
  floorArea: number;
  currentVersion: number;
  source: { system: 'itpo' | 'json' | 'csv'; externalId: string } | null;
  updatedAt: string;
}

export interface FloorVersionView {
  version: number;
  /** `drawing` is retained for previously imported floor versions. */
  source: 'blank' | 'itpo' | 'restore' | 'drawing' | 'json' | 'csv';
  sourceRef: string | null;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  current: boolean;
}

export interface HallDetailView extends HallView {
  venue: { id: string; name: string };
  floor: HallFloor;
  versions: FloorVersionView[];
}

export type FloorCounts = Record<FloorAreaKind, number>;

export interface ItpoImportRowView {
  externalId: string;
  layoutId: string | null;
  name: string;
  width: number | null;
  depth: number | null;
  floorArea: number | null;
  counts: FloorCounts | null;
  labels: number;
  iconGroups: number;
  warnings: string[];
  existing: {
    hallId: string;
    name: string;
    venueId: string;
    venueName: string;
    sameFloor: boolean;
  } | null;
  error: string | null;
}

export interface ItpoImportResult {
  created: HallView[];
  updated: HallView[];
  unchanged: HallView[];
}

export interface ItpoImportPreview {
  rows: ItpoImportRowView[];
}

/** Field paths. Absent: recognised by name; an empty path: the file has no such field. */
export interface JsonHallMapping {
  /** CSV only: one row per hall (default), or one row per space grouped by hall. */
  rows?: 'hall' | 'space';
  halls?: string;
  id?: string;
  name?: string;
  width?: string;
  depth?: string;
  boundary?: string;
  areas?: string;
  zones?: string;
  unit?: string;
  unitField?: string;
  metresPerUnit?: number;
  kinds?: Record<string, string>;
  yAxis?: 'down' | 'up';
  areaFields?: Partial<
    Record<'x' | 'y' | 'width' | 'height' | 'kind' | 'label' | 'geometry', string>
  >;
}
export interface JsonHallRow {
  externalId: string;
  /** The hall's own ID in the file, when it has one. */
  sourceId?: string | null;
  name: string;
  floor: HallFloor | null;
  width: number | null;
  depth: number | null;
  floorArea: number | null;
  warnings: string[];
  error: string | null;
  existing: { hallId: string; name: string; version: number; sameFloor: boolean } | null;
  /** CSV rows read into this hall, when the file has one row per space. */
  records?: number;
}
/** A field a CSV column can be mapped to. `width`/`depth` are the hall's, or each space's. */
export type CsvField =
  | 'id'
  | 'name'
  | 'width'
  | 'depth'
  | 'boundary'
  | 'zones'
  | 'areas'
  | 'unitField'
  | 'kind'
  | 'x'
  | 'y'
  | 'label'
  | 'geometry';
export interface JsonHallPreview {
  rows: JsonHallRow[];
  fields: string[];
  collectionPaths: string[];
  areaTypes: string[];
  previewToken: string;
  /** CSV only, below: the file's columns and how they are read. */
  rowLayout?: 'hall' | 'space';
  format?: 'itpo' | 'generic';
  columns?: string[];
  samples?: Record<string, string>;
  suggested?: Partial<Record<CsvField, string>>;
  autoColumns?: Record<string, string>;
  missing?: (CsvField | 'unit')[];
  layoutHint?: 'hall' | 'space';
}
