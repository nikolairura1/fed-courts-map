document.addEventListener("DOMContentLoaded", async () => {
  const msg = document.createElement("div");
  msg.style.padding = "10px";
  msg.style.background = "#ffeecc";
  msg.style.border = "1px solid #ccaa66";
  msg.style.marginBottom = "10px";
  msg.style.fontFamily = "monospace";
  document.body.prepend(msg);

  if (typeof L === "undefined") {
    msg.textContent = "❌ Leaflet did not load";
    return;
  }
  if (typeof topojson === "undefined") {
    msg.textContent = "❌ topojson-client did not load";
    return;
  }

  msg.textContent = "✅ Leaflet + topojson-client loaded";

  function hasNaN(obj) {
    if (typeof obj !== 'object' || obj === null) return false;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (typeof value === 'number' && isNaN(value)) return true;
        if (typeof value === 'object' && hasNaN(value)) return true;
      }
    }
    return false;
  }

// -------------------- MOBILE-SAFE POPUP (drop-in) --------------------
function ensureJudgePopup() {
  let popup = document.getElementById("judge-popup");
  let backdrop = document.getElementById("judge-popup-backdrop");

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "judge-popup-backdrop";
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.35)",
      zIndex: "9998",
      display: "none",
      touchAction: "none"
    });
    backdrop.addEventListener("click", () => hideJudgePopup());
    document.body.appendChild(backdrop);
  }

  if (!popup) {
    popup = document.createElement("div");
    popup.id = "judge-popup";
    Object.assign(popup.style, {
      position: "fixed",
      top: "8vh",
      left: "5vw",
      width: "90vw",
      height: "84vh",
      background: "white",
      border: "1px solid #111",
      borderRadius: "10px",
      padding: "12px",
      overflow: "auto",
      zIndex: "9999",
      display: "none",
      WebkitOverflowScrolling: "touch", // smooth iOS scroll
      touchAction: "pan-y"              // allow scrolling inside popup
    });

    // Close button (not inline onclick)
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Close";
    closeBtn.id = "judge-popup-close";
    Object.assign(closeBtn.style, {
      position: "sticky",
      top: "0",
      float: "right",
      padding: "8px 12px",
      margin: "0 0 10px 10px",
      border: "1px solid #999",
      borderRadius: "8px",
      background: "#f5f5f5",
      cursor: "pointer",
      zIndex: "10000"
    });
    closeBtn.addEventListener("click", () => hideJudgePopup());

    // Content container
    const content = document.createElement("div");
    content.id = "judge-popup-content";

    popup.appendChild(closeBtn);
    popup.appendChild(content);
    document.body.appendChild(popup);
  }

  // ESC to close (desktop)
  if (!window.__judgePopupEscHooked) {
    window.__judgePopupEscHooked = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideJudgePopup();
    });
  }

  return { popup, backdrop };
}

function showJudgePopup(html) {
  const { popup, backdrop } = ensureJudgePopup();
  const content = document.getElementById("judge-popup-content");
  content.innerHTML = html;

  backdrop.style.display = "block";
  popup.style.display = "block";

  // Prevent map from eating taps while popup is open
  document.body.style.overflow = "hidden";

  // Update table headers with sort indicators
  updateTableHeaders();
}

function hideJudgePopup() {
  const popup = document.getElementById("judge-popup");
  const backdrop = document.getElementById("judge-popup-backdrop");
  if (popup) popup.style.display = "none";
  if (backdrop) backdrop.style.display = "none";
  document.body.style.overflow = "";
}
// --------------------------------------------------------------------


  // --------------------------------------------------------------------------
  // Portrait helpers
  // --------------------------------------------------------------------------
// --------------------------------------------------------------------------
function cleanWikiTitle(t) {
  let s = String(t || "")
    .trim()
    .replace(/ /g, "_")
    .replace(/_+$/g, ""); // remove trailing underscores

  // Preserve dots that are part of canonical Wikipedia suffixes
  // (these often appear in real page titles, e.g., "..._Jr.")
  const endsWithDotSuffix = /(?:_Jr\.|_Sr\.|_St\.)$/i.test(s);

  // Otherwise strip trailing periods (from bad data like "Foo." or "Bar..")
  if (!endsWithDotSuffix) {
    s = s.replace(/\.+$/, "");
  }

  // Apply your alias map (if you defined it above)
  if (typeof WIKI_TITLE_ALIASES !== "undefined" && WIKI_TITLE_ALIASES[s]) {
    s = WIKI_TITLE_ALIASES[s];
  }

  return s;
}

  // Fix malformed thumb URLs that end at the filename:
  // .../commons/thumb/a/ab/Foo.jpg  ->  .../commons/thumb/a/ab/Foo.jpg/250px-Foo.jpg
  function fixCommonsThumbUrl(url, width = 250) {
    if (!url || typeof url !== "string") return url;

    // Already a correctly formed thumbnail URL
    if (url.includes("/thumb/") && /\/\d+px-/.test(url)) return url;

    const m = url.match(
      /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/([^\/]+\.(?:jpg|jpeg|png|webp|gif|svg))$/i
    );
    if (!m) return url;

    const filename = m[1];
    return `${url}/${width}px-${filename}`;
  }

  // Cache page->thumbnail lookups so you don't spam Wikipedia
  const _wikiPortraitCache = new Map();

  // Called by <img onerror="window.handlePortraitError(this)">
