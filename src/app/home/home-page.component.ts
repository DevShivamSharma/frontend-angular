import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewEncapsulation, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { createVenueViewer } from './venue-viewer';
@Component({
    selector: 'app-home-page',
    standalone: true,
    imports: [RouterLink],
    templateUrl: './home-page.component.html',
    styleUrl: './home-page.component.css',
    // The vanilla document's CSS must neither inherit planner rules nor style the planner.
    encapsulation: ViewEncapsulation.ShadowDom,
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent implements AfterViewInit, OnDestroy {
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly zone = inject(NgZone);
    private dispose?: () => void;
    ngAfterViewInit(): void {
        this.zone.runOutsideAngular(() => {
            this.dispose = createVenueViewer(this.element.nativeElement.shadowRoot!);
        });
    }
    ngOnDestroy(): void {
        this.dispose?.();
    }
}
