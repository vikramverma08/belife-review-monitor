// scripts/fetchReviews.js
// Reads labs.json, pulls reviews for each lab from Outscraper, and writes
// public/data.json — the single file the dashboard reads. No database needed.
//
// Run it:
//   OUTSCRAPER_API_KEY=xxxx node scripts/fetchReviews.js     (bash)
//   $env:OUTSCRAPER_API_KEY="xxxx"; node scripts/fetchReviews.js   (PowerShell)
//
// In GitHub Actions the key comes from a repo secret (see the workflow file).

const fs = require("fs");
const path = require("path");
const { getReviews } = require("../outscraperClient");

const ROOT = path.join(__dirname, "..");
const LABS_FILE = path.join(ROOT, "labs.json");
const OUT_FILE = path.join(ROOT, "public", "data.json");

const REVIEWS_PER_LAB = 10; // keep small to conserve free credits
const ALERT_AT_OR_BELOW = 2; // a review at/under this many stars raises an alert

async function main() {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    console.error("Missing OUTSCRAPER_API_KEY. Set it as an env var and re-run.");
    process.exit(1);
  }

  const { labs } = JSON.parse(fs.readFileSync(LABS_FILE, "utf8"));
  if (!Array.isArray(labs) || !labs.length) {
    console.error("labs.json has no labs. Add at least one.");
    process.exit(1);
  }

  const branches = [];
  const alerts = [];

  for (const lab of labs) {
    process.stdout.write(`Fetching "${lab.name || lab.query}"… `);
    try {
      const data = await getReviews(apiKey, lab.query, { reviewsLimit: REVIEWS_PER_LAB });
      if (!data.found) {
        console.log("not found");
        branches.push({ ...baseBranch(lab), error: "not found" });
        continue;
      }

      branches.push({
        ...baseBranch(lab),
        name: lab.name || data.name,
        rating: data.rating,
        reviewCount: data.totalReviewCount,
        reviews: data.reviews,
        lastSyncedAt: new Date().toISOString(),
      });

      // Any low-star review in this batch becomes an alert.
      for (const r of data.reviews) {
        if (r.rating != null && r.rating <= ALERT_AT_OR_BELOW) {
          alerts.push({
            branchId: lab.id,
            branchName: lab.name || data.name,
            reviewId: r.reviewId,
            rating: r.rating,
            text: r.text,
            reviewerName: r.reviewerName,
            createdAt: r.publishTime || new Date().toISOString(),
          });
        }
      }
      console.log(`ok (${data.rating ?? "—"}★, ${data.reviews.length} reviews)`);
    } catch (e) {
      console.log(`error: ${e.message}`);
      branches.push({ ...baseBranch(lab), error: e.message });
    }
  }

  // Newest alerts first.
  alerts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const out = { generatedAt: new Date().toISOString(), branches, alerts };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT_FILE} — ${branches.length} branches, ${alerts.length} alerts.`);
}

function baseBranch(lab) {
  return {
    id: lab.id,
    name: lab.name || "",
    city: lab.city || "",
    rating: null,
    reviewCount: 0,
    reviews: [],
    lastSyncedAt: null,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