window.handlePortraitError = async function (imgEl) {
  try {
    if (!imgEl) return;
    if (imgEl.dataset.portraitTried === "1") return;
    imgEl.dataset.portraitTried = "1";

    const raw = imgEl.dataset.wikititle;
    const title = cleanWikiTitle(raw);
    if (!title) return;

    async function fetchThumb(t) {
      if (_wikiPortraitCache.has(t)) return _wikiPortraitCache.get(t);

      const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
      const res = await fetch(endpoint, { headers: { accept: "application/json" } });
      if (!res.ok) {
        _wikiPortraitCache.set(t, null);
        return null;
      }
      const data = await res.json();
      const url = data?.thumbnail?.source || data?.originalimage?.source || null;
      _wikiPortraitCache.set(t, url);
      return url;
    }

    // Attempt 1: cleaned title
    let url = await fetchThumb(title);

    // Attempt 2 (fallback): remove common suffix punctuation edge case like "Jr."
    // If you had "Stanley_Blumenfeld_Jr." somewhere, attempt "Stanley_Blumenfeld_Jr"
    if (!url && /_Jr_?$/.test(title)) {
      url = await fetchThumb(title.replace(/_Jr_?$/, "_Jr"));
    }

    if (url) imgEl.src = url;
  } catch {
    // keep stable
  }
};


  function portraitHtml(j) {
    const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
    const initial = j.image_url ? fixCommonsThumbUrl(j.image_url, 250) : null;

    // If we don't even have an initial URL, we *could* fetch Wikipedia directly,
    // but keeping it simple: show "No image".
    if (!initial) return "No image";

    // Use an onerror fallback to Wikipedia page thumbnail.
    const titleAttr = safeTitle.replace(/"/g, "&quot;");
    const srcAttr = String(initial).replace(/"/g, "&quot;");

    return `<img src="${srcAttr}" width="50" style="vertical-align:middle;" data-wikititle="${titleAttr}" onerror="window.handlePortraitError(this)">`;
  }

  // --------------------------------------------------------------------------
  // Table sorting functionality
  // --------------------------------------------------------------------------

  let currentSortColumn = null;
  let currentSortDirection = 'asc';

  function sortJudges(judges, column) {
    if (!column) return judges;

    return [...judges].sort((a, b) => {
      let aVal, bVal;

      switch (column) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'party':
          aVal = presidentParty[a.appointed_by] || '';
          bVal = presidentParty[b.appointed_by] || '';
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return currentSortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return currentSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function createSortableHeader(text, column) {
    return `<th style="border: 1px solid #ccc; padding: 5px; cursor: pointer; user-select: none;" onclick="sortTable('${column}')">${text}</th>`;
  }

  window.sortTable = function(column) {
    if (currentSortColumn === column) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortColumn = column;
      currentSortDirection = 'asc';
    }

    // Update the table headers to show the sort arrows
    updateTableHeaders();

    // Sort the table rows in place
    const table = document.querySelector('#judge-popup-content table');
    if (table) {
      const tbody = table.querySelector('tbody') || table;
      const rows = Array.from(tbody.querySelectorAll('tr')).slice(1); // Skip header row

      rows.sort((a, b) => {
        let aVal, bVal;

        if (column === 'name') {
          // Extract name from the second cell (index 1)
          aVal = a.cells[1].textContent.toLowerCase();
          bVal = b.cells[1].textContent.toLowerCase();
        } else if (column === 'party') {
          // Extract party from the third cell (index 2)
          aVal = a.cells[2].textContent.toLowerCase();
          bVal = b.cells[2].textContent.toLowerCase();
        } else {
          return 0;
        }

        if (aVal < bVal) return currentSortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentSortDirection === 'asc' ? 1 : -1;
        return 0;
      });

      // Re-append the sorted rows
      rows.forEach(row => tbody.appendChild(row));
    }
  };

  function updateTableHeaders() {
    const headers = document.querySelectorAll('#judge-popup-content th');
    headers.forEach((header, index) => {
      const text = header.textContent.replace(/[↑↓]/g, '').trim();
      let arrow = '';
      if ((index === 1 && currentSortColumn === 'name') ||
          (index === 2 && currentSortColumn === 'party')) {
        arrow = currentSortDirection === 'asc' ? ' ↑' : ' ↓';
      }
      header.innerHTML = text + arrow;
    });
  }

  // --------------------------------------------------------------------------
  // Create maps
  // --------------------------------------------------------------------------


  const districtMap = L.map("districtMap").setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(districtMap);

  const circuitMap = L.map("circuitMap").setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(circuitMap);

  // SCOTUS map
  const scotusMap = L.map("scotusMap").setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(scotusMap);

  let districtsGeoJSON, judges, jdcodeToCircuit, circuitColors, presidentParty;

  // Tab switching

  document.getElementById("districtTab").addEventListener("click", () => {
    document.getElementById("districtMap").style.display = "block";
    document.getElementById("circuitMap").style.display = "none";
    document.getElementById("scotusMap").style.display = "none";
    districtMap.invalidateSize();
  });

  document.getElementById("circuitTab").addEventListener("click", () => {
    document.getElementById("districtMap").style.display = "none";
    document.getElementById("circuitMap").style.display = "block";
    document.getElementById("scotusMap").style.display = "none";
    circuitMap.invalidateSize();
  });

  document.getElementById("scotusTab").addEventListener("click", () => {
    document.getElementById("districtMap").style.display = "none";
    document.getElementById("circuitMap").style.display = "none";
    document.getElementById("scotusMap").style.display = "block";
    scotusMap.invalidateSize();
  });

  try {
    const [usRes, judgesRes] = await Promise.all([fetch("us.json?" + Date.now()), fetch("judges.json?" + Date.now())]);
    const us = await usRes.json();
    judges = await judgesRes.json();

    console.log('by_circuit keys:', Object.keys(judges.by_circuit || {}));

    msg.textContent = `✅ Loaded us.json + judges.json (updated: ${judges.last_updated_utc})`;

    try { districtsGeoJSON = topojson.feature(us, us.objects.districts); } catch (e) { console.error("TopoJSON error:", e); districtsGeoJSON = {type: "FeatureCollection", features: []}; }
    if (districtsGeoJSON && districtsGeoJSON.features) {
      districtsGeoJSON.features = districtsGeoJSON.features.filter(feature => !hasNaN(feature));
    }
    districtsGeoJSON.features.push({
  "type": "Feature",
  "properties": { "jdcode": 91, "state": "GU", "name": "Guam" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[
      144.619, 13.182],
      [144.65, 13.2],
      [144.8, 13.25],
      [144.956, 13.3],
      [144.956, 13.444],
      [144.9, 13.5],
      [144.8, 13.6],
      [144.7, 13.706],
      [144.619, 13.706],
      [144.619, 13.182]
    ]]
  }
});
    districtsGeoJSON.features.push({
  "type": "Feature",
  "properties": { "jdcode": 92, "state": "MP", "name": "Northern Mariana Islands" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[
      145.0, 14.0],
      [145.2, 14.2],
      [145.6, 15.0],
      [145.8, 15.3],
      [145.8, 20.5],
      [145.6, 20.0],
      [145.0, 14.0]
    ]]
  }
});
    districtsGeoJSON.features.push({
  "type": "Feature",
  "properties": { "jdcode": 93, "state": "PR", "name": "Puerto Rico" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[
      -67.3, 17.9],
      [-65.2, 17.9],
      [-65.2, 18.5],
      [-67.3, 18.5],
      [-67.3, 17.9]
    ]]
  }
});
    districtsGeoJSON.features.push({
  "type": "Feature",
  "properties": { "jdcode": 94, "state": "VI", "name": "Virgin Islands" },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[
      -65.0, 17.6],
      [-64.5, 17.6],
      [-64.5, 18.4],
      [-65.0, 18.4],
      [-65.0, 17.6]
    ]]
  }
});
    jdcodeToCircuit = {
      0:12,1:11,2:11,3:11,4:9,5:9,6:8,7:8,8:9,9:9,10:9,11:9,12:10,13:2,14:3,15:11,16:11,17:11,18:11,19:11,20:11,21:11,22:9,23:9,24:7,25:7,26:7,27:7,28:7,29:8,30:8,31:10,32:6,33:6,34:5,35:5,36:5,37:1,38:4,39:1,40:6,41:6,42:8,43:5,44:5,45:8,46:8,47:9,48:8,49:9,50:1,51:3,52:10,53:2,54:2,55:2,56:2,57:4,58:4,59:4,60:8,61:6,62:6,63:10,64:10,65:10,66:9,67:3,68:3,69:3,70:1,71:4,72:8,73:6,74:6,75:6,76:5,77:5,78:5,79:5,80:10,81:2,82:4,83:4,84:9,85:9,86:4,87:4,88:7,89:7,90:10
    };

    circuitColors = {
      1: "#8B4513",
      2: "#556B2F",
      3: "#708090",
      4: "#4682B4",
      5: "#D2691E",
      6: "#8B008B",
      7: "#2F4F4F",
      8: "#CD5C5C",
      9: "#9ACD32",
      10: "#F0E68C",
      11: "#20B2AA",
      12: "#FF6347"
    };

    presidentParty = {
      "Biden": "Democrat",
      "Joe Biden": "Democrat",
      "Trump": "Republican",
      "Donald Trump": "Republican",
      "Obama": "Democrat",
      "Barack Obama": "Democrat",
      "Bush": "Republican",
      "George W. Bush": "Republican",
      "Clinton": "Democrat",
      "Bill Clinton": "Democrat",
      "Bush Sr.": "Republican",
      "George H. W. Bush": "Republican",
      "Bush, Sr.": "Republican",
      "H.W. Bush": "Republican",
      "Reagan": "Republican",
      "Ronald Reagan": "Republican",
      "Reagan": "Republican",
      "Carter": "Democrat",
      "Ford": "Republican",
      "Nixon": "Republican",
      "Johnson": "Democrat",
      "Kennedy": "Democrat",
      "Eisenhower": "Republican",
      "Truman": "D",
      "Roosevelt": "D",
      "Hoover": "R",
      "Coolidge": "R",
      "Harding": "R",
      "Wilson": "D",
      "Taft": "R",
      "Theodore Roosevelt": "R",
      "McKinley": "R",
      "Cleveland": "D",
      "Harrison": "R",
      "Arthur": "R",
      "Garfield": "R",
      "Hayes": "R",
      "Grant": "R",
      "Lincoln": "R",
      "Buchanan": "D",
      "Pierce": "D",
      "Fillmore": "W",
      "Taylor": "W",
      "Polk": "D",
      "Tyler": "W",
      "Van Buren": "D",
      "Jackson": "D",
      "Adams": "N-R",
      "Monroe": "D-R",
      "Madison": "D-R",
      "Jefferson": "D-R",
      "Washington": "I"
    };
  } catch (e) {
    console.error(e);
    msg.textContent = "❌ Failed to load us.json or judges.json";
    alert("Could not load us.json or judges.json. Make sure you are running via http://localhost:3000 (npx serve .).");
    return;
  }

  // --------------------------------------------------------------------------
  // Add layers after data is loaded
  // --------------------------------------------------------------------------
  if (districtsGeoJSON && judges && jdcodeToCircuit && circuitColors) {
    // SCOTUS layer: color all districts blue
    const scotusLayer = L.geoJSON(districtsGeoJSON, {
      style: () => ({ fillColor: "#1e90ff", weight: 1, fillOpacity: 0.7 }),
      onEachFeature: (feature, l) => {
        l.on("click", () => {
          // Get SCOTUS justices from judges.by_circuit.SCOTUS
          const entry = judges.by_circuit?.SCOTUS;
          const list = entry?.judges || [];
          const sortedList = sortJudges(list, currentSortColumn);
          let htmlList = "";
          if (sortedList.length) {
            htmlList = '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Party of Appointing President', 'party') + '</tr>';
            sortedList.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
            });
            htmlList += "</table>";
          } else {
            htmlList = "<p>No justices found.</p>";
          }
          showJudgePopup(`<h2>Supreme Court of the United States</h2>${htmlList}`);
        });
      }
    }).addTo(scotusMap);
    scotusMap.fitBounds(scotusLayer.getBounds());

    // Circuit layer
    const circuitLayer = L.geoJSON(districtsGeoJSON, {
      style: (feature) => {
        const circuit = jdcodeToCircuit[feature.properties.jdcode];
        return { fillColor: circuitColors[circuit] || "#cccccc", weight: 1, fillOpacity: 0.7 };
      },
      onEachFeature: (feature, l) => {
        l.on("click", () => {
          const props = feature.properties || {};
          const jdcode = props.jdcode;
          const circuit = jdcodeToCircuit[jdcode];
          const districtLabel = props.name || props.jdcode || "District";

          console.log('Clicked jdcode:', jdcode, 'circuit:', circuit);

          const entry = judges.by_circuit?.[circuit];
          console.log('entry:', entry);
          const list = entry?.judges || [];

          console.log('Circuit:', circuit, 'List length:', list.length);

          let htmlList = "";
          if (circuit == 12) {
            // Show both DC and Federal circuits
            const dcEntry = judges.by_circuit?.["12"];
            const dcList = dcEntry?.judges || [];
            const fedEntry = judges.by_circuit?.["13"];
            const fedList = fedEntry?.judges || [];

            htmlList += "<h3>District of Columbia Circuit</h3>";
            const sortedDcList = sortJudges(dcList, currentSortColumn);
            if (sortedDcList.length) {
              htmlList += '<table style="border-collapse: collapse; width: 100%;">';
              htmlList +=
                '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Party of Appointing President', 'party') + '</tr>';
              sortedDcList.forEach((j) => {
                const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
                const img = portraitHtml(j);
                const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
                const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
                const party = presidentParty[j.appointed_by] || "";
                htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
              });
              htmlList += "</table>";
            } else {
              htmlList += "<p>No judges found.</p>";
            }

            htmlList += "<h3>Federal Circuit</h3>";
            const sortedFedList = sortJudges(fedList, currentSortColumn);
            if (sortedFedList.length) {
              htmlList += '<table style="border-collapse: collapse; width: 100%;">';
              htmlList +=
                '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Party of Appointing President', 'party') + '</tr>';
              sortedFedList.forEach((j) => {
                const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
                const img = portraitHtml(j);
                const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
                const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
                const party = presidentParty[j.appointed_by] || "";
                htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
              });
              htmlList += "</table>";
            } else {
              htmlList += "<p>No judges found.</p>";
            }
          } else {
            const entry = judges.by_circuit?.[circuit];
            const list = entry?.judges || [];
            const sortedList = sortJudges(list, currentSortColumn);

            if (sortedList.length) {
              htmlList = '<table style="border-collapse: collapse; width: 100%;">';
              htmlList +=
                '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Party of Appointing President', 'party') + '</tr>';

              sortedList.forEach((j) => {
                const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
                const img = portraitHtml(j);
                const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
                const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
                const party = presidentParty[j.appointed_by] || "";
                htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
              });

              htmlList += "</table>";
            } else {
              htmlList = "<p>No judges found.</p>";
            }
          }

          showJudgePopup(`<h2>Circuit ${circuit} (${districtLabel} example)</h2>${htmlList}`);
        });
      }
    }).addTo(circuitMap);

    circuitMap.fitBounds(circuitLayer.getBounds());

    // District layer
    const districtLayer = L.geoJSON(districtsGeoJSON, {
      style: (feature) => {
        const jdcode = feature.properties.jdcode;
        if (jdcode === 91) return { fillColor: "#ff4500", weight: 1, fillOpacity: 0.7 }; // Guam: orange red
        if (jdcode === 92) return { fillColor: "#daa520", weight: 1, fillOpacity: 0.7 }; // NMI: goldenrod
        if (jdcode === 93) return { fillColor: "#800080", weight: 1, fillOpacity: 0.7 }; // PR: purple
        if (jdcode === 94) return { fillColor: "#00ff00", weight: 1, fillOpacity: 0.7 }; // VI: lime green
        const colorIndex = jdcode % 11;
        return { fillColor: circuitColors[colorIndex] || "#cccccc", weight: 1, fillOpacity: 0.7 };
      },
      onEachFeature: (feature, l) => {
        l.on("click", () => {
          const props = feature.properties || {};
          const jdcode = props.jdcode;
          const districtLabel = props.name || props.jdcode || "District";

          const entry = judges.by_jdcode?.[jdcode];
          const list = entry?.judges || [];
          const sortedList = sortJudges(list, currentSortColumn);

          let htmlList = "";
          if (sortedList.length) {
            htmlList = '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Party of Appointing President', 'party') + '</tr>';

            sortedList.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
            });

            htmlList += "</table>";
          } else {
            htmlList = "<p>No judges found.</p>";
          }

          const districtWikiUrl = entry?.wikipedia_title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(cleanWikiTitle(entry.wikipedia_title).replace(/ /g, "_"))}` : null;
          const districtTitle = districtWikiUrl ? `<a href="${districtWikiUrl}" target="_blank">${districtLabel}</a>` : districtLabel;

          showJudgePopup(`<h2>${districtTitle} [${jdcode}]</h2>${htmlList}`);
        });
      }
    }).addTo(districtMap);

    districtMap.fitBounds(districtLayer.getBounds());
  }
});
