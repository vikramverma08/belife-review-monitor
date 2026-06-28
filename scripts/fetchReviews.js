const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...headers }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

const sentiment = r => r >= 4 ? 'positive' : r <= 2 ? 'negative' : 'neutral';

// New Places API (v1) — Text Search to find Place ID
// Uses lab.query from labs.json for precise matching (avoids wrong labs with same name)
async function findPlaceId(searchQuery) {
  const res = await httpsPost(
    'https://places.googleapis.com/v1/places:searchText',
    { 'X-Goog-Api-Key': PLACES_API_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName' },
    { textQuery: searchQuery, maxResultCount: 1 }
  );
  if (res.places?.length) {
    console.log(`  Found: ${res.places[0].displayName?.text}`);
    return res.places[0].id;
  }
  return null;
}

// New Places API (v1) — Place Details to get reviews + rating
async function fetchReviewsForPlace(placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const res = await httpsGet(url, {
    'X-Goog-Api-Key': PLACES_API_KEY,
    'X-Goog-FieldMask': 'reviews,rating,userRatingCount'
  });

  const reviews = [];
  for (const r of (res.reviews || [])) {
    const rating = r.rating || 0;
    reviews.push({
      reviewId: r.name || `${placeId}-${r.publishTime}`,
      reviewerName: r.authorAttribution?.displayName || 'Anonymous',
      rating,
      text: r.text?.text || r.originalText?.text || '',
      publishTime: r.publishTime,
      sentiment: sentiment(rating)
    });
  }
  return {
    reviews,
    avgRating: res.rating || 0,
    totalCount: res.userRatingCount || 0
  };
}

async function main() {
  if (!PLACES_API_KEY) throw new Error('Missing env: GOOGLE_PLACES_API_KEY');

  const labsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../labs.json'), 'utf8'));
  const labs = labsData.labs || labsData;

  // Load existing data to merge (accumulate) reviews — never lose old reviews
  const dataPath = path.join(__dirname, '../docs/data.json');
  let existingBranches = {};
  try {
    const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    for (const b of (existing.branches || [])) {
      existingBranches[b.id] = b.reviews || [];
    }
  } catch(e) { /* first run, no existing data */ }

  const branches = [];
  const alerts = [];

  for (const lab of labs) {
    process.stdout.write(`\nFetching ${lab.name}... `);

    const searchQuery = lab.query || `${lab.name} ${lab.city || ''} India`;
    const placeId = await findPlaceId(searchQuery);
    if (!placeId) {
      console.log('Place not found, skipping');
      branches.push({
        id: lab.id, name: lab.name, city: lab.city || '',
        rating: 0, reviewCount: 0, reviews: existingBranches[lab.id] || [],
        lastSyncedAt: new Date().toISOString()
      });
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    const { reviews: newReviews, avgRating, totalCount } = await fetchReviewsForPlace(placeId);

    // Merge: combine new reviews with old, deduplicate by reviewId, sort newest first
    const oldReviews = existingBranches[lab.id] || [];
    const allById = {};
    for (const r of oldReviews) allById[r.reviewId] = r;
    for (const r of newReviews) allById[r.reviewId] = r; // new overwrites old (rating may change)
    const mergedReviews = Object.values(allById).sort((a, b) =>
      new Date(b.publishTime) - new Date(a.publishTime)
    );

    for (const r of newReviews) {
      if (r.rating <= 2) alerts.push({
        branchId: lab.id, branchName: lab.name,
        reviewId: r.reviewId, rating: r.rating,
        text: r.text, reviewerName: r.reviewerName,
        createdAt: r.publishTime
      });
    }

    branches.push({
      id: lab.id, name: lab.name, city: lab.city || '',
      rating: avgRating,
      reviewCount: totalCount,
      reviews: mergedReviews,
      lastSyncedAt: new Date().toISOString()
    });

    console.log(`${newReviews.length} new fetched, ${mergedReviews.length} total stored, avg ${avgRating} (${totalCount} total)`);
    await new Promise(r => setTimeout(r, 400));
  }

  const output = { generatedAt: new Date().toISOString(), branches, alerts };
  fs.writeFileSync(dataPath, JSON.stringify(output, null, 2));
  console.log(`\nDone: ${branches.length} branches, ${alerts.length} alerts`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
