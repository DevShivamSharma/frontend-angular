import fs from 'node:fs';

const dir = 'docs/reference-interiors';
const inv = JSON.parse(fs.readFileSync(`${dir}/inventory.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync('src/assets/venue/interiors/manifest.json', 'utf8'));
const adapted = JSON.parse(fs.readFileSync(`${dir}/adapted-halls.json`, 'utf8'));
const sourceHalls = [
  { id: 1, min: [135, -45], max: [255, 55], pads: 258 },
  { id: 2, min: [-201, -190], max: [-105, -110], pads: 138 },
  { id: 3, min: [-99, -190], max: [-3, -110], pads: 150 },
  { id: 4, min: [3, -190], max: [99, -110], pads: 160 },
  { id: 5, min: [105, -190], max: [201, -110], pads: 146 },
  { id: 14, min: [-265, -40], max: [-165, 40], pads: 144 },
];
// Spatial membership is evidence, not a recovered semantic object hierarchy.
for (const h of sourceHalls) {
  h.containedInteriorComponents = [];
  h.crossingInteriorComponents = [];
  for (const n of inv.nodes.filter((n) => n.index >= 88 && n.index <= 130)) {
    for (const [primitive, p] of (n.primitives || []).entries()) {
      for (const c of p.components) {
        const [lo, hi] = c.bounds;
        const overlaps = hi[0] >= h.min[0] && lo[0] <= h.max[0] && hi[2] >= h.min[1] && lo[2] <= h.max[1];
        if (!overlaps) continue;
        const contained = lo[0] >= h.min[0] - 0.1 && hi[0] <= h.max[0] + 0.1 && lo[2] >= h.min[1] - 0.1 && hi[2] <= h.max[1] + 0.1;
        (contained ? h.containedInteriorComponents : h.crossingInteriorComponents).push({ node: n.index, name: n.name, primitive, component: c.index, material: p.materialName, bounds: c.bounds, triangles: c.triangles });
      }
    }
  }
}
fs.writeFileSync(`${dir}/hall-inventory.json`, JSON.stringify({ method: 'World-space component bounds within source exhibition floor X/Z bounds, 0.1-unit tolerance. Crossing components are explicitly separate. Component count is not object or booth count.', halls: sourceHalls }, null, 2));
const fmt = (n) => n.toLocaleString('en-US');
const assetRows = manifest.components.map((c) => `<tr><td><a href="../../src/assets/venue/interiors/${c.file}">${c.name}</a></td><td>${fmt(c.bytes)}</td><td>${fmt(c.triangles)}</td><td>${['exit-sign', 'fire-door', 'stage', 'plenary-seating'].includes(c.name) ? 'Library only' : 'Integrated'}</td></tr>`).join('');
const hallRows = sourceHalls.map((h) => {
  const a = adapted.find((a) => a.id === `hall${h.id}`);
  return `<tr><td>Hall ${h.id}</td><td>${h.min.join(', ')} → ${h.max.join(', ')}</td><td>${h.max[0] - h.min[0]} × ${h.max[1] - h.min[1]}</td><td>${h.pads}</td><td>${a.width.toFixed(1)} × ${a.depth.toFixed(1)}</td></tr>`;
}).join('');
const gallery = [2, 3, 4, 5, 14].map((id) => `<figure><a href="views/after-hall${id}-day.png"><img loading="lazy" src="views/after-hall${id}-day.png" alt="Integrated Hall ${id}, daylight"></a><figcaption>Hall ${id} · daylight</figcaption></figure>`).join('');
fs.writeFileSync(`${dir}/report.html`, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bharat Mandapam — interior extraction and integration</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f2ec;color:#24322b;font:16px/1.6 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:48px 24px}h1{font:500 clamp(30px,4vw,48px)/1.13 Georgia,serif;max-width:850px}h2{font-size:24px;margin-top:42px}h3{font-size:18px}p{max-width:930px}a{color:#295944;text-underline-offset:3px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #ccd2ca}th{background:#e3e8df}code{overflow-wrap:anywhere;font-size:13px}.scroll{overflow:auto}.views{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid #ccd2ca}figcaption{font-size:14px;padding:8px 0;color:#506055}.note{border-left:3px solid #68816d;padding-left:18px}summary{cursor:pointer;font-weight:650;padding:14px 0}footer{margin-top:40px;border-top:1px solid #ccd2ca;padding-top:20px;font-size:14px}@media(max-width:720px){main{padding:24px 16px}.views{grid-template-columns:1fr}}@media print{details{display:block}main{max-width:none}.views{break-inside:avoid}a{color:inherit}}
</style><main>
<p>INSPECTION &amp; DELIVERY · 9 OCTOBER 2026</p>
<h1>Bharat Mandapam interiors, fitted to the existing 3D venue</h1>
<p>Thirteen reusable GLB components were extracted; nine are integrated into Halls 1–5 and 14. The existing building shell remains intact. Walkthrough controls, guided routes, automatic roof cutaways, night lighting and hall GLB export are implemented in the viewer.</p>
<p><a href="http://localhost:4301/?interior=hall1">Open the local integrated viewer</a> · <a href="inventory.json">Complete source inventory</a> · <a href="hall-inventory.json">Per-hall component inventory</a> · <a href="../../src/assets/venue/interiors/manifest.json">Extraction provenance</a></p>
<p class="note">The file contains <strong>six exhibition halls</strong>, plus foyer and plenary interiors. It has <strong>no cameras and no animations</strong>. The file alone cannot establish which two spaces the original viewer presented, or reproduce that viewer’s tour. This furnishing layout is an adaptation to the current model’s geometry, not a surveyed or approved event plan.</p>
<h2>Before and after</h2>
<p>Hall 1 uses the same camera and daylight settings in both images. “Before” hides the added interior layer; the new navigation controls remain visible for the controlled comparison.</p>
<div class="views"><figure><img src="views/before-hall1.png" alt="Original Hall 1 shell before interior integration"><figcaption>Before · original shell</figcaption></figure><figure><img src="views/after-hall1-day.png" alt="Hall 1 with extracted stand rows, columns and ceiling fixtures"><figcaption>After · extracted fittings and adapted decks</figcaption></figure></div>
<h2>What the actual GLB contains</h2>
<p><code>bharat-mandapam-default.glb</code>: ${fmt(inv.bytes)} bytes; glTF 2.0, THREE.GLTFExporter r186. ${inv.counts.nodes} nodes, ${inv.counts.meshes} meshes, ${inv.counts.materials} materials, 18 embedded PNG textures, 11 point lights. There are 256,102 mesh triangles before GPU instancing; 118,362 belong to the Interior group.</p>
<div class="scroll"><table><thead><tr><th>Category</th><th>Evidence and reuse safety</th></tr></thead><tbody>
<tr><td>Floors and ceilings</td><td>ExpoFloor node 100 has six disconnected slabs; SteelDeck 105 has six ceiling slabs. FoyerFloor 88 and HallFloor 89 are separate foyer/plenary floors. Complete slabs are extractable. Runtime exhibition decks are rebuilt to the destination polygon using the source’s untextured materials.</td></tr>
<tr><td>Walls, columns and roof structure</td><td>HallWallInside 101: 18 lining pieces; RedJaipurSandstone 65: 18 base walls; ExhibitionPanels 66: 18 upper wall pieces. WhiteSandstone 60 includes 117 components, including columns. Aluminium 97 has 66 beams/hangers. Roof group 78 and nodes 79–85 contain complex convention-centre roof, glazing and ramp geometry. Whole roofs/walls were not transplanted into an incompatible shell.</td></tr>
<tr><td>Doors and windows</td><td>TintedGlass 58: 124 components; WhiteFins 59: 225; DoorGlass 63: 119 glazing/rail components; FireDoor 70 and DarkMetal 71: 45 each; Aluminium 68 includes 57 canopy/door-hardware pieces. Names/components do not prove 119 operable doors. One complete fire-door assembly is in the library; existing entrances and glazing are retained. No hinge animation or doorway navigation metadata is present.</td></tr>
<tr><td>Stalls and furniture</td><td>StandPanels 108: 1,774 components; CounterTop 109: 1,032; carpet/fascia nodes 110–125 form eight colour sets, with 996 floor pads total. LEDScreen 93: 997 components, spatially consistent with stand displays plus a stage panel. Walls can be fused across a whole 39 m row; individual bookable booths cannot all be recovered safely. A complete back-to-back row and a reception counter were extracted.</td></tr>
<tr><td>Plenary, fixtures and decoration</td><td>Stage 91, Gilt 92, AcousticWood lectern 94, Seats 95 (676 connected pieces, not a reliable chair count), Tiers 99 (334), stage-fixtures 96 (10), plenary-fixtures 98 (21), foyer-fixtures 90 (16). FireRed 102 and DarkMetal 103 provide 45 extinguisher bodies/tops; ExitSign 104 has 18 signs. HallLights nodes 106/126–130 provide 8 fixtures per hall except Hall 14 with 7. Site includes fountain/water, landscape and instanced tree geometry. Nataraja 264 is an empty node, not a sculpture mesh.</td></tr>
<tr><td>Materials and textures</td><td>95 material definitions, 29 with nonzero emission; 183 primitives have UV0. Eighteen PNGs provide stone, signs and water-related imagery; no normal maps or environment/HDR texture were found. Metallic/roughness, alpha, clearcoat, unlit, emission strength and texture transforms are recorded in the inventory. Original UVs, normals, material definitions and embedded image bytes are retained for extracted meshes. Furniture stays at authored scale; column height and beams are adapted, so source texel density is not guaranteed on scaled architecture.</td></tr>
<tr><td>Lights, cameras, animation and metadata</td><td>11 KHR_lights_punctual point lights; no spot/directional lights, cameras or animation clips. Fifty node extras carry fountain/ripple phase/big values, not a tour route. EXT_mesh_gpu_instancing is required and used by 24 tree nodes. Emission does not itself light neighbouring geometry; camera motion, controls, collision, cutaway rules, postprocessing and any moving fountain effects require viewer code.</td></tr>
</tbody></table></div>
<details open><summary>Hall identification and dimensions</summary>
<p>Source coordinates below are X/Z bounds from the six floor components. Pad counts are geometric observations, not editable stall identifiers. Destination dimensions are inset oriented roof bounding rectangles; polygon boundaries constrain placement.</p>
<div class="scroll"><table><thead><tr><th>Hall</th><th>Source X/Z bounds</th><th>Source floor</th><th>Carpet pads</th><th>Destination bounds</th></tr></thead><tbody>${hallRows}</tbody></table></div>
<p>The destination interior ceiling is 24 m in the model. <a href="adapted-halls.json">Measured centres, rotations and entrance centroids</a> and <a href="hall-inventory.json">contained/crossing components per source hall</a> are recorded separately. Foyer and plenary interiors are centred around the source origin; their seating/stage assets are retained in the reusable library rather than placed in exhibition halls.</p>
</details>
<details><summary>Reusable component inventory · 13 GLBs</summary>
<table><thead><tr><th>Component</th><th>Bytes</th><th>Triangles</th><th>Use</th></tr></thead><tbody>${assetRows}</tbody></table>
<p>The full kit is 1,647,936 bytes. Runtime loads only nine components, totalling 303,076 bytes. The manifest records original node and connected-component indices and extraction anchors for every mesh.</p>
<p>At least 89 source mesh nodes contain multiple disconnected pieces. Extraction selects whole connected components by spatial bounds and recentres their source transforms. Position welding at 0.0001-unit precision is used only to find connectivity; output vertices/UV seams remain intact. Triangles and raw attributes are copied, indices remapped, and original embedded images preserved. Fused stand walls are deliberately extracted as an entire row.</p>
</details>
<h2>Adapted and newly implemented</h2>
<p><strong>Layout:</strong> Existing hall roofs define each convex footprint and orientation. Source stand rows and counters retain their dimensions; placement rejects overlap and keeps a 3 m perimeter clearance and a clear central aisle. Floor and ceiling panels follow the inset polygon. Beams, columns and fixtures are repeated to fit. No source exterior shell replaces the current building.</p>
<p><strong>Walkthrough and tour:</strong> Choose a hall, then Enter hall or Guided tour. Use W/A/S/D, arrow keys, drag-to-look, wheel or touch buttons; Escape leaves. The camera is 1.7 m above the interior floor with a 0.08 m near plane. Collision boundaries cover added obstacles and the hall perimeter. Each guided route travels through the clear central aisle with pause/resume. It starts inside the hall; it does not simulate walking through an opening or animate existing doors. Roof and ceiling cutaways reveal the interior when zooming down from above.</p>
<p><strong>Night:</strong> One extracted warm point light per hall is supplemented by three runtime fill lights. Only the active/nearby hall’s four lights are enabled. Emissive fixtures brighten at night; exterior sun, ambient/environment intensity, exposure and background also change. Shared geometry/materials, a 303 KB runtime kit, no added shadow maps and disabled exterior ambient-occlusion processing during interior walking limit overhead. No portable FPS guarantee is claimed.</p>
<p><strong>Planner and export:</strong> Interior scenery is separate from editable stall/layout state. Existing editing and save contracts remain intact; extracted stands are decorative scene assets, not automatically converted into bookable stalls. Export hall GLB includes the selected original shell, fitted interior, materials/textures, four lights and layout metadata. Runtime controls, collision and guided-route behaviour remain JavaScript and are not baked into the GLB.</p>
<h2>Verification</h2>
<p>Production build and TypeScript check passed. Five focused integration checks passed: asset/buffer/UV/provenance integrity; all six destination footprints; browser walkthrough/tour/night/mobile/export; failed-asset recovery; planner edit/save/reload API contract. Five existing checks also passed for geometry batching, floor visibility, open-side editing, split/reload and save-rejection handling. Export was parsed to verify textures, geometry, four lights, obstacle separation and a clear central aisle. All six halls were captured and visually checked.</p>
<p class="note">The local backend was unavailable. Save and reload were verified with mocked API responses; a real database round trip remains unverified. The production build reports existing CSS budget and polygon-clipping CommonJS warnings. The original reference file and destination building GLB remain unchanged.</p>
<h2>Additional views</h2><div class="views">${gallery}<figure><img loading="lazy" src="views/after-hall14-night.png" alt="Hall 14 with night lighting"><figcaption>Hall 14 · night</figcaption></figure><figure><img loading="lazy" src="views/after-exterior-night.png" alt="Bharat Mandapam exterior at night"><figcaption>Existing exterior · night</figcaption></figure><figure><img loading="lazy" style="max-width:390px" src="views/after-mobile.png" alt="Mobile hall walkthrough controls"><figcaption>Mobile · 390 × 844</figcaption></figure></div>
<footer>Implementation: <code>codex/bharat-interiors</code>, based on the existing Bharat Mandapam viewer on <code>main</code>. The newer platform checkout is untouched. Reproduce extraction with <code>node scripts/extract-reference-interiors.mjs "C:/Users/Shivam Sharma/Downloads/bharat-mandapam-default.glb"</code>; run <code>npx playwright test e2e/venue-interiors.spec.ts</code>; regenerate this report with <code>node scripts/build-interior-report.mjs</code>.<br>Source SHA-256: <code>${inv.sha256}</code></footer>
</main></html>`);
console.log('Generated report.html and hall-inventory.json');
