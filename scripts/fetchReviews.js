const https = require('https');
const fs = require('fs');
const path = require('path');

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET'
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
      hostname: u.hostname, path: u.pathname, method: 'POST',
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

const RATING_NUM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const sentiment = r => r >= 4 ? 'positive' : r <= 2 ? 'negative' : 'neutral';

// Search for a place by name and get its Place ID
async function findPlaceId(labName, labCity) {
  const query = encodeURIComponent(`${labName} ${labCity || ''} India`);
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id,name&key=${PLACES_API_KEY}`;
  const res = await httpsGet(url);
  if (res.candidates?.length) return res.candidates[0].place_id;
  return null;
}

// Get reviews for a Place ID using Places API (New)
async function fetchReviewsForPlace(placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const res = await httpsPost(url, {
    'X-Goog-Api-Key': PLACES_API_KEY,
    'X-Goog-FieldMask': 'reviews,rating,userRatingCount'
  }, {});

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
  return { reviews, avgRating: res.rating || 0, totalCount: res.userRatingCount || 0 };
}

async function main() {
  if (!PLACES_API_KEY) throw new Error('Missing env: GOOGLE_PLACES_API_KEY');

  const labsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../labs.json'), 'utf8'));
  const labs = labsData.labs || labsData;

  const branches = [];
  const alerts = [];

  for (const lab of labs) {
    process.stdout.write(`Fetching ${lab.name}... `);

    // Find place ID
    const placeId = await findPlaceId(lab.name, lab.city);
    if (!placeId) {
      console.log(`Place not found, skipping`);
      branches.push({
        id: lab.id, name: lab.name, city: lab.city || '',
        rating: 0, reviewCount: 0, reviews: [],
        lastSyncedAt: new Date().toISOString()
      });
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    // Fetch reviews
    const { reviews, avgRating, totalCount } = await fetchReviewsForPlace(placeId);

    for (const r of reviews) {
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
      reviews,
      lastSyncedAt: new Date().toISOString()
    });

    console.log(`${reviews.length} reviews shown, overall avg ${avgRating} (${totalCount} total)`);
    await new Promise(r => setTimeout(r, 300));
  }

  const output = { generatedAt: new Date().toISOString(), branches, alerts };
  fs.writeFileSync(path.join(__dirname, '../docs/data.json'), JSON.stringify(output, null, 2));
  console.log(`\nDone: ${branches.length} branches, ${alerts.length} alerts`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
