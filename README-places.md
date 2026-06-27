# Places API path — setup (no Google approval needed)

This path gets review **monitoring** working today: rating, total review count,
and the newest ~5 reviews per lab. No Business Profile API approval required.

## Cost reality
- 6 labs polled every 30 min ≈ 8,640 Place Details calls/month.
- That sits **under the ~10,000/month free cap** for that SKU → expected **$0**.
- Every 15 min instead would cost ≈ $124/mo. Stick to 30 min.
- Billing MUST be enabled (card on file) or the API won't respond — but you
  stay inside the free tier at this volume.

## Hard limits (by design, not a bug)
- Max ~5 reviews per place, no pagination, you don't choose which 5.
- Review data can lag real time by a few hours.
- You CANNOT reply through Places API. Replying needs the Business Profile API.

## Setup
1. Enable **Places API (New)** in your GCP project + enable billing.
2. Create an **API key**, restrict it to the Places API.
3. Store it (Firebase CLI manages the secret + grants function access; no gcloud):
   ```bash
   firebase functions:secrets:set PLACES_API_KEY
   ```
4. **Set a budget alert + daily quota cap** in GCP as a safety net.
5. Deploy:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions:pollPlacesReviews,functions:resolvePlaceIds
   ```

## Getting each lab's Place ID (do once per lab)
A Maps share link does NOT contain the Place ID. Resolve by name + city:
```
GET https://<region>-<project>.cloudfunctions.net/resolvePlaceIds?q=Belife Diagnostics Sector 62 Noida
```
Pick the correct candidate from the response, then save it:
```
branches/{branchId}.placeId = "<chosen place id>"
```
Once `placeId` is set, the 30-min poll picks the branch up automatically.

## Firestore shape (same as the Business Profile path)
```
branches/{branchId}  → name, city, placeId, rating, reviewCount, lastSyncedAt
  └─ reviews/{reviewId} → reviewerName, rating, text, sentiment, publishTime, source
alerts/{alertId}     → branchId, reviewId, rating, text, status, source
```

## Upgrade path
When/if Business Profile API approval lands, deploy the other functions
(onReviewNotification + reconcileReviews). They write to the SAME docs with
the full review set and reply capability; the dashboard doesn't change.
```
