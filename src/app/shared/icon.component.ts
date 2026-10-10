import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

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
  arrow_forward: 'arrow-right',
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

/** The PrimeIcons class for an app icon name, e.g. `pi pi-plus`. */
export function iconClass(name: string): string {
  return `pi pi-${ICONS[name] ?? 'circle'}`;
}

/** An icon by its app name; decorative unless given a label. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<i
    [class]="cls()"
    [style.font-size.px]="size()"
    [attr.aria-hidden]="label() ? null : 'true'"
    [attr.aria-label]="label()"
    [attr.role]="label() ? 'img' : null"
  ></i>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      vertical-align: middle;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<number | null>(null);
  readonly label = input<string | null>(null);

  protected readonly cls = computed(() => iconClass(this.name()));
}
