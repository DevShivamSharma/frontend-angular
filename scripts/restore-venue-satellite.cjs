// Restore the original JPEGs and landmark fit without resampling. The current
// model retains the old layout's X/Z building centres (CC approximately -340,132;
// Hall 1 approximately 152,233). Its approximate OSM frame is NOT the photo fit.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const revision = '7a7c98c79a53099c704fe95da6f271097b4d4e66';
const directory = 'src/assets/venue/geography/satellite';
const original = JSON.parse(execFileSync('git', ['show', `${revision}:src/assets/satellite/satellite.json`]));
fs.mkdirSync(directory, { recursive: true });
for (const { image } of original.layers) {
  fs.writeFileSync(`${directory}/${image}`, execFileSync('git', ['show', `${revision}:src/assets/satellite/${image}`], { maxBuffer: 4 * 1024 * 1024 }));
}
fs.writeFileSync(`${directory}/satellite.json`, JSON.stringify({
  ...original,
  restoredFrom: revision,
  coordinateFrame: 'Authored venue X/Z metres; original four-landmark satellite fit retained.'
}, null, 2) + '\n');
console.log('Restored satellite JPEGs and original landmark registration.');
