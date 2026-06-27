const https = require('https');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.GBP_CLIENT_ID;
const CLIENT_SECRET = process.env.GBP_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GBP_REFRESH_TOKEN;

function httpsPost(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = https.request({
      hostname, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length }
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

function httpsGet(url, accessToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error(data)); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token'
  }).toString();
  const res = await httpsPost('oauth2.googleapis.com', '/token', body);
  if (!res.access_token) throw new Error(`Token error: ${JSON.stringify(res)}`);
  return res.access_token;
}

const RATING = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const sentiment = r => r >= 4 ? 'positive' : r <= 2 ? 'negative' : 'neutral';

// Uses mybusinessreviews API v1 — no account ID needed, just location ID
async function fetchReviewsForLocation(token, locationId) {
  const reviews = [];
  let pageToken = '';
  // locationId from labs.json is like "locations/17578348237633385948"
  // strip the "locations/" prefix to get just the numeric ID
  const locId = locationId.replace(/^locations\//, '');
  do {
    const url = `https://mybusinessreviews.googleapis.com/v1/locations/${locId}/reviews` +
      (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await httpsGet(url, token);
    if (res.error) { console.warn(`  [${res.error.code}] ${res.error.message}`); break; }
    for (const r of (res.reviews || [])) {
      const rating = RATING[r.starRating] || 0;
      reviews.push({
        reviewId: r.reviewId,
        reviewerName: r.reviewer?.displayName || 'Anonymous',
        rating, text: r.comment || '',
        publishTime: r.createTime,
        sentiment: sentiment(rating)
      });
    }
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return reviews;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN)
    throw new Error('Missing env: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN');

  console.log('Getting access token...');
  const token = await getAccessToken();
  console.log('Access token OK');

  const labsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../labs.json'), 'utf8'));
  const labs = labsData.labs || labsData;

  const branches = [];
  const alerts = [];

  for (const lab of labs) {
    process.stdout.write(`Fetching ${lab.name}... `);
    const reviews = await fetchReviewsForLocation(token, lab.locationId);
    const avgRating = reviews.length
      ? +(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : 0;

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
      rating: avgRating, reviewCount: reviews.length,
      reviews, lastSyncedAt: new Date().toISOString()
    });

    console.log(`${reviews.length} reviews, avg ${avgRating}`);
    await new Promise(r => setTimeout(r, 300));
  }

  const output = { generatedAt: new Date().toISOString(), branches, alerts };
  fs.writeFileSync(path.join(__dirname, '../docs/data.json'), JSON.stringify(output, null, 2));
  console.log(`\nDone: ${branches.length} branches, ${alerts.length} alerts`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
