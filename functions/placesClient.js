// placesClient.js
// Google Places API (New) v1 wrapper.
//
// Auth: a simple API key works for Places API (unlike the Business Profile API,
// which needs OAuth). Store the key in Secret Manager / env, never in code.
//
// What this gives you:
//   - resolvePlaceId(name+city)  -> find a lab's Place ID once (Text Search)
//   - getPlaceDetails(placeId)   -> rating, total count, newest ~5 reviews
//
// Hard limits to remember (inherent to Places API, not a bug):
//   - Returns at most ~5 reviews per place, and you can't paginate them.
//   - Review data may lag real time by a few hours.
//   - For the FULL review stream + replying, you need the Business Profile API.

const BASE = "https://places.googleapis.com/v1";

// ---- Resolve a Place ID from a name + city (run ONCE per lab) ----
// Text Search is the reliable path; a pasted Maps share link does NOT
// contain the Place ID, so we search by text instead.
async function resolvePlaceId(apiKey, queryText) {
  const resp = await fetchWithRetry(`${BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // Field mask: ask ONLY for id + name to stay in the cheapest tier.
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: queryText, maxResultCount: 5 }),
  });
  const data = await resp.json();
  const places = data.places || [];
  // Return all candidates so the caller can pick the right branch.
  return places.map((p) => ({
    placeId: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
  }));
}

// ---- Get rating + total count + newest reviews for one place ----
// Field mask is the cost lever: request only what we use. rating + reviews
// fall in the higher-priced "Pro/Atmosphere" tier, so we keep the list tight.
async function getPlaceDetails(apiKey, placeId) {
  const url = `${BASE}/places/${placeId}`;
  const resp = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "id",
        "displayName",
        "rating",
        "userRatingCount",
        "reviews", // capped at ~5 by Google
      ].join(","),
    },
  });
  const data = await resp.json();
  return {
    placeId: data.id,
    name: data.displayName?.text || "",
    rating: data.rating ?? null,
    totalReviewCount: data.userRatingCount ?? 0,
    reviews: (data.reviews || []).map(normalizePlaceReview),
  };
}

// Normalize a Places-API review into the same shape our Firestore uses.
function normalizePlaceReview(r) {
  // r.name looks like: places/{placeId}/reviews/{reviewId}
  const reviewId = r.name ? r.name.split("/").pop() : null;
  const rating = typeof r.rating === "number" ? r.rating : null;
  return {
    reviewId,
    reviewerName: r.authorAttribution?.displayName || "Anonymous",
    rating,
    text: r.text?.text || r.originalText?.text || "",
    // Places gives relative time ("2 weeks ago") + an absolute publishTime.
    publishTime: r.publishTime || null,
    relativeTime: r.relativePublishTimeDescription || "",
    sentiment:
      rating == null ? "unknown" : rating >= 4 ? "positive" : rating >= 3 ? "mixed" : "negative",
    source: "places_api",
  };
}

async function fetchWithRetry(url, options, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    const resp = await fetch(url, options);
    if (resp.ok) return resp;
    const retryable = resp.status === 429 || (resp.status >= 500 && resp.status < 600);
    if (!retryable || attempt >= maxRetries) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Places API ${resp.status}: ${body.slice(0, 300)}`);
    }
    const wait = Math.min(1000 * 2 ** attempt, 16000) + Math.random() * 400;
    await new Promise((r) => setTimeout(r, wait));
    attempt++;
  }
}

module.exports = { resolvePlaceId, getPlaceDetails };
