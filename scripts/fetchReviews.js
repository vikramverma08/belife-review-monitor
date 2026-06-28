const https = require('https');
const fs = require('fs');
const path = require('path');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

// Exchange refresh token for a fresh access token
async function getAccessToken() {
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type:    'refresh_token',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (!json.access_token) reject(new Error('Token error: ' + data));
        else resolve(json.access_token);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.end();
  });
}

const sentiment = r => r >= 4 ? 'positive' : r <= 2 ? 'negative' : 'neutral';

const STAR_MAP = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function fetchReviewsForLocation(accessToken, accountId, locationId) {
  const numericId = locationId.replace('locations/', '');
  const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${numericId}/reviews?pageSize=50`;

  const res = await httpsGet(url, { Authorization: `Bearer ${accessToken}` });

  const reviews = [];
  for (const r of (res.reviews || [])) {
    const rating = STAR_MAP[r.starRating] || 0;
    reviews.push({
      reviewId:     r.reviewId || r.name?.split('/').pop(),
      reviewerName: r.reviewer?.displayName || 'Anonymous',
      rating,
      text:         r.comment || '',
      publishTime:  r.createTime || null,
      sentiment:    sentiment(rating),
      reply:        r.reviewReply?.comment || null,
    });
  }
  return reviews;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Missing env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN');
  }

  const ACCOUNT_ID = '116306995816497970771';
  const labsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../labs.json'), 'utf8'));
  const labs = labsData.labs || labsData;

  // Load existing data to merge — never lose old reviews
  const dataPath = path.join(__dirname, '../docs/data.json');
  let existingBranches = {};
  try {
    const existing = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    for (const b of (existing.branches || [])) {
      existingBranches[b.id] = b.reviews || [];
    }
  } catch(e) { /* first run */ }

  console.log('Getting access token...');
  const accessToken = await getAccessToken();
  console.log('Access token obtained.\n');

  const branches = [];
  const alerts = [];

  for (const lab of labs) {
    process.stdout.write(`Fetching ${lab.name}... `);

    try {
      const newReviews = await fetchReviewsForLocation(accessToken, ACCOUNT_ID, lab.locationId);

      // Merge: new overwrites old (rating/reply may change), sort newest first
      const oldReviews = existingBranches[lab.id] || [];
      const allById = {};
      for (const r of oldReviews) allById[r.reviewId] = r;
      for (const r of newReviews) allById[r.reviewId] = r;
      const mergedReviews = Object.values(allById)
        .filter(r => r.reviewId)
        .sort((a, b) => new Date(b.publishTime) - new Date(a.publishTime));

      const avgRating = mergedReviews.length
        ? +(mergedReviews.reduce((s, r) => s + r.rating, 0) / mergedReviews.length).toFixed(1)
        : 0;

      for (const r of newReviews) {
        if (r.rating <= 2) alerts.push({
          branchId: lab.id, branchName: lab.name,
          reviewId: r.reviewId, rating: r.rating,
          text: r.text, reviewerName: r.reviewerName,
          createdAt: r.publishTime,
        });
      }

      branches.push({
        id: lab.id, name: lab.name, city: lab.city || '',
        rating: avgRating,
        reviewCount: mergedReviews.length,
        reviews: mergedReviews,
        lastSyncedAt: new Date().toISOString(),
      });

      console.log(`${newReviews.length} fetched, ${mergedReviews.length} total`);
    } catch(e) {
      console.log(`ERROR: ${e.message}`);
      branches.push({
        id: lab.id, name: lab.name, city: lab.city || '',
        rating: 0, reviewCount: 0,
        reviews: existingBranches[lab.id] || [],
        lastSyncedAt: new Date().toISOString(),
      });
    }

    await new Promise(r => setTimeout(r, 300));
  }

  const output = { generatedAt: new Date().toISOString(), branches, alerts };
  fs.writeFileSync(dataPath, JSON.stringify(output, null, 2));
  console.log(`\nDone: ${branches.length} branches, ${alerts.length} alerts`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
