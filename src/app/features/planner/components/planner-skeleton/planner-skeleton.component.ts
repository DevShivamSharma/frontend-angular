import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SkeletonModule } from 'primeng/skeleton';

/** What the planner shows while it opens: the shape of its ribbon, panels and floor, so nothing jumps when they arrive. */
@Component({
  selector: 'app-planner-skeleton',
  imports: [SkeletonModule],
  templateUrl: './planner-skeleton.component.html',
  styleUrl: './planner-skeleton.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-label': 'Opening the planner' },
})
export class PlannerSkeletonComponent {
  protected readonly tools = Array.from({ length: 14 }, (_, i) => i);
}
