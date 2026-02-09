const fs = require('fs');
const data = JSON.parse(fs.readFileSync('us.json'));
const arcs = data.arcs;
const geometries = data.objects.districts.geometries;
const newGeometries = [];
for (const geom of geometries) {
  let valid = true;
  if (geom.arcs) {
    for (const ring of geom.arcs) {
      for (const arcIndex of ring) {
        const idx = arcIndex < 0 ? -arcIndex : arcIndex;
        if (idx >= arcs.length || arcs[idx].length % 2 !== 0) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
  }
  if (valid) newGeometries.push(geom);
}
data.objects.districts.geometries = newGeometries;
fs.writeFileSync('us.json', JSON.stringify(data, null, 2));
console.log('Removed geometries with invalid arcs, remaining:', newGeometries.length);