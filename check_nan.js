const fs = require('fs');
const topojson = require('topojson-client');
const data = JSON.parse(fs.readFileSync('us.json'));
try {
  const geojson = topojson.feature(data, data.objects.districts);
  console.log('GeoJSON features:', geojson.features.length);
  let hasNaN = false;
  function checkCoords(coords) {
    if (Array.isArray(coords)) {
      coords.forEach(c => {
        if (Array.isArray(c)) {
          checkCoords(c);
        } else if (isNaN(c)) {
          hasNaN = true;
        }
      });
    }
  }
  geojson.features.forEach(f => {
    if (f.geometry && f.geometry.coordinates) {
      checkCoords(f.geometry.coordinates);
    }
  });
  console.log('Has NaN:', hasNaN);
  if (hasNaN) {
    geojson.features.forEach((f, i) => {
      if (f.geometry && f.geometry.coordinates) {
        let has = false;
        function check(coords) {
          if (Array.isArray(coords)) {
            coords.forEach(c => {
              if (Array.isArray(c)) check(c);
              else if (isNaN(c)) has = true;
            });
          }
        }
        check(f.geometry.coordinates);
        if (has) console.log('Feature', i, 'has NaN', f.properties);
      }
    });
  }
} catch (e) {
  console.error('Error:', e.message);
}