// outscraperClient.js
// Thin wrapper over the Outscraper "Google Maps Reviews" API.
//
// Why Outscraper: it returns REAL Google review data (rating, total count,
// reviewer, text, date) on a free tier that needs NO credit card — unlike
// Google's own Places API, which requires a billing account.
//
// Auth: a single API key (from your Outscraper profile) in the X-API-KEY header.
// Node 18+ has global fetch, so this file has zero dependencies.
//
// The reviews endpoint often runs ASYNC: the first call returns a request id +
// a results URL that you poll until it's ready. This client handles both the
// sync and async cases for you.

const BASE = "https://api.outscraper.com";

// Fetch rating + total count + recent reviews for ONE place.
//   query         : a Google Maps URL, a place_id, or "Name, City" text
//   reviewsLimit  : how many recent reviews to pull (keep small to save credits)
async function getReviews(apiKey, query, { reviewsLimit = 10, sort = "newest" } = {}) {
  const url =
    `${BASE}/maps/reviews-v3` +
    `?query=${encodeURIComponent(query)}` +
    `&reviewsLimit=${reviewsLimit}` +
    `&limit=1` +
    `&sort=${encodeURIComponent(sort)}` +
    `&async=false`;

  const resp = await fetch(url, { headers: { "X-API-KEY": apiKey } });

  // 202 => the job is queued; poll the results URL until it finishes.
  let payload;
  if (resp.status === 202) {
    const { results_location } = await resp.json();
    payload = await pollResults(apiKey, results_location);
  } else if (resp.ok) {
    payload = await resp.json();
    // Some responses are still "Pending" even on 200 — poll if so.
    if (payload.status === "Pending" && payload.results_location) {
      payload = await pollResults(apiKey, payload.results_location);
    }
  } else {
    const body = await resp.text().catch(() => "");
    throw new Error(`Outscraper ${resp.status}: ${body.slice(0, 300)}`);
  }

  // data is an array (one entry per query) of arrays (one per place).
  const place = payload?.data?.[0]?.[0] || payload?.data?.[0] || null;
  if (!place) return { found: false };

  return normalizePlace(place);
}

// Poll the async results URL until status is Success (or we give up).
async function pollResults(apiKey, location, { tries = 30, waitMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, waitMs));
    const resp = await fetch(location, { headers: { "X-API-KEY": apiKey } });
    if (!resp.ok) continue;
    const data = await resp.json();
    if (data.status === "Success") return data;
    if (data.status === "Error") throw new Error("Outscraper job failed");
    // else still Pending — keep polling
  }
  throw new Error("Outscraper job timed out");
}

// Map Outscraper's shape into the same review shape our dashboard expects.
function normalizePlace(p) {
  const reviews = (p.reviews_data || []).map((r) => {
    const rating = typeof r.review_rating === "number" ? r.review_rating : null;
    const ts = r.review_timestamp ? r.review_timestamp * 1000 : null;
    return {
      reviewId: r.review_id || r.review_link || null,
      reviewerName: r.author_title || "Anonymous",
      rating,
      text: r.review_text || "",
      publishTime: ts ? new Date(ts).toISOString() : null,
      relativeTime: r.review_datetime_utc || "",
      sentiment:
        rating == null ? "unknown" : rating >= 4 ? "positive" : rating >= 3 ? "mixed" : "negative",
      source: "outscraper",
    };
  });

  return {
    found: true,
    name: p.name || "",
    placeId: p.place_id || null,
    rating: typeof p.rating === "number" ? p.rating : null,
    totalReviewCount: p.reviews ?? p.reviews_count ?? 0,
    reviews,
  };
}

module.exports = { getReviews, normalizePlace };
