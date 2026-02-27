document.addEventListener("DOMContentLoaded", async () => {
  // const msg = document.createElement("div");
  // msg.style.padding = "10px";
  // msg.style.background = "#ffeecc";
  // msg.style.border = "1px solid #ccaa66";
  // msg.style.marginBottom = "10px";
  // msg.style.fontFamily = "monospace";
  // document.body.prepend(msg);

  if (typeof L === "undefined") {
    // msg.textContent = "❌ Leaflet did not load";
    return;
  }
  if (typeof topojson === "undefined") {
    // msg.textContent = "❌ topojson-client did not load";
    return;
  }

  // msg.textContent = "✅ Leaflet + topojson-client loaded";

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
    if (!title) {
      showPortraitPlaceholder(imgEl);
      return;
    }

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

    if (url) {
      imgEl.src = url;
    } else {
      showPortraitPlaceholder(imgEl);
    }
  } catch {
    showPortraitPlaceholder(imgEl);
  }
};

function showPortraitPlaceholder(imgEl) {
  const placeholder = document.createElement('div');
  placeholder.style.width = '40px';
  placeholder.style.height = '50px';
  placeholder.style.background = '#f5f5f5';
  placeholder.style.border = '1px solid #ddd';
  placeholder.style.borderRadius = '3px';
  placeholder.style.display = 'flex';
  placeholder.style.alignItems = 'center';
  placeholder.style.justifyContent = 'center';
  placeholder.style.fontSize = '8px';
  placeholder.style.color = '#999';
  placeholder.style.textAlign = 'center';
  placeholder.textContent = 'No Photo';
  imgEl.parentNode.replaceChild(placeholder, imgEl);
}


  function portraitHtml(j) {
    const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
    const initial = j.image_url ? fixCommonsThumbUrl(j.image_url, 250) : null;

    // If we don't even have an initial URL, show placeholder
    if (!initial) return '<div style="width:40px; height:50px; background:#f5f5f5; border:1px solid #ddd; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:8px; color:#999; text-align:center;">No Photo</div>';

    // Use onerror with mobile-friendly fallback
    const titleAttr = safeTitle.replace(/"/g, "&quot;");
    const srcAttr = String(initial).replace(/"/g, "&quot;");

    return `<img src="${srcAttr}" width="40" height="50" style="object-fit:cover; border-radius:3px; border:1px solid #ddd;" data-wikititle="${titleAttr}" onerror="window.handlePortraitError(this)" loading="lazy">`;
  }

  function presidentPortraitHtml(j) {
    let key = j.appointed_by;
    if (key === "Donald J. Trump" || key === "Donald Trump") {
      const year = j.assumed_office ? parseInt(j.assumed_office.split('-')[0]) : 0;
      if (year >= 2025) {
        key = "Donald J. Trump 2";
      }
    } else if (key === "George W. Bush") {
      const year = j.assumed_office ? parseInt(j.assumed_office.split('-')[0]) : 0;
      if (year >= 2005) {
        key = "George W. Bush 2";
      }
    } else if (key === "Barack Obama") {
      const year = j.assumed_office ? parseInt(j.assumed_office.split('-')[0]) : 0;
      if (year >= 2017) {  // Hypothetical second term
        key = "Barack Obama 2";
      }
    }
    const url = presidentPortraits[key];
    if (url) {
      return `<img src="${url}" alt="${j.appointed_by}" style="width:25px; height:32px; vertical-align:middle; margin-right:3px; border-radius:2px;" loading="lazy" onerror="this.style.display='none'">`;
    }
    return '';
  }

  function partyPortraitHtml(party) {
    const url = partyPortraits[party];
    if (url) {
      return `<img src="${url}" alt="${party}" style="width:16px; height:16px; vertical-align:middle; margin-left:3px;" loading="lazy" onerror="this.style.display='none'">`;
    }
    return '';
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
          aVal = (a.appointed_by || '').toLowerCase();
          bVal = (b.appointed_by || '').toLowerCase();
          break;
        case 'education':
          aVal = (a.education || '').toLowerCase();
          bVal = (b.education || '').toLowerCase();
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


  const districtMap = L.map("districtMap", { worldCopyJump: false, minZoom: 2, maxZoom: 10, maxBounds: [[-90, -180], [90, 180]] }).setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(districtMap);

  const circuitMap = L.map("circuitMap", { worldCopyJump: false, minZoom: 2, maxZoom: 10, maxBounds: [[-90, -180], [90, 180]] }).setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(circuitMap);

  // SCOTUS map
  const scotusMap = L.map("scotusMap", { worldCopyJump: false, minZoom: 2, maxZoom: 10, maxBounds: [[-90, -180], [90, 180]] }).setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(scotusMap);

  var districtsGeoJSON, judges, jdcodeToCircuit, circuitColors, presidentParty, presidentPortraits, partyPortraits, schoolToJudges, schoolsList;

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
    const [usRes, judgesRes] = await Promise.all([fetch("us.json?" + Date.now()), fetch("judgesFJC2.json?" + Date.now())]);
    const us = await usRes.json();
    judges = await judgesRes.json();

    console.log('by_circuit keys:', Object.keys(judges.by_circuit || {}));

    // msg.textContent = `✅ Loaded us.json + judgesFJC2.json (updated: ${judges.last_updated_utc})`;

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

    // Add territories to circuits
    jdcodeToCircuit[91] = 9; // Guam to 9th Circuit
    jdcodeToCircuit[92] = 9; // Northern Mariana Islands to 9th Circuit
    jdcodeToCircuit[93] = 1; // Puerto Rico to 1st Circuit
    jdcodeToCircuit[94] = 3; // US Virgin Islands to 3rd Circuit

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
      "Joseph R. Biden": "Democrat",
      "Trump": "Republican",
      "Donald Trump": "Republican",
      "Donald J. Trump": "Republican",
      "Obama": "Democrat",
      "Barack Obama": "Democrat",
      "Bush": "Republican",
      "George W. Bush": "Republican",
      "Clinton": "Democrat",
      "Bill Clinton": "Democrat",
      "William J. Clinton": "Democrat",
      "Bush Sr.": "Republican",
      "George H.W. Bush": "Republican",
      "Bush, Sr.": "Republican",
      "H.W. Bush": "Republican",
      "George H.W. Bush": "Republican",
      "Reagan": "Republican",
      "Ronald Reagan": "Republican",
      "Reagan": "Republican",
      "Jimmy Carter": "Democrat",
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

    presidentPortraits = {
      "Joseph R. Biden": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Joe_Biden_presidential_portrait.jpg/128px-Joe_Biden_presidential_portrait.jpg",
      "Joe Biden": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Joe_Biden_presidential_portrait.jpg/128px-Joe_Biden_presidential_portrait.jpg",
      "Donald J. Trump": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Donald_Trump_official_portrait.jpg/128px-Donald_Trump_official_portrait.jpg",
      "Donald Trump": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Donald_Trump_official_portrait.jpg/128px-Donald_Trump_official_portrait.jpg",
      "Donald J. Trump 2": "https://upload.wikimedia.org/wikipedia/commons/4/47/Official_Presidential_Portrait_of_President_Donald_J._Trump_%282025%29_%283x4_close_cropped%29.jpg",
      "Barack Obama": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Obama_portrait_crop.jpg/960px-Obama_portrait_crop.jpg",
      "George W. Bush": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/GeorgeWBush_%281%29.jpg/960px-GeorgeWBush_%281%29.jpg",
      "George W. Bush 2": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/George-W-Bush.jpeg/128px-George-W-Bush.jpeg",  // Same for now, or find different
      "Barack Obama 2": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/128px-President_Barack_Obama.jpg",  // Same
      "William J. Clinton": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Bill_Clinton.jpg/128px-Bill_Clinton.jpg",
      "Bill Clinton": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Bill_Clinton.jpg/128px-Bill_Clinton.jpg",
      "George H.W. Bush": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/George_H._W._Bush%2C_President_of_the_United_States%2C_1989_official_portrait.jpg/128px-George_H._W._Bush%2C_President_of_the_United_States%2C_1989_official_portrait.jpg",
      "George H. W. Bush": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/George_H._W._Bush%2C_President_of_the_United_States%2C_1989_official_portrait.jpg/128px-George_H._W._Bush%2C_President_of_the_United_States%2C_1989_official_portrait.jpg",
      "Ronald Reagan": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Official_Portrait_of_President_Reagan_1981.jpg/128px-Official_Portrait_of_President_Reagan_1981.jpg",
      "Jimmy Carter": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/JimmyCarterPortrait2.jpg/128px-JimmyCarterPortrait2.jpg",
      "Gerald Ford": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Gerald_Ford_presidential_portrait.jpg/128px-Gerald_Ford_presidential_portrait.jpg",
      "Richard Nixon": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Richard_Nixon_presidential_portrait.jpg/128px-Richard_Nixon_presidential_portrait.jpg",
      "Lyndon B. Johnson": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/37_Lyndon_Johnson.jpg/128px-37_Lyndon_Johnson.jpg",
      "John F. Kennedy": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/John_F._Kennedy%2C_White_House_color_photo_portrait.jpg/128px-John_F._Kennedy%2C_White_House_color_photo_portrait.jpg",
      "Dwight D. Eisenhower": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Dwight_D._Eisenhower%2C_official_photo_portrait%2C_May_29%2C_1959.jpg/128px-Dwight_D._Eisenhower%2C_official_photo_portrait%2C_May_29%2C_1959.jpg",
      "Harry S. Truman": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Harry_S._Truman%2C_c._1947_%28cropped%29.jpg/128px-Harry_S._Truman%2C_c._1947_%28cropped%29.jpg",
      "Franklin D. Roosevelt": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/FDR_1944_Color_Portrait.jpg/128px-FDR_1944_Color_Portrait.jpg",
      "Herbert Hoover": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/President_Hoover_portrait.jpg/128px-President_Hoover_portrait.jpg",
      "Calvin Coolidge": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Calvin_Coolidge_cph.3g10777.jpg/128px-Calvin_Coolidge_cph.3g10777.jpg",
      "Warren G. Harding": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Warren_G._Harding.jpg/128px-Warren_G._Harding.jpg",
      "Woodrow Wilson": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Woodrow_Wilson_portrait.jpg/128px-Woodrow_Wilson_portrait.jpg",
      "William Howard Taft": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/William_Howard_Taft_portrait.jpg/128px-William_Howard_Taft_portrait.jpg",
      "Theodore Roosevelt": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Theodore_Roosevelt_by_John_Singer_Sargent%2C_1903.jpg/128px-Theodore_Roosevelt_by_John_Singer_Sargent%2C_1903.jpg",
      "William McKinley": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/President_William_McKinley_portrait.jpg/128px-President_William_McKinley_portrait.jpg",
      "Grover Cleveland": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Grover_Cleveland_-_NARA_-_518139.jpg/128px-Grover_Cleveland_-_NARA_-_518139.jpg",
      "Benjamin Harrison": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Benjamin_Harrison%2C_head_and_shoulders_bw_photo%2C_1896.jpg/128px-Benjamin_Harrison%2C_head_and_shoulders_bw_photo%2C_1896.jpg",
      "Chester A. Arthur": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Chester_A._Arthur.jpg/128px-Chester_A._Arthur.jpg",
      "James A. Garfield": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/James_A._Garfield%2C_photo_portrait_seated.jpg/128px-James_A._Garfield%2C_photo_portrait_seated.jpg",
      "Rutherford B. Hayes": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Rutherford_Hayes.jpg/128px-Rutherford_Hayes.jpg",
      "Ulysses S. Grant": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Ulysses_S._Grant_by_Brady%2C_1870-1880.jpg/128px-Ulysses_S._Grant_by_Brady%2C_1870-1880.jpg",
      "Abraham Lincoln": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Abraham_Lincoln_O-77_matte_collodion_print.jpg/128px-Abraham_Lincoln_O-77_matte_collodion_print.jpg",
      "James Buchanan": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/James_Buchanan.jpg/128px-James_Buchanan.jpg",
      "Franklin Pierce": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Mathew_Brady_-_Franklin_Pierce_-_alternate_crop.jpg/128px-Mathew_Brady_-_Franklin_Pierce_-_alternate_crop.jpg",
      "Millard Fillmore": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Millard_Fillmore.jpg/128px-Millard_Fillmore.jpg",
      "Zachary Taylor": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Zachary_Taylor_restored_and_cropped.jpg/128px-Zachary_Taylor_restored_and_cropped.jpg",
      "James K. Polk": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/JKP.jpg/128px-JKP.jpg",
      "John Tyler": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/John_Tyler.jpg/128px-John_Tyler.jpg",
      "Martin Van Buren": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Martin_Van_Buren.jpg/128px-Martin_Van_Buren.jpg",
      "William Henry Harrison": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/William_Henry_Harrison_by_James_Reid_Lambdin%2C_1835.jpg/128px-William_Henry_Harrison_by_James_Reid_Lambdin%2C_1835.jpg",
      "John Quincy Adams": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/John_Quincy_Adams.jpg/128px-John_Quincy_Adams.jpg",
      "James Monroe": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/James_Monroe_White_House_portrait.jpg/128px-James_Monroe_White_House_portrait.jpg",
      "James Madison": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/James_Madison.jpg/128px-James_Madison.jpg",
      "Thomas Jefferson": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/T_Jefferson_by_Charles_Willson_Peale_1791_2.jpg/128px-T_Jefferson_by_Charles_Willson_Peale_1791_2.jpg",
      "George Washington": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg/128px-Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg"
    };

    partyPortraits = {
      "Democrat": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/DemocraticLogo.svg/50px-DemocraticLogo.svg.png",
      "Republican": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Republicanlogo.svg/50px-Republicanlogo.svg.png",
      "D": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/DemocraticLogo.svg/50px-DemocraticLogo.svg.png",
      "R": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Republicanlogo.svg/50px-Republicanlogo.svg.png"
    };

    schoolToJudges = new Map();
    schoolsList = [];

    function buildSchoolIndex() {
      function processJudges(judgesArray, courtName) {
        judgesArray.forEach(j => {
          if (j.education_items) {
            j.education_items.forEach(item => {
              if (item.school) {
                if (!schoolToJudges.has(item.school)) {
                  schoolToJudges.set(item.school, []);
                }
                schoolToJudges.get(item.school).push({ ...j, court: courtName });
              }
            });
          }
        });
      }

      // Process all judges
      for (const key in judges) {
        if (key !== 'last_updated_utc' && judges[key].judges) {
          processJudges(judges[key].judges, judges[key].district_name || key);
        }
      }
      if (judges.by_jdcode) {
        for (const jd in judges.by_jdcode) {
          const entry = judges.by_jdcode[jd];
          if (entry.judges) {
            processJudges(entry.judges, entry.district_name || `District ${jd}`);
          }
        }
      }
      if (judges.by_circuit) {
        for (const circ in judges.by_circuit) {
          if (circ !== 'SCOTUS') {
            const entry = judges.by_circuit[circ];
            if (entry.judges) {
              processJudges(entry.judges, entry.district_name || `Circuit ${circ}`);
            }
          }
        }
      }
      schoolsList = Array.from(schoolToJudges.keys()).sort();
    }

    buildSchoolIndex();

    // School search
    const schoolInput = document.getElementById('schoolInput');
    const suggestions = document.getElementById('suggestions');
    const searchBtn = document.getElementById('searchBtn');
    const clearBtn = document.getElementById('clearBtn');
    const schoolResults = document.getElementById('schoolResults');
    const schoolTitle = document.getElementById('schoolTitle');
    const schoolTableBody = document.getElementById('schoolTableBody');

    schoolInput.addEventListener('input', () => {
      const query = schoolInput.value.toLowerCase();
      if (query.length < 2) {
        suggestions.style.display = 'none';
        return;
      }
      const matches = schoolsList.filter(s => s.toLowerCase().includes(query)).slice(0, 10);
      if (matches.length) {
        suggestions.innerHTML = matches.map(s => `<div style="padding: 5px; cursor: pointer;" onclick="selectSchool('${s.replace(/'/g, "\\'").replace(/"/g, '\\"')}')">${s}</div>`).join('');
        suggestions.style.display = 'block';
      } else {
        suggestions.style.display = 'none';
      }
    });

    window.selectSchool = function(school) {
      schoolInput.value = school;
      suggestions.style.display = 'none';
    };

    clearBtn.addEventListener('click', () => {
      schoolInput.value = '';
      suggestions.style.display = 'none';
      schoolResults.style.display = 'none';
    });

    searchBtn.addEventListener('click', () => {
      const school = schoolInput.value.trim();
      if (!school) return;
      const judgesList = schoolToJudges.get(school);
      if (!judgesList) {
        alert('No judges found for that school.');
        return;
      }
      schoolTitle.textContent = `Judges affiliated with ${school}`;
      schoolTableBody.innerHTML = judgesList.map(j => {
        const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
        const img = portraitHtml(j);
        const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
        const party = presidentParty[j.appointed_by] || "";
        const education = j.education_items ? j.education_items.map(item => `${item.school.replace(/`/g, '\\`')} (${item.degree})`).join(', ') : j.education || '';
        const safeEducation = education.replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/`/g, '\\`');
        return `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img.replace(/`/g, '\\`')}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;">${j.court.replace(/`/g, '\\`')}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${(j.appointed_by || '').replace(/`/g, '\\`')} (${party.replace(/`/g, '\\`')})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j).replace(/`/g, '\\`')}<span style="margin-left: 5px;">${partyPortraitHtml(party).replace(/`/g, '\\`')}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${safeEducation}</td></tr>`;
      }).join('');
      schoolResults.style.display = 'block';
    })

  }catch (e) {
    console.error(e);
    // msg.textContent = "❌ Failed to load us.json or judgesFJC2.json";
    alert("Could not load us.json or judgesFJC2.json. Make sure you are running via http://localhost:3000 (npx serve .).");
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
          const sortedList = list.sort((a, b) => a.name.localeCompare(b.name));
          let htmlList = "";
          if (sortedList.length) {
            htmlList = '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Appointed By', 'party') + createSortableHeader('Education', 'education') + '</tr>';
            sortedList.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${j.appointed_by || ''} (${party})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j)}<span style="margin-left: 5px;">${partyPortraitHtml(party)}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${j.education || ''}</td></tr>`;
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
            const sortedDcList = dcList.sort((a, b) => a.name.localeCompare(b.name));
            if (sortedDcList.length) {
              htmlList += '<table style="border-collapse: collapse; width: 100%;">';
              htmlList +=
                '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Appointed By', 'party') + createSortableHeader('Education', 'education') + '</tr>';
              sortedDcList.forEach((j) => {
                const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
                const img = portraitHtml(j);
                const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
                const party = presidentParty[j.appointed_by] || "";
                htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${j.appointed_by || ''} (${party})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j)}<span style="margin-left: 5px;">${partyPortraitHtml(party)}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${j.education || ''}</td></tr>`;
              });
              htmlList += "</table>";
            } else {
              htmlList += "<p>No judges found.</p>";
            }

            htmlList += "<h3>Federal Circuit</h3>";
            const sortedFedList = fedList.sort((a, b) => a.name.localeCompare(b.name));
            if (sortedFedList.length) {
              htmlList += '<table style="border-collapse: collapse; width: 100%;">';
              htmlList +=
                '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Appointed By', 'party') + createSortableHeader('Education', 'education') + '</tr>';
              sortedFedList.forEach((j) => {
                const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
                const img = portraitHtml(j);
                const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
                const party = presidentParty[j.appointed_by] || "";
                htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${j.appointed_by || ''} (${party})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j)}<span style="margin-left: 5px;">${partyPortraitHtml(party)}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${j.education || ''}</td></tr>`;
              });
              htmlList += "</table>";
            } else {
              htmlList += "<p>No judges found.</p>";
            }
          } else {
            const entry = judges.by_circuit?.[circuit];
            const list = entry?.judges || [];
            const sortedList = list.sort((a, b) => a.name.localeCompare(b.name));

            if (sortedList.length) {
              htmlList = '<table style="border-collapse: collapse; width: 100%;">';
              htmlList +=
                '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Appointed By', 'party') + createSortableHeader('Education', 'education') + '</tr>';

              sortedList.forEach((j) => {
                const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
                const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
                const img = portraitHtml(j);
                const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
                const party = presidentParty[j.appointed_by] || "";
                htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${j.appointed_by || ''} (${party})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j)}<span style="margin-left: 5px;">${partyPortraitHtml(party)}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${j.education || ''}</td></tr>`;
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
          const list = (entry?.judges || []).concat(entry?.senior_judges || []);
          const activeList = list.filter(j => !j.status || j.status.toLowerCase() === 'active');
          const seniorList = list.filter(j => j.status?.toLowerCase() === 'senior');
          const sortedActiveList = activeList.sort((a, b) => a.name.localeCompare(b.name));
          const sortedSeniorList = seniorList.sort((a, b) => a.name.localeCompare(b.name));

          let htmlList = "";
          if (sortedActiveList.length) {
            htmlList += '<h4>Active Judges</h4>';
            htmlList += '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Appointed By', 'party') + createSortableHeader('Education', 'education') + '</tr>';

            sortedActiveList.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${j.appointed_by || ''} (${party})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j)}<span style="margin-left: 5px;">${partyPortraitHtml(party)}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${j.education || ''}</td></tr>`;
            });

            htmlList += "</table>";
          }

          if (sortedSeniorList.length) {
            htmlList += '<h4>Senior Judges</h4>';
            htmlList += '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr>' + createSortableHeader('Portrait', '') + createSortableHeader('Name', 'name') + createSortableHeader('Appointed By', 'party') + createSortableHeader('Education', 'education') + '</tr>';

            sortedSeniorList.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}</td><td style="border: 1px solid #ccc; padding: 5px;"><div>${j.appointed_by || ''} (${party})</div><div style="display: flex; align-items: center; justify-content: center; margin-top: 5px;">${presidentPortraitHtml(j)}<span style="margin-left: 5px;">${partyPortraitHtml(party)}</span></div></td><td style="border: 1px solid #ccc; padding: 5px;">${j.education || ''}</td></tr>`;
            });

            htmlList += "</table>";
          } else {
            htmlList += '<h4>Senior Judges</h4><p>No senior judges.</p>';
          }

          if (!sortedActiveList.length && !sortedSeniorList.length) {
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
