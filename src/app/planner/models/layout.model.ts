import { Hall, HallShape } from './hall.model';
import { GateSide, StallInput } from './stall.model';

/** Row shape rendered in the "Saved Layouts" list (`App.js:593`). */
export interface LayoutSummary {
  id: number | string;
  name: string;
  stallCount?: number;
  stalls?: unknown[];
}

/** Response of `GET /api/layout/{id}` as consumed by `openLayout` (`App.js:575`). */
export interface LayoutDetail {
  layout?: { id?: number | string; name?: string };
  name?: string;
  hall?: Hall;
  stalls?: StallInput[];
}

/** Response of `POST /api/layout/save` as consumed by `saveLayout` (`App.js:572`). */
export interface LayoutSaveResponse {
  id?: number | string;
  layout?: { id?: number | string };
}

/** Hall part of the save/update payload built by `buildApiPayload()` (`App.js:548-568`). */
export interface HallPayload {
  id?: number;
  name: string;
  shape: HallShape;
  width: number;
  length: number;
  radius: number;
  blockedAreas?: unknown[];
}

/** Stall part of the save/update payload built by `buildApiPayload()`. */
export interface StallPayload {
  id?: number;
  name: string;
  width: number;
  length: number;
  height: number;
  posX: number;
  posZ: number;
  color: string;
  gateSide: GateSide;
  openSides?: GateSide[];
}

/** Body sent to `POST /api/layout/save` and `PUT /api/layout/{id}`. */
export interface LayoutSaveRequest {
  layoutName: string;
  hall: HallPayload;
  stalls: StallPayload[];
}
