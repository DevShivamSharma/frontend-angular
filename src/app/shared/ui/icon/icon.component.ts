import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/**
 * Icon names used across the app (nav items, audit labels, empty states) mapped to PrimeIcons.
 * Names stay descriptive in data; only this map knows the icon set.
 */
const ICONS: Record<string, string> = {
  add: 'plus',
  add_business: 'shop',
  add_moderator: 'shield',
  angle: 'angle-right',
  architecture: 'pen-to-square',
  area: 'stop',
  arrow_back: 'arrow-left',
  arrow_downward: 'arrow-down',
  arrow_forward: 'arrow-right',
  arrow_upward: 'arrow-up',
  auto_awesome: 'sparkles',
  block: 'ban',
  call_merge: 'link',
  call_split: 'clone',
  cancel: 'times-circle',
  cancel_schedule_send: 'calendar-times',
  category: 'tags',
  check: 'check',
  check_circle: 'check-circle',
  checklist: 'list-check',
  chevron_right: 'chevron-right',
  circle: 'circle',
  close: 'times',
  confirmation_number: 'ticket',
  content_copy: 'copy',
  crop_free: 'expand',
  crop_square: 'stop',
  delete: 'trash',
  delete_sweep: 'trash',
  domain: 'building',
  download: 'download',
  edit: 'pencil',
  error: 'times-circle',
  event: 'calendar',
  event_available: 'calendar-plus',
  event_seat: 'user',
  expand_more: 'chevron-down',
  file_import: 'file-import',
  fit_screen: 'expand',
  flip: 'arrows-h',
  forward_to_inbox: 'envelope',
  fullscreen: 'window-maximize',
  gpp_maybe: 'exclamation-circle',
  grid_on: 'th-large',
  grid_view: 'th-large',
  group: 'users',
  groups: 'users',
  height: 'arrows-v',
  help: 'question-circle',
  hexagon: 'stop-circle',
  history: 'history',
  home: 'home',
  hourglass_empty: 'hourglass',
  how_to_reg: 'user-plus',
  info: 'info-circle',
  key: 'key',
  label: 'tag',
  left_panel_close: 'angle-double-left',
  left_panel_open: 'angle-double-right',
  line: 'minus',
  link: 'link',
  link_off: 'ban',
  location_city: 'building',
  lock: 'lock',
  login: 'sign-in',
  logout: 'sign-out',
  mail: 'envelope',
  manage_accounts: 'user-edit',
  map: 'map',
  measure: 'arrows-h',
  meeting_room: 'box',
  menu: 'bars',
  menu_open: 'bars',
  mic: 'microphone',
  more_vert: 'ellipsis-v',
  move: 'arrows-alt',
  near_me: 'arrow-up-left',
  numbers: 'hashtag',
  object: 'box',
  open_in_new: 'external-link',
  payments: 'wallet',
  palette: 'palette',
  pause: 'pause-circle',
  person_add: 'user-plus',
  person_remove: 'user-minus',
  play: 'play-circle',
  polyline: 'share-alt',
  redo: 'replay',
  remove: 'minus-circle',
  remove_moderator: 'shield',
  restart_alt: 'refresh',
  rotate: 'sync',
  rows: 'bars',
  rule: 'list-check',
  save: 'save',
  scale: 'arrow-up-right-and-arrow-down-left-from-center',
  search: 'search',
  search_off: 'search-minus',
  sell: 'tag',
  send: 'send',
  shield_person: 'shield',
  skip_next: 'step-forward',
  space_dashboard: 'objects-column',
  split_view: 'clone',
  stadium: 'building-columns',
  stop: 'stop-circle',
  storefront: 'shop',
  swap_horiz: 'arrow-right-arrow-left',
  table_view: 'table',
  task_alt: 'check-square',
  tree: 'sitemap',
  trending: 'chart-line',
  tune: 'sliders-h',
  undo: 'undo',
  upload_file: 'upload',
  verified: 'verified',
  visibility: 'eye',
  visibility_off: 'eye-slash',
  volume_off: 'volume-off',
  volume_up: 'volume-up',
  warning: 'exclamation-triangle',
  way_out: 'sign-out',
  zoom_in: 'search-plus',
  zoom_out: 'search-minus',
  zoom_window: 'window-maximize',
};

