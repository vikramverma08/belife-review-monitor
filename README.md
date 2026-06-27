# Lab Review Monitor

Monitors Google reviews for each lab branch and shows them on a dashboard.
**No Google billing, no credit card** — review data comes from the
[Outscraper](https://outscraper.com) free tier, the dashboard is a single static
HTML file, and a free GitHub Actions cron keeps the data fresh.

> Why not Google's own Places API? It requires a billing account with a card.
> Outscraper returns the same Google review data on a free, no-card tier.
> Trade-off: the free tier is rate-limited, so we poll ~once a day, not real-time.

## How it works

```
labs.json ──► scripts/fetchReviews.js ──► public/data.json ──► public/index.html
            (Outscraper API)            (the only "database")    (the dashboard)
                     ▲
        GitHub Actions cron runs this daily (free) — or run it yourself
```

- **`outscraperClient.js`** — wrapper for the Outscraper reviews API (zero deps).
- **`scripts/fetchReviews.js`** — reads `labs.json`, fetches reviews, writes `public/data.json`.
- **`public/data.json`** — the data the dashboard reads (ships with sample data).
- **`public/index.html`** — the dashboard (ratings, reviews, low-star alerts).
- **`scripts/serve.js`** — tiny local server for previewing.
- **`.github/workflows/poll-reviews.yml`** — free daily automation.

## Quick start

### 1. Get a free Outscraper key (no card)
1. Sign up at **https://app.outscraper.com/profile** → copy your **API token**.

### 2. List your labs
Edit [labs.json](labs.json) — one entry per branch. Use the exact
`Name, Area, City` (or paste the Google Maps place URL) as `query`:
```json
{ "id": "belife-noida-62", "name": "Belife Diagnostics",
  "city": "Sector 62, Noida", "query": "Belife Diagnostics Sector 62 Noida" }
```

### 3. Get the review data into `public/data.json`

**Option A — Outscraper web UI (free, no card).** Outscraper's *API* needs paid
credits to activate, but the **web UI runs on free trial credits**:
1. In Outscraper → **Services → Google Maps Reviews** → enter your lab queries → **Get Data**.
2. When the task finishes (**Tasks** tab), **download the result as JSON**.
3. Convert it for the dashboard:
   ```bash
   node scripts/importExport.js path/to/outscraper-export.json
   ```
   This matches places back to `labs.json` and writes `public/data.json`.

**Option B — Outscraper API (needs credits/card).** If you add credits to your
Outscraper balance, the automated path works:
```powershell
$env:OUTSCRAPER_API_KEY="YOUR_TOKEN"; npm run fetch   # PowerShell
```
```bash
OUTSCRAPER_API_KEY="YOUR_TOKEN" npm run fetch          # bash
```

### 4. View the dashboard
```bash
npm run serve     # → http://localhost:3000  (set PORT=4321 if 3000 is busy)
```

## Automate for free (optional)

Push this repo to GitHub, then in **Settings → Secrets and variables → Actions**
add a secret `OUTSCRAPER_API_KEY`. The workflow in
[.github/workflows/poll-reviews.yml](.github/workflows/poll-reviews.yml) runs
daily, refreshes `data.json`, and commits it. Enable **GitHub Pages** (Settings →
Pages → deploy from `/public`) to host the dashboard free.

## Data shape (`public/data.json`)
```
generatedAt
branches[] → id, name, city, rating, reviewCount, lastSyncedAt, reviews[]
  reviews[] → reviewId, reviewerName, rating, text, publishTime, sentiment
alerts[]   → branchId, branchName, reviewId, rating, text, createdAt   (reviews ≤ 2★)
```
Alerts can be dismissed in the dashboard (remembered per-browser via localStorage).

---

## Optional: the Google Places / Firebase path (needs billing)

The files `firebase.json`, `.firebaserc`, `firestore.*`, and `functions/` are an
**alternative paid setup** using Google's Places API + Firebase Cloud Functions.
It gives near-real-time polling but **requires a Blaze (card) billing account**.
Not needed for the free path above — see [README-places.md](README-places.md) if
you ever want to upgrade.
