// scripts/importExport.js
// Converts an Outscraper "Google Maps Reviews" export (downloaded from the web
// UI using free credits — no card) into public/data.json for the dashboard.
//
// Use this when the Outscraper API is gated behind paid credits but the UI
// still works on the free tier.
//
//   node scripts/importExport.js path/to/outscraper-export.json
//
// Accepts the common export shapes:
//   - [ {name, rating, reviews, reviews_data:[...]}, ... ]
//   - { data: [ [place], [place] ] }   (API-style)
//   - { data: [ place, place ] }

const fs = require("fs");
const path = require("path");
const { normalizePlace } = require("../outscraperClient");

const ROOT = path.join(__dirname, "..");
const LABS_FILE = path.join(ROOT, "labs.json");
const OUT_FILE = path.join(ROOT, "public", "data.json");
const ALERT_AT_OR_BELOW = 2;

function slug(s) {
  return String(s || "place").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Flatten whatever Outscraper gave us into a flat array of place objects.
function extractPlaces(raw) {
  let arr = Array.isArray(raw) ? raw : raw.data || [];
  // Unwrap one level of nesting if present (API returns array-of-arrays).
  if (arr.length && Array.isArray(arr[0])) arr = arr.flat();
  return arr.filter((p) => p && typeof p === "object");
}

// Try to match a scraped place back to a lab in labs.json (for id + city).
function matchLab(labs, place) {
  const name = (place.name || "").toLowerCase();
  const pid = place.place_id || "";
  return labs.find(
    (l) =>
      (l.placeId && l.placeId === pid) ||
      (l.query && name && name.includes(String(l.name || "").toLowerCase())) ||
      (l.name && name && name.includes(l.name.toLowerCase()))
  );
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/importExport.js <outscraper-export.json>");
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const places = extractPlaces(raw);
  if (!places.length) {
    console.error("No places found in that export. Is it the Reviews export JSON?");
    process.exit(1);
  }

  const labs = (() => {
    try { return JSON.parse(fs.readFileSync(LABS_FILE, "utf8")).labs || []; }
    catch { return []; }
  })();

  const branches = [];
  const alerts = [];

  for (const raw of places) {
    const p = normalizePlace(raw);
    const lab = matchLab(labs, raw);
    const id = lab?.id || slug(p.name);
    const name = lab?.name || p.name || id;
    const city = lab?.city || raw.full_address || raw.city || "";

    branches.push({
      id, name, city,
      rating: p.rating,
      reviewCount: p.totalReviewCount,
      reviews: p.reviews,
      lastSyncedAt: new Date().toISOString(),
    });

    for (const r of p.reviews) {
      if (r.rating != null && r.rating <= ALERT_AT_OR_BELOW) {
        alerts.push({
          branchId: id, branchName: name, reviewId: r.reviewId,
          rating: r.rating, text: r.text, reviewerName: r.reviewerName,
          createdAt: r.publishTime || new Date().toISOString(),
        });
      }
    }
    console.log(`✓ ${name} — ${p.rating ?? "—"}★, ${p.reviews.length} reviews`);
  }

  alerts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const out = { generatedAt: new Date().toISOString(), branches, alerts };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE} — ${branches.length} branches, ${alerts.length} alerts.`);
}

main();
