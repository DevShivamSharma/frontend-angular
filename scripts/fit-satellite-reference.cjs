/* Register the z18 satellite image to the venue's X/Z metres. No test runner is involved. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'work/venue-surroundings/satellite-reference.json');
const reference = JSON.parse(fs.readFileSync(file, 'utf8'));

// A north-up Web Mercator tile mosaic needs no shear: least-squares similarity
// world = s*R*pixel + t, solved in complex form as w = a*p + b on the fit anchors.
const used = reference.anchors.filter(a => reference.fitAnchors.includes(a.id));
const mean = list => list.reduce((s, p) => [s[0]+p[0]/list.length, s[1]+p[1]/list.length], [0, 0]);
const pm = mean(used.map(a => a.pixel)), wm = mean(used.map(a => a.world));
let re = 0, im = 0, norm = 0;
for (const a of used) {
  const p = [a.pixel[0]-pm[0], a.pixel[1]-pm[1]], w = [a.world[0]-wm[0], a.world[1]-wm[1]];
  re += w[0]*p[0]+w[1]*p[1]; im += w[1]*p[0]-w[0]*p[1]; norm += p[0]**2+p[1]**2;
}
const c = re/norm, s = im/norm;
const x = [c, -s, wm[0]-c*pm[0]+s*pm[1]], z = [s, c, wm[1]-s*pm[0]-c*pm[1]];
const world = p => [x[0]*p[0]+x[1]*p[1]+x[2], z[0]*p[0]+z[1]*p[1]+z[2]];
const residualsMetres = Object.fromEntries(reference.anchors.map(a => [a.id, +Math.hypot(...world(a.pixel).map((v, i) => v-a.world[i])).toFixed(3)]));
reference.fit = {x: x.map(v => +v.toFixed(8)), z: z.map(v => +v.toFixed(8)), worldMetresPerPixel: +Math.hypot(c, s).toFixed(6), rotationDegrees: +(Math.atan2(s, c)*180/Math.PI).toFixed(4), residualsMetres};
fs.writeFileSync(file, JSON.stringify(reference, null, 2) + '\n');
console.log(JSON.stringify({fitAnchors: reference.fitAnchors, ...reference.fit}));
