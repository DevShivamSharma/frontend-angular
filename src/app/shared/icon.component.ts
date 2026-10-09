import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Icon names used across the app (nav items, audit labels, empty states) mapped to PrimeIcons.
 * Names stay descriptive in data; only this map knows the icon set.
 */
const ICONS: Record<string, string> = {
  add: 'plus',
  add_business: 'shop',
  add_moderator: 'shield',
  arrow_back: 'arrow-left',
  arrow_forward: 'arrow-right',
  block: 'ban',
  cancel: 'times-circle',
  cancel_schedule_send: 'calendar-times',
  check: 'check',
  check_circle: 'check-circle',
  checklist: 'list-check',
  chevron_right: 'chevron-right',
  close: 'times',
  confirmation_number: 'ticket',
  content_copy: 'copy',
  crop_free: 'expand',
  delete: 'trash',
  delete_sweep: 'trash',
  domain: 'building',
  edit: 'pencil',
  event: 'calendar',
  event_available: 'calendar-plus',
  forward_to_inbox: 'envelope',
  gpp_maybe: 'exclamation-circle',
  grid_on: 'th-large',
  grid_view: 'th-large',
  group: 'users',
  history: 'history',
  home: 'home',
  hourglass_empty: 'hourglass',
  how_to_reg: 'user-plus',
  key: 'key',
  left_panel_close: 'angle-double-left',
  left_panel_open: 'angle-double-right',
  link: 'link',
  link_off: 'ban',
  location_city: 'building',
  login: 'sign-in',
  logout: 'sign-out',
  mail: 'envelope',
  manage_accounts: 'user-edit',
  map: 'map',
  meeting_room: 'box',
  menu: 'bars',
  menu_open: 'bars',
  more_vert: 'ellipsis-v',
  open_in_new: 'external-link',
  palette: 'palette',
  person_add: 'user-plus',
  person_remove: 'user-minus',
  remove_moderator: 'shield',
  restart_alt: 'refresh',
  rule: 'list-check',
  search: 'search',
  search_off: 'search-minus',
  sell: 'tag',
  send: 'send',
  shield_person: 'shield',
  space_dashboard: 'objects-column',
  stadium: 'building-columns',
  swap_horiz: 'arrow-right-arrow-left',
  table_view: 'table',
  task_alt: 'check-square',
  tune: 'sliders-h',
  verified: 'verified',
  visibility: 'eye',
  visibility_off: 'eye-slash',
  warning: 'exclamation-triangle',
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
