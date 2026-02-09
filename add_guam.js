const fs = require('fs');
const data = JSON.parse(fs.readFileSync('us.json', 'utf8'));

// calculate quantized
const translate_lon = -179.231086;
const translate_lat = 17.831509999999994;
const scale_lon = 0.00035909113009113006;
const scale_lat = 0.00005360290060290062;

function quantize(lon, lat) {
    const x = (lon - translate_lon) / scale_lon;
    const y = (lat - translate_lat) / scale_lat;
    return [Math.round(x), Math.round(y)];
}

// Guam points (simple square)
const points = [
    [144.5, 13.2],
    [144.9, 13.2],
    [144.9, 13.6],
    [144.5, 13.6],
    [144.5, 13.2]
];

const quantized = points.map(p => quantize(p[0], p[1]));

// create arc as deltas, starting from 0,0 to first point
const arc = [];
arc.push([quantized[0][0], quantized[0][1]]); // absolute to first
for (let i = 1; i < quantized.length; i++) {
    arc.push([quantized[i][0] - quantized[i-1][0], quantized[i][1] - quantized[i-1][1]]);
}

// add to arcs
data.arcs.push(arc);

// add geometry
data.objects.districts.geometries.push({
    properties: { jdcode: 91 },
    arcs: [[data.arcs.length - 1]]
});

// write back
fs.writeFileSync('us.json', JSON.stringify(data));