/**
 * Lucide line icons (the redesign's set), drawn as SVG where PrimeIcons has no match. Their names
 * differ from the PrimeIcons ones above, so the pages that use those keep their icons.
 */
const SVG_ICONS: Record<string, string> = {
  pointer:
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
  square_plus:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  rows3:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3"/><path d="M21 15H3"/>',
  sparkles:
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  file_up:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
  layout_grid:
    '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  grid3x3:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  armchair:
    '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  shapes:
    '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  ruler:
    '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
  move_arrows:
    '<path d="M12 2v20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  undo2:
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  redo2:
    '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  square:
    '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  pentagon:
    '<path d="M10.83 2.38a2 2 0 0 1 2.34 0l8 5.74a2 2 0 0 1 .73 2.25l-3.04 9.26a2 2 0 0 1-1.9 1.37H7.04a2 2 0 0 1-1.9-1.37L2.1 10.37a2 2 0 0 1 .73-2.25z"/>',
  minus_line:
    '<path d="M5 12h14"/>',
  circle_outline:
    '<circle cx="12" cy="12" r="10"/>',
  spline:
    '<circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M5 17A12 12 0 0 1 17 5"/>',
  type:
    '<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>',
  copy_plus:
    '<line x1="15" x2="15" y1="12" y2="18"/><line x1="12" x2="18" y1="15" y2="15"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  scissors:
    '<path d="M5.42 9.42 8 12"/><circle cx="4" cy="8" r="2"/><path d="m14 6-8.58 8.58"/><circle cx="4" cy="16" r="2"/><path d="M10.8 14.8 14 18"/><path d="M16 12h-2"/><path d="M22 12h-2"/>',
  merge:
    '<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>',
  scaling:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M14 15H9v-5"/><path d="M16 3h5v5"/><path d="M21 3 9 15"/>',
  rotate_cw:
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  flip_h:
    '<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
  flip_v:
    '<path d="m17 3-5 5-5-5h10"/><path d="m17 21-5-5-5 5h10"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/>',
  copy:
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  list_ordered:
    '<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  eraser:
    '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  move_h:
    '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>',
  move_v:
    '<path d="M12 2v20"/><path d="m8 18 4 4 4-4"/><path d="m8 6 4-4 4 4"/>',
  angle_tool:
    '<path d="M3 21h18"/><path d="M3 21 15 5"/><path d="M10 21a7 7 0 0 0-2.2-5.1"/>',
  zoom_in2:
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  zoom_out2:
    '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
  maximize:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  chevron_down:
    '<path d="m6 9 6 6 6-6"/>',
  ellipsis:
    '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  coins:
    '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
  layout_dashboard:
    '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  columns2:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>',
  square_dashed:
    '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  tag_outline:
    '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  keyboard:
    '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  circle_help:
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  zoom_area:
    '<path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z"/><path d="M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"/>',
};

/** The PrimeIcons class for an app icon name, e.g. `pi pi-plus`. */
export function iconClass(name: string): string {
  return `pi pi-${ICONS[name] ?? 'circle'}`;
}

/** An icon by its app name; decorative unless given a label. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<number | null>(null);
  readonly label = input<string | null>(null);

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly cls = computed(() => iconClass(this.name()));
  /** The drawing of a Lucide name; the markup is this file's own constants, so it is trusted. */
  protected readonly svg = computed(() => {
    const paths = SVG_ICONS[this.name()];
    return paths ? this.sanitizer.bypassSecurityTrustHtml(paths) : null;
  });
}
