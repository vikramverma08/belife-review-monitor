// placesIndex.js — Firebase Cloud Functions for the Places API path.
//
// Two functions:
//   1) pollPlacesReviews   — scheduled every 30 min. Polls all 6 labs,
//      writes rating + total count + newest ~5 reviews to Firestore.
//      At 6 labs / 30 min (~8.6k calls/mo) this stays in the free tier.
//   2) resolvePlaceIds     — HTTP, run when adding labs. Give it a name+city,
//      it returns candidate Place IDs to save on the branch doc.
//
// Reuses the SAME Firestore shape as the Business Profile path, so the
// dashboard reads identically. If you later get Business Profile API
// approval, that path can overwrite these docs with the full review set.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getApps, initializeApp } = require("firebase-admin/app");

const places = require("./placesClient");

if (!getApps().length) initializeApp();

// The Places API key lives in Cloud Secret Manager. Declaring it here lets
// Firebase mount it as an env var at runtime AND auto-grant the function's
// service account access — no gcloud or manual IAM needed. Set it once with:
//   firebase functions:secrets:set PLACES_API_KEY
const PLACES_API_KEY = defineSecret("PLACES_API_KEY");

// =====================================================================
// 1) Scheduled poll — every 30 minutes
// =====================================================================
exports.pollPlacesReviews = onSchedule(
  {
    schedule: "every 30 minutes",
    region: "asia-south1",
    timeoutSeconds: 300,
    secrets: [PLACES_API_KEY],
  },
  async () => {
    const db = getFirestore();
    const apiKey = PLACES_API_KEY.value();
    const branchesSnap = await db.collection("branches").get();

    for (const doc of branchesSnap.docs) {
      const b = { id: doc.id, ...doc.data() };
      if (!b.placeId) continue; // skip branches not yet resolved
      try {
        const details = await places.getPlaceDetails(apiKey, b.placeId);
        await writePlaceData(db, b.id, details);
        await new Promise((r) => setTimeout(r, 200)); // gentle spacing
      } catch (e) {
        console.error(`Poll failed for ${b.id}:`, e.message);
      }
    }
  }
);

// Upsert reviews (dedupe by reviewId) + update branch summary, and raise
// an alert for any NEW review <= 2 stars.
async function writePlaceData(db, branchId, details) {
  const branchRef = db.collection("branches").doc(branchId);
  const reviewsCol = branchRef.collection("reviews");

  // Update summary (rating + total count from the API).
  await branchRef.set(
    {
      rating: details.rating,
      reviewCount: details.totalReviewCount,
      lastSyncedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  for (const r of details.reviews) {
    if (!r.reviewId) continue;
    const ref = reviewsCol.doc(r.reviewId);
    const existing = await ref.get();
    const isNew = !existing.exists;
    await ref.set({ ...r, branchId, syncedAt: FieldValue.serverTimestamp() }, { merge: true });

    if (isNew && r.rating != null && r.rating <= 2) {
      await db.collection("alerts").add({
        branchId,
        reviewId: r.reviewId,
        rating: r.rating,
        text: r.text,
        createdAt: new Date().toISOString(),
        status: "open",
        source: "places_api",
      });
    }
  }
}

// =====================================================================
// 2) One-time / on-demand: resolve Place IDs from name + city
//    Call when adding a lab. Protect or remove after use.
//    Example: GET .../resolvePlaceIds?q=Belife Diagnostics Sector 62 Noida
// =====================================================================
exports.resolvePlaceIds = onRequest(
  { region: "asia-south1", secrets: [PLACES_API_KEY] },
  async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "Pass ?q=<lab name + city>" });
    const apiKey = PLACES_API_KEY.value();
    const candidates = await places.resolvePlaceId(apiKey, String(q));
    // You eyeball the right one and save its placeId on the branch doc:
    //   branches/{id}.placeId = "<chosen place id>"
    res.json({ query: q, candidates });
  }
);
