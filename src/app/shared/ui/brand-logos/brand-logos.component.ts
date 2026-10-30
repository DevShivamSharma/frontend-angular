import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The official marks, in ITPO's order: the national emblem, ITPO, then Bharat Mandapam. */
@Component({
  selector: 'app-brand-logos',
  templateUrl: './brand-logos.component.html',
  styleUrl: './brand-logos.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandLogosComponent {}
