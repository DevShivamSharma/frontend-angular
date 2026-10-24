import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AppDialog } from '../dialog/app-dialog.service';
import { ConfirmDialogData } from './confirm-dialog.component';
import { ConfirmService } from './confirm.service';

describe('ConfirmService', () => {
  let opened: { data?: ConfirmDialogData } | undefined;
  let answer: boolean | undefined;
  let service: ConfirmService;

  beforeEach(() => {
    opened = undefined;
    answer = true;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AppDialog,
          useValue: {
            open: (_component: unknown, options: { data?: ConfirmDialogData }) => {
              opened = options;
              return of(answer);
            },
          },
        },
      ],
    });
    service = TestBed.inject(ConfirmService);
  });

  it('should resolve true when the user goes ahead', async () => {
    const go = await service.ask({
      header: 'Create',
      message: 'Create it?',
      acceptLabel: 'Create',
    });

    expect(go).toBe(true);
    expect(opened!.data!.acceptLabel).toBe('Create');
    expect(opened!.data!.rejectLabel).toBe('Cancel');
    expect(opened!.data!.danger).toBe(false);
  });

  it('should resolve false when the user declines or closes the dialog', async () => {
    answer = undefined;
    const go = await service.ask({
      header: 'Remove',
      message: 'Remove it?',
      acceptLabel: 'Remove',
      danger: true,
    });

    expect(go).toBe(false);
    expect(opened!.data!.danger).toBe(true);
    expect(opened!.data!.icon).toBe('pi pi-exclamation-triangle');
  });
});
