import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DrawerModule } from 'primeng/drawer';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
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

/**
 * Who each email goes to. A table of lists; a list opens in a drawer to show, add and switch the
 * people on it. A list has a slug: the code that sends a mail asks for that slug, so staff change
 * the people without a release, and any module can have a list of its own.
 */
@Component({
  selector: 'app-email-recipients-page',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    DrawerModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
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
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly query = signal('');
  /** Bumped to draw the switches as the data has them, after a change was declined or refused. */
  protected readonly redraw = signal(0);
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.lists().filter((l) => !q || l.name.toLowerCase().includes(q) || l.slug.includes(q));
  });
  /** Lists switched on that no one is on: their mails go nowhere. */
  protected readonly empty = computed(
    () => this.lists().filter((l) => l.active && l.recipients === 0).length,
  );

  protected readonly drawerOpen = signal(false);
  protected readonly selected = signal<RecipientListView | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailFailed = signal(false);
  protected readonly working = signal(false);
  protected readonly addFailure = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly dialogOpen = signal(false);
  protected readonly createFailure = signal<string | null>(null);

  protected readonly skeleton = [
    { width: '1.5rem' },
    { width: '55%' },
    { width: '4rem' },
    { width: '7rem' },
    { width: '2rem' },
  ];
  protected readonly peopleSkeleton = [{ width: '1.5rem' }, { width: '60%' }, { width: '5rem' }];

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

  constructor() {
    this.load(this.url.text('list'));
    // PrimeNG makes the drawer a "complementary" landmark with no name; the page has one more, so
    // each needs its own. The drawer sits under <body>, so it is named from here.
    effect(() => {
      const name = this.selected()?.name;
      if (!this.drawerOpen()) return;
      setTimeout(() =>
        document
          .querySelector('.p-drawer.people-drawer')
          ?.setAttribute('aria-label', `People on ${name ?? 'the list'}`),
      );
    });
    this.listForm.controls.name.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((name) => {
        if (!this.slugTouched) {
          this.listForm.controls.slug.setValue(slugOf(name).slice(0, 60), { emitEvent: false });
        }
      });
  }

  protected load(open?: string): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api
      .lists()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lists) => {
          this.lists.set(lists);
          this.loading.set(false);
          // A shared link opens the list it names.
          if (open && lists.some((l) => l.slug === open)) this.openList(open);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.notifier.fromError(error, 'The lists could not be loaded');
        },
      });
  }

  protected openList(slug: string): void {
    this.url.write({ list: slug });
    this.drawerOpen.set(true);
    this.detailLoading.set(true);
    this.detailFailed.set(false);
    this.addFailure.set(null);
    this.addForm.reset({ email: '', name: '' });
    this.selected.set(this.selected()?.slug === slug ? this.selected() : null);
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

  protected drawerChanged(open: boolean): void {
    this.drawerOpen.set(open);
    if (!open) this.url.write({ list: null });
  }

  /** A list changed: show it, and keep its row in the table in step. */
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
        this.redraw.update((n) => n + 1);
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

  /** From the table (a list's own switch) or from the drawer. */
  protected async toggleList(list: RecipientList, active: boolean): Promise<void> {
    if (!active) {
      const go = await this.confirm.ask({
        header: 'Switch the list off',
        message: `Nobody will get the emails that use "${list.name}" until you switch it on again.`,
        acceptLabel: 'Switch off',
        danger: true,
      });
      if (!go) {
        this.redraw.update((n) => n + 1);
        return;
      }
    }
    this.api.setListActive(list.slug, active).subscribe({
      next: (updated) => this.apply(updated),
      error: (error: unknown) => {
        this.redraw.update((n) => n + 1);
        this.notifier.fromError(error, 'The list could not be changed');
      },
    });
  }

  protected async deleteList(list: RecipientList): Promise<void> {
    if (list.system) return;
    const go = await this.confirm.ask({
      header: 'Delete list',
      message: `Delete "${list.name}" and everyone on it for good? Code that asks for "${list.slug}" will find nobody. To pause it, switch it off instead.`,
      acceptLabel: 'Delete',
      danger: true,
    });
    if (!go) return;
    this.api.deleteList(list.slug).subscribe({
      next: () => {
        this.notifier.success('List deleted', list.name);
        this.lists.update((all) => all.filter((l) => l.slug !== list.slug));
        if (this.selected()?.slug === list.slug) this.drawerChanged(false);
      },
      error: (error: unknown) => this.notifier.fromError(error, 'The list could not be deleted'),
    });
  }

  protected async copySlug(slug: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(slug);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      this.notifier.error('Could not copy', 'Select the slug and copy it by hand.');
    }
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
          this.lists.update((all) => [...all, stripPeople(created)]);
          // A new list is empty: open it, so the first address is one step away.
          this.openList(created.slug);
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
