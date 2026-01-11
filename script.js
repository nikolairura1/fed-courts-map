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
    const [usRes, judgesRes] = await Promise.all([fetch("us.json"), fetch("judges.json")]);
    const us = await usRes.json();
    judges = await judgesRes.json();

    msg.textContent = `✅ Loaded us.json + judges.json (updated: ${judges.last_updated_utc})`;

    districtsGeoJSON = topojson.feature(us, us.objects.districts);

    jdcodeToCircuit = {
      1:11,2:11,3:11,4:9,5:9,6:8,7:8,8:9,9:9,10:9,11:9,12:10,13:2,14:3,15:11,16:11,17:11,18:11,19:11,20:11,21:11,22:9,23:9,24:7,25:7,26:7,27:7,28:7,29:8,30:8,31:10,32:6,33:6,34:5,35:5,36:5,37:1,38:4,39:1,40:6,41:6,42:8,43:5,44:5,45:8,46:8,47:9,48:8,49:9,50:1,51:3,52:10,53:2,54:2,55:2,56:2,57:4,58:4,59:4,60:8,61:6,62:6,63:10,64:10,65:10,66:9,67:3,68:3,69:3,70:1,71:4,72:8,73:6,74:6,75:6,76:5,77:5,78:5,79:5,80:10,81:2,82:4,83:4,84:9,85:9,86:4,87:4,88:7,89:7,90:10
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
      11: "#20B2AA"
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
      "Clinton": "D",
      "Reagan": "R",
      "Carter": "D",
      "Ford": "R",
      "Nixon": "R",
      "Johnson": "D",
      "Kennedy": "D",
      "Eisenhower": "R",
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
          let popup = document.getElementById("judge-popup");
          if (!popup) {
            popup = document.createElement("div");
            popup.id = "judge-popup";
            popup.style.position = "fixed";
            popup.style.top = "10%";
            popup.style.left = "10%";
            popup.style.width = "80%";
            popup.style.height = "80%";
            popup.style.background = "white";
            popup.style.border = "1px solid black";
            popup.style.padding = "10px";
            popup.style.overflow = "auto";
            popup.style.zIndex = "1000";
            document.body.appendChild(popup);
          }
          // Get SCOTUS justices from judges.by_circuit.SCOTUS
          const entry = judges.by_circuit?.SCOTUS;
          const list = entry?.judges || [];
          let htmlList = "";
          if (list.length) {
            htmlList = '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr><th style="border: 1px solid #ccc; padding: 5px;">Portrait</th><th style="border: 1px solid #ccc; padding: 5px;">Name</th><th style="border: 1px solid #ccc; padding: 5px;">Education</th><th style="border: 1px solid #ccc; padding: 5px;">Party of Appointing President</th></tr>';
            list.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
              const edu = j.education || "Not available";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${edu}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
            });
            htmlList += "</table>";
          } else {
            htmlList = "<p>No justices found.</p>";
          }
          popup.innerHTML = `<h2>Supreme Court of the United States</h2>${htmlList}<button onclick=\"this.parentElement.style.display='none'\">Close</button>`;
          popup.style.display = "block";
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

          const entry = judges.by_circuit?.[circuit];
          const list = entry?.judges || [];

          let htmlList = "";
          if (list.length) {
            htmlList = '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr><th style="border: 1px solid #ccc; padding: 5px;">Portrait</th><th style="border: 1px solid #ccc; padding: 5px;">Name</th><th style="border: 1px solid #ccc; padding: 5px;">Education</th><th style="border: 1px solid #ccc; padding: 5px;">Party of Appointing President</th></tr>';

            list.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
              const edu = j.education || "Not available";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${edu}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
            });

            htmlList += "</table>";
          } else {
            htmlList = "<p>No judges found.</p>";
          }

          let popup = document.getElementById("judge-popup");
          if (!popup) {
            popup = document.createElement("div");
            popup.id = "judge-popup";
            popup.style.position = "fixed";
            popup.style.top = "10%";
            popup.style.left = "10%";
            popup.style.width = "80%";
            popup.style.height = "80%";
            popup.style.background = "white";
            popup.style.border = "1px solid black";
            popup.style.padding = "10px";
            popup.style.overflow = "auto";
            popup.style.zIndex = "1000";
            document.body.appendChild(popup);
          }
          popup.innerHTML = `<h2>Circuit ${circuit} (${districtLabel} example)</h2>${htmlList}<button onclick="this.parentElement.style.display='none'">Close</button>`;
          popup.style.display = "block";
        });
      }
    }).addTo(circuitMap);

    circuitMap.fitBounds(circuitLayer.getBounds());

    // District layer
    const districtLayer = L.geoJSON(districtsGeoJSON, {
      style: (feature) => {
        const colorIndex = feature.properties.jdcode % 11;
        return { fillColor: circuitColors[colorIndex] || "#cccccc", weight: 1, fillOpacity: 0.7 };
      },
      onEachFeature: (feature, l) => {
        l.on("click", () => {
          const props = feature.properties || {};
          const jdcode = props.jdcode;
          const districtLabel = props.name || props.jdcode || "District";

          const entry = judges.by_jdcode?.[jdcode];
          const list = entry?.judges || [];

          let htmlList = "";
          if (list.length) {
            htmlList = '<table style="border-collapse: collapse; width: 100%;">';
            htmlList +=
              '<tr><th style="border: 1px solid #ccc; padding: 5px;">Portrait</th><th style="border: 1px solid #ccc; padding: 5px;">Name</th><th style="border: 1px solid #ccc; padding: 5px;">Education</th><th style="border: 1px solid #ccc; padding: 5px;">Party of Appointing President</th></tr>';

            list.forEach((j) => {
              const safeTitle = cleanWikiTitle(j.wiki_title || j.name);
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(safeTitle.replace(/ /g, "_"))}`;
              const img = portraitHtml(j);
              const nameLink = '<a href="' + url + '" target="_blank">' + j.name.replace(/`/g, "&#96;") + "</a>";
              const app = j.appointed_by && j.appointed_by !== "—" ? ` (${j.appointed_by})` : "";
              const edu = j.education || "Not available";
              const party = presidentParty[j.appointed_by] || "";
              htmlList += `<tr><td style="border: 1px solid #ccc; padding: 5px;">${img}</td><td style="border: 1px solid #ccc; padding: 5px;">${nameLink}${app}</td><td style="border: 1px solid #ccc; padding: 5px;">${edu}</td><td style="border: 1px solid #ccc; padding: 5px;">${party}</td></tr>`;
            });

            htmlList += "</table>";
          } else {
            htmlList = "<p>No judges found.</p>";
          }

          let popup = document.getElementById("judge-popup");
          if (!popup) {
            popup = document.createElement("div");
            popup.id = "judge-popup";
            popup.style.position = "fixed";
            popup.style.top = "10%";
            popup.style.left = "10%";
            popup.style.width = "80%";
            popup.style.height = "80%";
            popup.style.background = "white";
            popup.style.border = "1px solid black";
            popup.style.padding = "10px";
            popup.style.overflow = "auto";
            popup.style.zIndex = "1000";
            document.body.appendChild(popup);
          }
          popup.innerHTML = `<h2>${districtLabel} [${jdcode}]</h2>${htmlList}<button onclick="this.parentElement.style.display='none'">Close</button>`;
          popup.style.display = "block";
        });
      }
    }).addTo(districtMap);

    districtMap.fitBounds(districtLayer.getBounds());
  }
});
