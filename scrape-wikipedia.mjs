import fs from "fs";
import { JSDOM } from "jsdom";
import * as topojson from "topojson-client";

const WIKI_BASE = "https://en.wikipedia.org/api/rest_v1/page/html/";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// TopoJSON names are usually like "Northern District of Texas".
// We turn that into the Wikipedia page title:
// "United States District Court for the Northern District of Texas"
function makeDistrictCourtTitle(districtName) {
  const n = (districtName || "").trim();
const exceptions = {
  // Special districts / territories
  "District of Columbia": "United States District Court for the District of Columbia",
  "Puerto Rico": "United States District Court for the District of Puerto Rico",
  "Guam": "District Court of Guam",
  "Northern Mariana Islands": "District Court for the Northern Mariana Islands",
  "Virgin Islands": "District Court of the Virgin Islands",

  // Common Wikipedia title variations (these fix many 404s)
  "District of the Northern Mariana Islands": "District Court for the Northern Mariana Islands",
  "District of the Virgin Islands": "District Court of the Virgin Islands",

  // If your topo dataset uses short names for territories
  "N. Mariana Islands": "District Court for the Northern Mariana Islands",
  "U.S. Virgin Islands": "District Court of the Virgin Islands",
};

  if (exceptions[n]) return exceptions[n];

  // Parse district names
  const directions = ['Northern', 'Southern', 'Eastern', 'Western', 'Middle', 'Central'];
  const parts = n.split(' ');
  const lastWord = parts[parts.length - 1];
  if (directions.includes(lastWord)) {
    const direction = lastWord;
    const state = parts.slice(0, -1).join(' ');
    return `United States District Court for the ${direction} District of ${state}`;
  } else {
    // Single district
    return `United States District Court for the District of ${n}`;
  }
}
function text(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

// Try to find judge tables on the page and extract judge rows.
function extractJudgesFromWikipediaHtml(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Wikipedia usually uses class "wikitable" for these judge tables
  const tables = [...doc.querySelectorAll("table.wikitable")];

  const judges = [];

  // Heuristic: look for tables whose caption or nearby heading mentions "Judges"
  for (const table of tables) {
    const caption = text(table.querySelector("caption"));
    const headerRow = table.querySelector("tr");
    const headers = headerRow ? [...headerRow.querySelectorAll("th")].map(text) : [];

    const looksLikeJudgesTable =
      caption.toLowerCase().includes("judge") ||
      headers.some((h) => /judge/i.test(h)) ||
      headers.some((h) => /appointed by/i.test(h));

    if (!looksLikeJudgesTable) continue;

    // Determine if this is a "senior judges" table by caption or headers
    const isSeniorTable = /senior/i.test(caption);

    // Find column indexes
    const judgeCol = headers.findIndex((h) => /^judge$/i.test(h) || /judge/i.test(h));
    const appointedByCol = headers.findIndex((h) => /appointed by/i.test(h));
    const assumedOfficeCol = headers.findIndex((h) => /assumed office|began active service/i.test(h));
    const termCol = headers.findIndex((h) => /term/i.test(h));

    // Skip if we can't even find a judge column
    if (judgeCol === -1) continue;

    // Skip senior judges tables
    if (isSeniorTable) continue;

    const rows = [...table.querySelectorAll("tr")].slice(1);

    for (const row of rows) {
      const cells = [...row.querySelectorAll("td")];
      if (cells.length === 0) continue;

      const judgeName = text(cells[judgeCol]);
      if (!judgeName) continue;

      // Filter out obvious non-Article III noise (rare, but helps)
      if (/Magistrate|Bankruptcy/i.test(judgeName)) continue;

      const appointedBy = appointedByCol >= 0 ? text(cells[appointedByCol]) : "";
      const assumedOffice = assumedOfficeCol >= 0 ? text(cells[assumedOfficeCol]) : "";
      const term = termCol >= 0 ? text(cells[termCol]) : "";

      // Only include current judges: those with appointed_by containing "present" or "—"
      if (!/present/i.test(appointedBy) && appointedBy !== "—") continue;

      judges.push({
        name: judgeName,
        status: "Active",
        appointed_by: appointedBy,
        assumed_office: assumedOffice,
      });
    }
  }

  // Deduplicate by name + status
  const seen = new Set();
  const deduped = [];
  for (const j of judges) {
    const key = `${j.name}||${j.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(j);
  }

  return deduped;
}

async function fetchWikipediaHtml(title) {
  const url = WIKI_BASE + encodeURIComponent(title);
  const res = await fetch(url, {
    headers: { "User-Agent": "federal-judges-map (learning project)" },
  });
  if (!res.ok) {
    throw new Error(`Wikipedia fetch failed (${res.status}) for: ${title}`);
  }
  return await res.text();
}

async function getJudgeInfo(name) {
  const title = name + ' (judge)';
  let wikiTitle = title;
  let image_url = null;
  let education = null;
  let isDeceased = false;
  let isSenior = false;
  let judge = {};

  // Fetch HTML for more details
  let html = '';
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": "federal-judges-map (learning project)" },
    });
    if (res.ok) {
      html = await res.text();
    } else {
      // fallback to name
      wikiTitle = name;
      const res2 = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(name)}`, {
        headers: { "User-Agent": "federal-judges-map (learning project)" },
      });
      if (res2.ok) {
        html = await res2.text();
      }
    }
  } catch {}

  if (html) {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Check lead paragraph for senior or inactive
    const lead = doc.querySelector('.mw-parser-output p');
    if (lead) {
      const leadText = lead.textContent.toLowerCase();
      if (leadText.includes('senior') || leadText.includes('inactive')) {
        isSenior = true;
      }
    }

    // Check if disambiguation
    if (doc.querySelector('.mw-disambig')) {
      // fallback to name without (judge)
      wikiTitle = name;
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(name)}`, {
          headers: { "User-Agent": "federal-judges-map (learning project)" },
        });
        if (res.ok) {
          html = await res.text();
          const dom2 = new JSDOM(html);
          const doc2 = dom2.window.document;
          if (!doc2.querySelector('.mw-disambig')) {
            dom = dom2;
          } else {
            return null; // disambiguation, skip
          }
        }
      } catch {
        return null;
      }
    }

    // Extract image if not from summary
    if (!image_url) {
      const infobox = doc.querySelector('.infobox');
      if (infobox) {
        const img = infobox.querySelector('img');
        if (img) {
          image_url = img.src;
          if (image_url.startsWith('//')) image_url = 'https:' + image_url;
          else if (image_url.startsWith('/')) image_url = 'https://en.wikipedia.org' + image_url;
        }
      }
    }

    // Extract education
    const infobox = doc.querySelector('.infobox');
    if (infobox) {
      const rows = infobox.querySelectorAll('tr');
      for (const row of rows) {
        const th = row.querySelector('th');
        if (th) {
          const thText = th.textContent.toLowerCase();
          if (thText.includes('education') || thText.includes('alma')) {
            const td = row.querySelector('td');
            if (td) {
              education = td.textContent.trim().replace(/\n/g, ' ').replace(/\)([A-Z])/g, ') $1');
              break;
            }
          }
          if (thText.includes('appointed by') || thText.includes('nominated by')) {
            const td = row.querySelector('td');
            if (td) {
              judge.appointed_by = td.textContent.trim();
            }
          }
          // Check for deceased
          if (thText.includes('died') || thText.includes('death')) {
            isDeceased = true;
          }
          // Check for senior status
          if (thText.includes('status')) {
            const td = row.querySelector('td');
            if (td && td.textContent.toLowerCase().includes('senior')) {
              isSenior = true;
            }
          }
        }
      }
    }
  }

  if (isDeceased || isSenior) {
    if (isSenior) console.log(`${name} filtered as senior`);
    return null;
  }

  return { image_url, education, appointed_by: judge.appointed_by, wikiTitle };
}

async function main() {
  // Read your existing TopoJSON
  const topo = JSON.parse(fs.readFileSync("us.json", "utf8"));

  // Extract districts as GeoJSON so we can iterate properties
  const districts = topojson.feature(topo, topo.objects.districts);

  const output = {
    last_updated_utc: new Date().toISOString(),
    by_jdcode: {}, // jdcode -> { district_name, wikipedia_title, judges: [...] }
    by_circuit: {} // circuit -> { wikipedia_title, judges: [...] }
  };

  // Go through each district feature
  for (const f of districts.features) {
    const props = f.properties || {};
    const jdcode = props.jdcode;
    const districtName = props.name || props.NAMELSAD || props.NAME;

    if (!jdcode || !districtName) continue;

    const title = makeDistrictCourtTitle(districtName);

    try {
      const html = await fetchWikipediaHtml(title);
      const judges = extractJudgesFromWikipediaHtml(html);

      // Get images and education for each judge
      for (const j of judges) {
        const info = await getJudgeInfo(j.name);
        if (info) {
          j.image_url = info.image_url;
          j.education = info.education;
          j.appointed_by = info.appointed_by;
          j.wiki_title = info.wikiTitle;
        } else {
          // Skip deceased or invalid
          judges.splice(judges.indexOf(j), 1);
        }
        await sleep(200); // delay to be nice
      }

      output.by_jdcode[jdcode] = {
        district_name: districtName,
        wikipedia_title: title,
        judges,
      };

      console.log(`✅ ${jdcode} — ${districtName} — judges: ${judges.length}`);
    } catch (e) {
      console.log(`❌ ${jdcode} — ${districtName} — ${e.message}`);
      output.by_jdcode[jdcode] = {
        district_name: districtName,
        wikipedia_title: title,
        judges: [],
        error: e.message,
      };
    }

    // Be nice to Wikipedia: small delay between requests
    await sleep(1000);
  }

  // Scrape circuits
  const circuitTitles = {
    1: "United States Court of Appeals for the First Circuit",
    2: "United States Court of Appeals for the Second Circuit",
    3: "United States Court of Appeals for the Third Circuit",
    4: "United States Court of Appeals for the Fourth Circuit",
    5: "United States Court of Appeals for the Fifth Circuit",
    6: "United States Court of Appeals for the Sixth Circuit",
    7: "United States Court of Appeals for the Seventh Circuit",
    8: "United States Court of Appeals for the Eighth Circuit",
    9: "United States Court of Appeals for the Ninth Circuit",
    10: "United States Court of Appeals for the Tenth Circuit",
    11: "United States Court of Appeals for the Eleventh Circuit",
    12: "United States Court of Appeals for the District of Columbia Circuit",
    13: "United States Court of Appeals for the Federal Circuit"
  };

  for (const [circuit, title] of Object.entries(circuitTitles)) {
    try {
      const html = await fetchWikipediaHtml(title);
      const judges = extractJudgesFromWikipediaHtml(html);

      // Get images and education for each judge
      for (const j of judges) {
        const info = await getJudgeInfo(j.name);
        if (info) {
          j.image_url = info.image_url;
          j.education = info.education;
          j.appointed_by = info.appointed_by;
          j.wiki_title = info.wikiTitle;
        } else {
          judges.splice(judges.indexOf(j), 1);
        }
        await sleep(200); // delay to be nice
      }

      output.by_circuit[circuit] = {
        wikipedia_title: title,
        judges,
      };

      console.log(`✅ Circuit ${circuit} — judges: ${judges.length}`);
    } catch (e) {
      console.log(`❌ Circuit ${circuit} — ${e.message}`);
      output.by_circuit[circuit] = {
        wikipedia_title: title,
        judges: [],
        error: e.message,
      };
    }

    await sleep(1000);
  }

  fs.writeFileSync("scraped_judges.json", JSON.stringify(output, null, 2));
  console.log("\nWrote scraped_judges.json ✅");

  // Merge with existing judges.json, prioritizing existing data
  let existing = {};
  if (fs.existsSync("judges.json")) {
    try {
      existing = JSON.parse(fs.readFileSync("judges.json", "utf8"));
    } catch (e) {
      console.log("Warning: judges.json is invalid, using scraped data");
    }
  }

  const merged = { ...output };
  merged.last_updated_utc = output.last_updated_utc;

  // For districts
  for (const jdcode in output.by_jdcode) {
    merged.by_jdcode[jdcode] = output.by_jdcode[jdcode];
  }

  // For circuits
  for (const circuit in output.by_circuit) {
    merged.by_circuit[circuit] = output.by_circuit[circuit];
  }

  fs.writeFileSync("judges.json", JSON.stringify(merged, null, 2));
  console.log("Merged and wrote judges.json ✅");

  // Highlight additions
  const additions = { districts: {}, circuits: {} };
  for (const jdcode in merged.by_jdcode) {
    const mergedJudges = merged.by_jdcode[jdcode].judges || [];
    const existingJudges = existing.by_jdcode?.[jdcode]?.judges || [];
    const existingNames = new Set(existingJudges.map(j => j.name));
    const newOnes = mergedJudges.filter(j => !existingNames.has(j.name));
    if (newOnes.length) additions.districts[jdcode] = newOnes.map(j => j.name);
  }
  for (const circuit in merged.by_circuit) {
    const mergedJudges = merged.by_circuit[circuit].judges || [];
    const existingJudges = existing.by_circuit?.[circuit]?.judges || [];
    const existingNames = new Set(existingJudges.map(j => j.name));
    const newOnes = mergedJudges.filter(j => !existingNames.has(j.name));
    if (newOnes.length) additions.circuits[circuit] = newOnes.map(j => j.name);
  }

  if (Object.keys(additions.districts).length || Object.keys(additions.circuits).length) {
    console.log("\n🔍 New additions detected:");
    for (const jdcode in additions.districts) {
      console.log(`District ${jdcode}: ${additions.districts[jdcode].join(', ')}`);
    }
    for (const circuit in additions.circuits) {
      console.log(`Circuit ${circuit}: ${additions.circuits[circuit].join(', ')}`);
    }
  } else {
    console.log("\n✅ No new additions.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
