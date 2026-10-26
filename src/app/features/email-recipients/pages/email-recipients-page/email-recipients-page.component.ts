import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';

import { ConfirmService } from '../../../../core/confirm/confirm.service';
import { ApiError } from '../../../../core/http/api-error';
import { UrlState } from '../../../../core/navigation/url-state';
import { NotifierService } from '../../../../core/notification/notifier.service';
import { FormFieldComponent } from '../../../../shared/forms/form-field/form-field.component';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/ui/page-header/page-header.component';
import { TableSkeletonComponent } from '../../../../shared/ui/table-skeleton/table-skeleton.component';
import { slugOf } from '../../../categories/domain/category-groups';
import { EmailRecipientsApiService } from '../../data/email-recipients-api.service';
import { Recipient, RecipientList, RecipientListView } from '../../data/email-recipients.models';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** TEMPORARY: four looks for the same page, to compare side by side. Keep one, delete the rest. */
type Design = 'classic' | 'cards' | 'chips' | 'dense';
type Layout = 'split' | 'pills' | 'table' | 'accordion' | 'select';
type Show = 'all' | 'active' | 'paused';

/**
 * Who each email goes to. A list has a slug; the code that sends a mail asks for that slug, so
 * staff change the people without a release, and any module can have a list of its own.
 */
