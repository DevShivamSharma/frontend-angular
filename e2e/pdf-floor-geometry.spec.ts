import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { preparePdfHall, preparePdfFloorPlan, pdfReferenceCrop } from '../src/app/planner/pdf-workspace/pdf-hall-plan';
import { calibrate, type PdfWorkspace, type PdfObject, area } from '../src/app/planner/pdf-workspace/pdf-workspace.model';
import { workspaceBackup, readWorkspaceBackup } from '../src/app/planner/pdf-workspace/pdf-workspace.backup';
import { buildPdfFloorPlan } from '../src/app/planner/three/pdf-floor-renderer';
import { pointInPolygon } from '../src/app/planner/geometry/placement-rules';

// These tests exercise data and Three geometry in Node; no browser is launched.
function fixture(): PdfWorkspace {
  const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF').buffer;
  const object = (id: string, kind: PdfObject['kind'], x: number): PdfObject => {
    const points = [{x,y:0},{x:x+10,y:0},{x:x+10,y:20},{x,y:20}];
    return { id, name:id, kind, page:1, points, sourcePoints:points, reviewed:true, heightMetres:null };
  };
  return { version:1, id:'floors', name:'floors.pdf', pdf, sha256:createHash('sha256').update(Buffer.from(pdf)).digest('hex'),
    page:1, updatedAt:1, pageCalibrations:{1:calibrate({x:0,y:0},{x:10,y:0},2)},
    objects:[object('left','hall',0), object('right','hall',20),
      {...object('shared','foyer',10), adjacentHallIds:['left','right']}] };
}

test('shared foyer survives backup; invalid connections fail instead of disappearing', async () => {
  const doc = fixture();
  const restored = await readWorkspaceBackup(await workspaceBackup(doc).arrayBuffer());
  expect(restored.objects).toEqual(doc.objects);
  expect(Buffer.from(restored.pdf)).toEqual(Buffer.from(doc.pdf));
  for (const adjacentHallIds of [['missing'], ['left','left'], ['shared']]) {
    const invalid = structuredClone(doc);
    invalid.objects[2].adjacentHallIds = adjacentHallIds;
    await expect(readWorkspaceBackup(await workspaceBackup(invalid).arrayBuffer())).rejects.toThrow();
  }
  const wrongPage = structuredClone(doc);
  wrongPage.objects[2].page = 2;
  await expect(readWorkspaceBackup(await workspaceBackup(wrongPage).arrayBuffer())).rejects.toThrow('connection');
});

test('foyer context keeps hall origin and placement boundary, and rejects unknown scale or meaning', () => {
  const doc = fixture(), prepared = preparePdfHall(doc, doc.objects[0]);
  const before = structuredClone(prepared.hall);
  const plan = preparePdfFloorPlan(doc, prepared.binding);
  expect(plan.regions.map(r => r.id)).toEqual(['left','shared']);
  expect(plan.regions[1].boundary).toEqual([{x:1,z:-2},{x:3,z:-2},{x:3,z:2},{x:1,z:2}]);
  expect(pointInPolygon({x:2,z:0}, prepared.hall.boundary!)).toBe(false);
  expect(prepared.hall).toEqual(before);
  const reference = pdfReferenceCrop(prepared.binding, plan);
  expect(reference).toEqual({crop:{x:0,y:0,width:20,height:20},centre:{x:1,z:0}});
  expect(pdfReferenceCrop(prepared.binding, null).centre).toEqual({x:0,z:0});
  for (const patch of [{reviewed:false}, {adjacentHallIds:['missing']},
    {calibration:calibrate({x:0,y:0},{x:10,y:0},3)}]) {
    const invalid = structuredClone(doc);
    Object.assign(invalid.objects[2], patch);
    expect(() => preparePdfFloorPlan(invalid, prepared.binding)).toThrow();
  }
});

test('actual prepared PDF produces six real floors, stair notches, and aligned hall/foyer context', async () => {
  const file = process.env['PDF_PREPARED_PACKAGE'];
  test.skip(!file, 'Requires the private prepared PDF package; source PDF is not committed.');
  const doc = await readWorkspaceBackup(Uint8Array.from(readFileSync(file!)).buffer);
  const hall9 = doc.objects.find(o => o.name === 'Hall 9')!;
  const { hall, binding } = preparePdfHall(doc, hall9);
  const plan = preparePdfFloorPlan(doc, binding, true);
  expect(plan.regions.map(r => r.name)).toEqual(['Hall 10','Hall 9','Hall 8','Foyer C','Foyer B','Foyer A']);
  expect(doc.objects.every(o => o.heightMetres === null)).toBe(true);
  const group = buildPdfFloorPlan(plan, false);
  expect(group.children).toHaveLength(6);
  group.updateMatrixWorld(true);
  for (const region of plan.regions) {
    const mesh = group.getObjectByName(`pdf-floor-${region.id}`) as THREE.Mesh<THREE.ShapeGeometry>;
    expect(mesh.geometry.type).toBe('ShapeGeometry');
    const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index!;
    let triangles = 0;
    for (let i=0; i<indices.count; i+=3) {
      const [a,b,c] = [0,1,2].map(j => new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i+j)).applyMatrix4(mesh.matrixWorld));
      expect(Math.abs(a.y)).toBeLessThan(1e-10);
      triangles += new THREE.Triangle(a,b,c).getArea();
    }
    const source = doc.objects.find(o => o.id === region.id)!;
    expect(triangles).toBeCloseTo(area(source.points) * binding.metresPerUnit ** 2, 3);
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  }
  // Known source features, independent of generated triangle indices.
  const toWorld = (x: number,y: number) => ({x:(x-1475.55)*binding.metresPerUnit,z:(y-1209.955)*binding.metresPerUnit});
  const b = plan.regions.find(r => r.name === 'Foyer B')!;
  const a = plan.regions.find(r => r.name === 'Foyer A')!;
  const c = plan.regions.find(r => r.name === 'Foyer C')!;
  expect(pointInPolygon(toWorld(1300,1150), b.boundary)).toBe(false); // stair enclosure
  expect(pointInPolygon(toWorld(1240,1150), b.boundary)).toBe(true);
  expect(pointInPolygon(toWorld(1700,1200), a.boundary)).toBe(false); // toilets above A
  expect(pointInPolygon(toWorld(1700,1280), a.boundary)).toBe(true);
  expect(pointInPolygon(toWorld(820,982), c.boundary)).toBe(false); // stair run
  expect(pointInPolygon(toWorld(780,1100), c.boundary)).toBe(true);
  expect(pointInPolygon(toWorld(1700,1280), hall.boundary!)).toBe(false);
  const local = preparePdfFloorPlan(doc,binding);
  expect(local.regions.map(r=>r.name)).toEqual(['Hall 9','Foyer B','Foyer A']);
  const {crop,centre} = pdfReferenceCrop(binding,local);
  expect(crop.x).toBeCloseTo(1210.74,8);
  expect(crop.y).toBeCloseTo(1079.74,8);
  expect(crop.width).toBeCloseTo(540.63,8);
  expect(crop.height).toBeCloseTo(260.43,8);
  expect(centre.x).toBeCloseTo(5.505*binding.metresPerUnit,8);
});
