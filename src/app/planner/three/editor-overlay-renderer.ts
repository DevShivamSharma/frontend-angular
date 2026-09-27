import * as THREE from 'three';

import { Footprint, footprintRect, Rect, ViolationGeometry } from '../geometry/placement-rules';
import type { EditorOverlay } from '../planner-store.service';
import { makeTextSprite } from './text-sprite';
import { dashedRect, flatPolygon, flatRect, inflate, outline, rectPoints } from './zones-renderer';

const VALID = '#16a34a';
const INVALID = '#dc2626';
const SUGGESTION = '#2563eb';
const HIGHLIGHT = '#f59e0b';
const FREE = '#22c55e';

/** Height of the translucent draft box: tall enough to read as a stall, low enough to see past. */
const DRAFT_HEIGHT = 0.6;

/**
 * Layer 6 — the drag preview (plus the suggested spot after a rejection). All of it is real
 * scene geometry: a translucent box snapped to the grid, its outline, a halo at the required
 * passage width, and an in-scene label with the size and the valid/invalid state.
 *
 * The suggestion box carries `userData.suggestion = true`; the scene raycasts it so a click
 * places the stall there.
 */
export function buildPreview(overlay: EditorOverlay): THREE.Group {
  const group = new THREE.Group();
  group.name = 'draft-preview';

  const draft = overlay.draft;
  if (draft) {
    const color = draft.valid ? VALID : INVALID;
    group.add(draftBox(draft.footprint, color, 0.28));

    if (overlay.passageWidth) {
      group.add(dashedRect(inflate(footprintRect(draft.footprint), overlay.passageWidth), '#f59e0b', 0.16));
    }

    const { width, length } = draft.footprint;
    const lines = [
      `${fmt(width)} × ${fmt(length)} m · ${fmt(width * length)} m²`,
      draft.valid ? '✓ Valid placement' : `✗ ${truncate(draft.violations[0]?.message ?? 'Invalid placement', 58)}`
    ];
    if (!draft.valid && draft.violations.length > 1) lines.push(`+ ${draft.violations.length - 1} more rule(s)`);
    const label = makeTextSprite(lines, {
      color: '#ffffff',
      background: draft.valid ? 'rgba(21,128,61,0.94)' : 'rgba(185,28,28,0.94)',
      lineHeight: 0.75,
      bold: true
    });
    label.position.set(draft.footprint.posX, DRAFT_HEIGHT + 1.6, draft.footprint.posZ);
    group.add(label);
  }

  if (overlay.suggestion) {
    const box = draftBox(overlay.suggestion, SUGGESTION, 0.3);
    box.traverse(child => (child.userData['suggestion'] = true));
    group.add(box);

    const label = makeTextSprite(['Suggested spot', 'Click to place here'], {
      color: '#ffffff',
      background: 'rgba(29,78,216,0.94)',
      lineHeight: 0.7,
      bold: true
    });
    label.position.set(overlay.suggestion.posX, DRAFT_HEIGHT + 1.5, overlay.suggestion.posZ);
    group.add(label);
  }

  return group;
}

/**
 * Layer 7 — validation overlays: red where a rule is broken (the overlapping part, the too-narrow
 * gap, the clearance band), amber for a problem the user asked to locate.
 */
export function buildViolations(overlay: EditorOverlay): THREE.Group {
  const group = new THREE.Group();
  group.name = 'violations';

  for (const g of overlay.violations) addGeometry(group, g, INVALID, 0.5, 0.2);
  for (const g of overlay.highlight) addGeometry(group, g, HIGHLIGHT, 0.45, 0.21);

  return group;
}

/**
 * A plan from the Assist tab: one translucent box per proposed stall, blue where it fits and
 * red where it does not, so the whole plan can be looked at before any of it is applied.
 */
export function buildProposals(
  proposals: ReadonlyArray<{ footprint: Footprint; valid: boolean; label?: string }> | null
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'proposals';
  if (!proposals?.length) return group;

  for (const proposal of proposals) {
    group.add(draftBox(proposal.footprint, proposal.valid ? SUGGESTION : INVALID, 0.24));
    if (proposal.label) {
      const label = makeTextSprite([proposal.label], { color: '#ffffff',
        background: proposal.valid ? SUGGESTION : INVALID, lineHeight: 0.7, bold: true });
      label.position.set(proposal.footprint.posX, 1.5, proposal.footprint.posZ);
      group.add(label);
    }
  }

  return group;
}

/**
 * "Show free space": every 1-cell square covered by at least one valid placement of the
 * selected size, drawn as one instanced mesh (thousands of cells, one draw call).
 */
export function buildFreeSpace(placements: Footprint[] | null, cell: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'free-space';
  if (!placements?.length) return group;

  const cells = new Map<string, { x: number; z: number }>();
  for (const p of placements) {
    const r = footprintRect(p);
    for (let x = r.minX; x < r.maxX - 1e-9; x += cell) {
      for (let z = r.minZ; z < r.maxZ - 1e-9; z += cell) {
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        if (!cells.has(key)) cells.set(key, { x: x + cell / 2, z: z + cell / 2 });
      }
    }
  }

  const geometry = new THREE.PlaneGeometry(cell * 0.92, cell * 0.92);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: FREE, transparent: true, opacity: 0.35, depthWrite: false }),
    cells.size
  );
  const matrix = new THREE.Matrix4();
  let i = 0;
  for (const c of cells.values()) {
    matrix.makeTranslation(c.x, 0.145, c.z);
    mesh.setMatrixAt(i++, matrix);
  }
  mesh.renderOrder = 6;
  group.add(mesh);
  return group;
}

function draftBox(f: Footprint, color: string, opacity: number): THREE.Group {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(f.width, DRAFT_HEIGHT, f.length),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  box.position.set(f.posX, DRAFT_HEIGHT / 2 + 0.1, f.posZ);
  box.rotation.y = -(f.rotation ?? 0) * Math.PI / 180;
  box.renderOrder = 8;
  group.add(box);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(box.geometry),
    new THREE.LineBasicMaterial({ color, depthTest: false })
  );
  edges.position.copy(box.position);
  edges.rotation.copy(box.rotation);
  edges.renderOrder = 9;
  group.add(edges);
  return group;
}

function addGeometry(group: THREE.Group, g: ViolationGeometry, color: string, opacity: number, y: number): void {
  if (g.type === 'rect') {
    const rect = visibleRect(g.rect);
    if (!rect) return;
    group.add(flatRect(rect, color, opacity, y));
    group.add(outline(rectPoints(rect), color, y + 0.01));
  } else if (g.points.length >= 3) {
    group.add(outline(g.points, color, y + 0.01));
    group.add(flatPolygon(g.points, color, opacity * 0.4, y));
  }
}

/** A copy widened so degenerate strips (e.g. a zero-width gap) still show a sliver. */
function visibleRect(r: Rect): Rect | null {
  if (![r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite)) return null;
  const out = { ...r };
  if (out.maxX - out.minX < 0.1) {
    out.minX -= 0.05;
    out.maxX += 0.05;
  }
  if (out.maxZ - out.minZ < 0.1) {
    out.minZ -= 0.05;
    out.maxZ += 0.05;
  }
  return out;
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