@Component({
  selector: 'app-email-recipients-page',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    DrawerModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    SelectModule,
    SelectButtonModule,
    TextareaModule,
    ToggleSwitchModule,
    TooltipModule,
    FormFieldComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    TableSkeletonComponent,
  ],
  templateUrl: './email-recipients-page.component.html',
  styleUrl: './email-recipients-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailRecipientsPageComponent {
  private readonly api = inject(EmailRecipientsApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifier = inject(NotifierService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly url = new UrlState();

  protected readonly lists = signal<RecipientList[]>([]);
  protected readonly listsLoading = signal(true);
  protected readonly listsFailed = signal(false);

  protected readonly selected = signal<RecipientListView | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailFailed = signal(false);
  protected readonly working = signal(false);

  protected readonly addFailure = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly createFailure = signal<string | null>(null);
  protected readonly copied = signal(false);

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('recipientEmail');

  protected readonly designs: { label: string; value: Design }[] = [
    { label: 'Classic', value: 'classic' },
    { label: 'Cards', value: 'cards' },
    { label: 'Chips', value: 'chips' },
    { label: 'Dense', value: 'dense' },
  ];
  protected readonly design = signal<Design>('classic');

  /** TEMPORARY, like the designs: where the lists sit next to the open list. */
  protected readonly layouts: { label: string; value: Layout }[] = [
    { label: 'Split', value: 'split' },
    { label: 'Pills', value: 'pills' },
    { label: 'Table + drawer', value: 'table' },
    { label: 'Accordion', value: 'accordion' },
    { label: 'Dropdown', value: 'select' },
  ];
  protected readonly layout = signal<Layout>('split');
  protected readonly drawerOpen = signal(false);

  /** The list that is open, or being opened: it is set at once, `selected` when the data is in. */
  protected readonly slug = signal<string | null>(null);

  /** Chips design: addresses typed so far, waiting for "Add". */
  protected readonly chips = signal<string[]>([]);

  /** Dense design: the filter, the search word and the ticked rows. */
  protected readonly showOptions: { label: string; value: Show }[] = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Paused', value: 'paused' },
  ];
  protected readonly show = signal<Show>('all');
  protected readonly query = signal('');
  private readonly chosen = signal<ReadonlySet<string>>(new Set());

  protected readonly skeleton = [
    { width: '1.5rem' },
    { width: '55%' },
    { width: '7rem' },
    { width: '2rem' },
  ];

  protected readonly addForm = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.pattern(EMAIL), Validators.maxLength(254)]],
    name: ['', Validators.maxLength(120)],
  });

  protected readonly listForm = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    slug: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(60),
        Validators.pattern(SLUG),
      ],
    ],
    description: ['', Validators.maxLength(300)],
  });

  /** The slug follows the name until the person types one of their own. */
  private slugTouched = false;

  protected readonly nobody = computed(() => {
    const list = this.selected();
    return !!list && list.active && list.recipients === 0;
  });

  protected readonly paused = computed(() => {
    const list = this.selected();
    return list ? list.people.length - list.recipients : 0;
  });

  protected readonly visible = computed(() => {
    const word = this.query().trim().toLowerCase();
    const show = this.show();
    return (this.selected()?.people ?? []).filter(
      (p) =>
        (show === 'all' || p.active === (show === 'active')) &&
        (!word || `${p.email} ${p.name ?? ''}`.toLowerCase().includes(word)),
    );
  });

  /** Ticked rows that are still on the list (one may have been removed since). */
  protected readonly ticked = computed(() =>
    (this.selected()?.people ?? []).filter((p) => this.chosen().has(p.id)),
  );
  protected readonly allTicked = computed(
    () => this.visible().length > 0 && this.visible().every((p) => this.chosen().has(p.id)),
  );

  constructor() {
    this.loadLists(this.url.text('list'));
    this.listForm.controls.name.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((name) => {
        if (!this.slugTouched) {
          this.listForm.controls.slug.setValue(slugOf(name).slice(0, 60), { emitEvent: false });
        }
      });
  }

  protected loadLists(wanted?: string): void {
    this.listsLoading.set(true);
    this.listsFailed.set(false);
    this.api
      .lists()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          this.lists.set(lists);
          this.listsLoading.set(false);
          const slug =
            lists.find((l) => l.slug === (wanted ?? this.slug()))?.slug ?? lists[0]?.slug;
          if (slug) this.open(slug);
          else this.selected.set(null);
        },
        error: (error: unknown) => {
          this.listsLoading.set(false);
          this.listsFailed.set(true);
          this.notifier.fromError(error, 'The lists could not be loaded');
        },
      });
  }

  protected open(slug: string): void {
    this.url.write({ list: slug });
    this.slug.set(slug);
    if (this.selected()?.slug !== slug) this.selected.set(null); // no other list's people meanwhile
    this.detailLoading.set(true);
    this.detailFailed.set(false);
    this.addFailure.set(null);
    this.addForm.reset({ email: '', name: '' });
    this.chips.set([]);
    this.chosen.set(new Set());
    this.query.set('');
    this.show.set('all');
    this.api
      .list(slug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.selected.set(list);
          this.detailLoading.set(false);
        },
        error: () => {
          this.detailLoading.set(false);
          this.detailFailed.set(true);
        },
      });
  }

  protected openInDrawer(slug: string): void {
    this.open(slug);
    this.drawerOpen.set(true);
  }

  /** A list changed: show it, and keep its line in the list of lists in step. */
  private apply(list: RecipientListView): void {
    this.selected.set(list);
    this.lists.update((all) =>
      all.map((l) => (l.slug === list.slug ? { ...l, ...stripPeople(list) } : l)),
    );
  }

  protected addPerson(): void {
    this.addForm.markAllAsTouched();
    const list = this.selected();
    if (!list || this.addForm.invalid) return;
    const { email, name } = this.addForm.getRawValue();
    this.working.set(true);
    this.addFailure.set(null);
    this.api.addPerson(list.slug, email.trim(), name).subscribe({
      next: (updated) => {
        this.working.set(false);
        this.apply(updated);
        this.addForm.reset({ email: '', name: '' });
        this.emailInput()?.nativeElement.focus(); // ready for the next address
        this.notifier.success('Added', email.trim().toLowerCase());
      },
      error: (error: unknown) => {
        this.working.set(false);
        this.addFailure.set(
          error instanceof ApiError ? error.message : 'The address could not be added.',
        );
      },
    });
  }

  /** The switch moved when it was clicked; it stays so only if ITPO accepts. */
  protected togglePerson(person: Recipient, active: boolean): void {
    const list = this.selected();
    if (!list) return;
    this.api.setPersonActive(list.slug, person.id, active).subscribe({
      next: (updated) => this.apply(updated),
      error: (error: unknown) => {
        this.selected.update((l) => (l ? { ...l } : l));
        this.notifier.fromError(error, 'The address could not be changed');
      },
    });
  }

  protected async removePerson(person: Recipient): Promise<void> {
    const list = this.selected();
    if (!list) return;
    const go = await this.confirm.ask({
      header: 'Remove address',
      message: `Remove ${person.email} from "${list.name}"? They stop getting these emails. To pause them for now, switch them off instead.`,
      acceptLabel: 'Remove',
      danger: true,
    });
    if (!go) return;
    this.api.removePerson(list.slug, person.id).subscribe({
      next: (updated) => {
        this.apply(updated);
        this.notifier.success('Removed', person.email);
      },
      error: (error: unknown) => this.notifier.fromError(error, 'The address could not be removed'),
    });
  }

  protected async toggleList(active: boolean): Promise<void> {
    const list = this.selected();
    if (!list) return;
    if (!active) {
      const go = await this.confirm.ask({
        header: 'Switch the list off',
        message: `Nobody will get the emails that use "${list.name}" until you switch it on again.`,
        acceptLabel: 'Switch off',
        danger: true,
      });
      if (!go) {
        this.selected.update((l) => (l ? { ...l } : l));
        return;
      }
    }
    this.api.setListActive(list.slug, active).subscribe({
      next: (updated) => this.apply(updated),
      error: (error: unknown) => {
        this.selected.update((l) => (l ? { ...l } : l));
        this.notifier.fromError(error, 'The list could not be changed');
      },
    });
  }

  protected async deleteList(): Promise<void> {
    const list = this.selected();
    if (!list || list.system) return;
    const go = await this.confirm.ask({
      header: 'Delete list',
      message: `Delete "${list.name}" and its ${list.people.length} ${list.people.length === 1 ? 'address' : 'addresses'} for good? Code that asks for "${list.slug}" will find nobody. To pause it, switch it off instead.`,
      acceptLabel: 'Delete',
      danger: true,
    });
    if (!go) return;
    this.api.deleteList(list.slug).subscribe({
      next: () => {
        this.notifier.success('List deleted', list.name);
        this.selected.set(null);
        this.loadLists();
      },
      error: (error: unknown) => this.notifier.fromError(error, 'The list could not be deleted'),
    });
  }

  protected async copySlug(): Promise<void> {
    const slug = this.selected()?.slug;
    if (!slug) return;
    try {
      await navigator.clipboard.writeText(slug);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      this.notifier.error('Could not copy', 'Select the slug and copy it by hand.');
    }
  }

  /* ---- chips design: type or paste several addresses, then add them all ---- */

  /** Turn what was typed or pasted into chips; whatever is not an address stays in the box. */
  protected takeChips(input: HTMLInputElement): void {
    const onList = new Set(this.selected()?.people.map((p) => p.email.toLowerCase()));
    const left: string[] = [];
    const next = [...this.chips()];
    for (const word of input.value.split(/[\s,;]+/).filter(Boolean)) {
      const email = word.toLowerCase();
      if (!EMAIL.test(email)) left.push(word);
      else if (!next.includes(email) && !onList.has(email)) next.push(email);
    }
    this.chips.set(next);
    input.value = left.join(' ');
    this.addFailure.set(left.length ? `"${left[0]}" is not an email address.` : null);
  }

  protected chipKey(event: KeyboardEvent, input: HTMLInputElement): void {
    if (['Enter', ',', ';', ' '].includes(event.key) && input.value.trim()) {
      event.preventDefault();
      this.takeChips(input);
    } else if (event.key === 'Backspace' && !input.value) {
      this.chips.update((all) => all.slice(0, -1));
    }
  }

  /** The pasted text lands in the box after this event, so read it one tick later. */
  protected chipPasted(input: HTMLInputElement): void {
    setTimeout(() => this.takeChips(input));
  }

  protected dropChip(email: string): void {
    this.chips.update((all) => all.filter((e) => e !== email));
  }

  /** One request per address, so one bad address does not lose the rest. */
  protected async addChips(input: HTMLInputElement): Promise<void> {
    this.takeChips(input);
    const list = this.selected();
    if (!list || !this.chips().length) return;
    this.working.set(true);
    const failed: string[] = [];
    let added = 0;
    for (const email of this.chips()) {
      try {
        this.apply(await firstValueFrom(this.api.addPerson(list.slug, email, '')));
        added++;
      } catch (error) {
        failed.push(email);
        this.addFailure.set(
          error instanceof ApiError ? error.message : `${email} could not be added.`,
        );
      }
    }
    this.working.set(false);
    this.chips.set(failed);
    if (added) this.notifier.success('Added', `${added} ${added === 1 ? 'address' : 'addresses'}`);
    input.focus();
  }

  /* ---- dense design: search, filter and act on several rows at once ---- */

  protected isTicked(person: Recipient): boolean {
    return this.chosen().has(person.id);
  }

  protected tick(person: Recipient, checked: boolean): void {
    this.chosen.update((all) => {
      const next = new Set(all);
      if (checked) next.add(person.id);
      else next.delete(person.id);
      return next;
    });
  }

  protected tickAll(checked: boolean): void {
    this.chosen.set(checked ? new Set(this.visible().map((p) => p.id)) : new Set());
  }

  protected async pauseTicked(active: boolean): Promise<void> {
    const list = this.selected();
    const people = this.ticked().filter((p) => p.active !== active);
    if (!list || !people.length) return;
    try {
      for (const p of people) {
        this.apply(await firstValueFrom(this.api.setPersonActive(list.slug, p.id, active)));
      }
      this.notifier.success(active ? 'Switched on' : 'Paused', `${people.length} addresses`);
    } catch (error) {
      this.notifier.fromError(error, 'Some addresses could not be changed');
    }
  }

  protected async removeTicked(): Promise<void> {
    const list = this.selected();
    const people = this.ticked();
    if (!list || !people.length) return;
    const go = await this.confirm.ask({
      header: 'Remove addresses',
      message: `Remove ${people.length} ${people.length === 1 ? 'address' : 'addresses'} from "${list.name}"? They stop getting these emails. To pause them for now, use Pause instead.`,
      acceptLabel: 'Remove',
      danger: true,
    });
    if (!go) return;
    try {
      for (const p of people) {
        this.apply(await firstValueFrom(this.api.removePerson(list.slug, p.id)));
      }
      this.chosen.set(new Set());
      this.notifier.success('Removed', `${people.length} addresses`);
    } catch (error) {
      this.notifier.fromError(error, 'Some addresses could not be removed');
    }
  }

  /** The letter in the round badge: the name when there is one, else the address. */
  protected initial(person: Recipient): string {
    return (person.name || person.email).trim().charAt(0).toUpperCase();
  }

  protected openNew(): void {
    this.slugTouched = false;
    this.createFailure.set(null);
    this.listForm.reset({ name: '', slug: '', description: '' });
    this.dialogOpen.set(true);
  }

  protected slugEdited(): void {
    this.slugTouched = true;
  }

  protected createList(): void {
    this.listForm.markAllAsTouched();
    if (this.listForm.invalid) return;
    const value = this.listForm.getRawValue();
    this.working.set(true);
    this.createFailure.set(null);
    this.api
      .createList({
        slug: value.slug,
        name: value.name.trim(),
        ...(value.description.trim() && { description: value.description.trim() }),
      })
      .subscribe({
        next: (created) => {
          this.working.set(false);
          this.dialogOpen.set(false);
          this.notifier.success('List created', created.name);
          this.loadLists(created.slug);
        },
        error: (error: unknown) => {
          this.working.set(false);
          this.createFailure.set(
            error instanceof ApiError ? error.message : 'The list could not be created.',
          );
        },
      });
  }
}

function stripPeople(list: RecipientListView): RecipientList {
  const { people: _people, ...rest } = list;
  return rest;
}
