# Kirimku Mobile (Driver App): React Native Implementation Plan

*Updated 4 November 2026 against the backend implementation currently in the working tree. “Implemented” below means present in source, not deployed to every tenant or proven on a native device. This document does not claim a mobile app exists or that a store release is ready.*

## 1. Recommendation in brief

- **Android first**, for Driver and Kenek; add Kurir and iOS later. Finance, invoices, tariffs, customers, warehouse administration, RBAC and audit stay on the web.
- **Reuse `/api/v1`.** The existing bearer-token, tenant-resolved backend now has additive evidence metadata, a shared server-side Timemark-style renderer, and authenticated mobile capability discovery. B1, B2 and B9 are implemented with the compatibility limits below; B3–B7 remain deferred.
- **WITA is a first-class requirement.** Send `timeZone: "Asia/Makassar"` for WITA captures. The renderer also supports WIB (`Asia/Jakarta`) and WIT (`Asia/Jayapura`); omission still defaults to WIB for compatibility, not automatic zone detection.
- **Timemark-style evidence** combines capture time, a human-readable address, coordinates and reported accuracy with server-derived origin/destination, shipment count, vehicle plate and model/description, and driver where available. The baked footer is appended below the photo, not drawn over evidence.
- **Precise location is not an “exact” or certified position.** Display the reported accuracy. Device time, GPS, address and mock-provider flags are untrusted descriptive metadata; a stamp is not proof of authenticity.
- **Private Android distribution now:** plan a signed APK through EAS internal distribution or another protected download channel. Keep a stable package ID, signing key and increasing `versionCode` so a future public release remains possible. Public publishing is a separate gate, not the pilot distribution method.
- **Start with a one-week native spike.** Select a compatible stable Expo/React Native SDK at implementation time and validate camera, foreground location, geocoding, native UI availability and low-end Android behaviour. No specific future SDK or Expo UI feature is assumed available.

## 2. Findings versus implemented working-tree state

Paths in this document are relative to the repository root.

| Area / earlier finding | Current state and source | Implication for mobile |
| --- | --- | --- |
| REST, tenant and authentication | `src/infrastructure/auth/auth.ts` retains hashed bearer sessions with a **12-hour** lifetime. `src/composition/api-helpers.ts` resolves the tenant before guards; requests use `x-corp-id`. Successful responses use `{ data, meta? }`; errors may contain `message`, `errors`, `code`. | Secure token storage, tenant selection and reauthentication remain necessary. No refresh session was added. |
| Driver operations and access | Existing RBAC and transport assignment/scoping still apply; the new evidence handling does not bypass them. | Gate screens by permissions, not only role names; server checks remain authoritative. |
| CHECKPOINT versus ACTIVITY | Check-in recomputes distance to the checkpoint radius, retains its two-minute duplicate guard, and final checkpoint arrival behaviour. ACTIVITY requires photo evidence on activity creation and ordinarily on arrival; the existing `transport.arrive_without_photo` exception remains. | Implement both workflows. An in-app radius indicator is only a UX aid, not certified geolocation. |
| Previously WIB-only footer with no human address | `src/infrastructure/services/evidence-photo.ts` and `activity-watermark.ts` now accept three Indonesian zones and a sanitized, wrapped `locationLabel` of up to 240 Unicode code points. | Address and WITA support are implemented, not pending backend work. Reverse geocoding itself is still a planned client responsibility. |
| Previously only activity/ACTIVITY-arrival photos were stamped | The shared renderer is now used for check-ins, expense creation with GPS, and pickup/delivery proofs with GPS, as well as activity/arrival evidence. | B2 is implemented **with legacy caveats**, not a claim that every stored photo is stamped. |
| Legacy receipts and proofs without GPS | Expense creation and pickup/delivery confirmation still accept valid images without capture GPS; those images are decoded for validity but retained unstamped. Planned task coordinates are never substituted. | Show “capture location unavailable”; do not invent `0,0` or label task/map coordinates as capture evidence. Unstamped legacy paths do not gain the renderer's EXIF-stripping guarantee. |
| Pickup/delivery coordinate ambiguity | New `captureLatitude`, `captureLongitude`, `captureAccuracy` columns preserve submitted capture GPS separately from planned task `latitude`/`longitude`. | Requests still send `latitude`, `longitude`, `locationAccuracy`; distinguish capture and destination fields when reading records. |
| Capture freshness | Activity/arrival still require `capturedAt`. Other extended routes accept it optionally, defaulting to server time if omitted; supplied timestamps are validated against the same 300-second past / 30-second future window. Check-in `recordedAt` remains server time. | Default server time is not a recovered shutter time. Old queued evidence is not supported; optional metadata does not enable offline capture. |
| Evidence transport | JSON base64 JPEG/PNG inputs remain limited to 2,500,000 characters per data URL. Activity lists still carry inline photos. | Resize/compress before upload; B7 thumbnails/binary delivery remains deferred. |
| Retry safety | No general idempotency contract has been added; the check-in duplicate guard is not an idempotency key. | No automatic mutation retries or replay queue. A lost response must trigger state reconciliation before a user retries. |
| Mobile discovery | New `src/app/api/v1/mobile/config/route.ts`: authenticated, tenant-resolved, `Cache-Control: private, no-store`. | Use returned time, version policy, evidence limits and capability flags; it does not itself enforce an upgrade in a nonexistent client. |
| Persistence | `prisma/schema.prisma` and nullable migration `20261103120000_mobile_evidence_metadata` extend activity, checkpoint, expense, pickup and delivery records. | Deploy migrations to every tenant and regenerate Prisma Client before relying on these fields. No historical evidence backfill is implied. |
| Shared/native client | Framework-free logic exists in `src/domain/transport-ops.ts`, `src/shared/activity-tracking.ts` and related shared modules. No native app or shared workspace is delivered by this backend work. | A mobile client, contracts extraction, native permission flows and real-device verification are still future work. |

## 3. App scope and priorities

All mobile entries below are **planned**, not implemented screens.

| Module | Priority |
| --- | --- |
| Corporate ID login, profile, logout, secure token storage and 401 handling | Android MVP |
| Driver home, assigned/upcoming transport detail, route, checkpoints and shipments | Android MVP |
| CHECKPOINT selfie check-in, ACTIVITY reports, depart/arrive | Android MVP |
| Timemark preview, live capture, foreground GPS, WITA selection, address fallback | Android MVP |
| Operational expenses and receipt capture, MULTI_DROP unload | Android MVP |
| Native maps hand-off and distance-to-checkpoint indicator | Android MVP |
| DIRECT pickup/delivery QR workflows, receiver proof and Kurir screens | Subsequent phase; backend proof metadata already available |
| Offline queue, safe retries, refresh sessions, push and optimized photo delivery | Deferred until B3–B7 contracts exist |
| iOS app and platform-native visual polish | After Android pilot; keep architecture portable |
| Warehouse scanning / lightweight owner approval | Optional later scope |
| Finance, tariffs, invoices, customers, partners, wallet, repairs, RBAC and audit administration | Web-only |

## 4. Architecture and stack (proposed)

| Decision | Proposed choice and validation |
| --- | --- |
| Framework | Expo development builds, not an assumption that Expo Go covers the native dependencies. Choose and pin a compatible stable SDK/React Native pair at implementation time; verify Android toolchain, minimum OS and library support in the spike. |
| Navigation | Evaluate Expo Router native stack/tabs on the selected SDK. Validate actual Android and later iOS behaviour instead of promising specific system effects. |
| Native UI | Evaluate `@expo/ui` Compose/SwiftUI bindings and their stability/component coverage in the spike. Prefer Android-native Material controls; use supported alternatives where necessary. Material 3 Expressive and Liquid Glass are design goals only where supported, not guaranteed API coverage. |
| Server state | TanStack Query with a typed API client and **mutation retries disabled** until B5 exists. |
| Auth | Evaluate `expo-secure-store` for bearer credentials; tenant switching must clear tenant-specific caches. No secret in source, APK or public config. |
| Camera | Evaluate `expo-camera` for live capture, flash, front/back cameras and QR scanning; consider alternatives only if device measurements justify them. |
| Location | Evaluate `expo-location`, **foreground only**. Stop watches when the capture screen/app is no longer active. No background tracking in MVP. |
| Image processing | Evaluate `expo-image-manipulator`; target roughly 1280 px long edge and JPEG quality around 0.8, then measure the actual data URL length. |
| Maps | Begin with external maps deep links. Spike an embedded map only if required, verifying provider keys, licensing and SDK compatibility. |
| Shared code / layout | Consider `mobile/` and `packages/contracts/` alongside the existing root web app; verify Bun workspace, Next.js and Metro compatibility before extracting pure logic. These directories are not created by this plan update. |
| Build/distribution | Signed private Android APK, EAS internal distribution or equivalent protected delivery. OTA updates are a later configured/tested option, not a substitute for native binary updates. |

## 5. Native UI and capture experience

Share screens, hooks and domain contracts while keeping platform-specific controls behind small adapters. Android ergonomics, legible text, large touch targets and TalkBack come before iOS polish. Indonesian is primary; plan English and VoiceOver when iOS work begins. Validate available native controls on the chosen SDK rather than relying on unverified SDK/version claims.

Proposed capture flow:

1. Home opens the appropriate camera action: next checkpoint, activity report or arrival evidence.
2. Request camera and foreground **precise** location permission with a clear explanation. Handle denial and approximate-only access; never represent an approximate fix as precise.
3. Start a fresh high-accuracy location watch while the camera is active. Display coordinates and accuracy, for example green at ≤20 m, amber at ≤50 m and red above that. These are proposed UX thresholds, not implemented server rejection limits.
4. Reverse-geocode a usable fix through a swappable platform wrapper. Cache/debounce requests and use a short timeout (proposed 3 seconds). Check provider availability on the actual devices; do not assume a particular Google/Apple service or API implementation.
5. Freeze the shutter-time fix and capture timestamp together, resize, then show Retake / Use. Do not silently pair the image with a materially later location snapshot.
6. Preview time and zone, human address, coordinates plus accuracy, and available trip context. The preview approximates the server footer; the server-returned image is the stored result.
7. Upload while online. On ambiguous failure, retain an appropriately protected draft and reconcile server state before retrying; no promise of durable offline submission under today's contracts.

Geocoding failure must not block otherwise valid GPS evidence: omit `locationLabel` or send null and let the renderer show its address-unavailable fallback. Normalize a compact Indonesian address within **240 code points**, not the old proposed 120-character cap. Do not submit the literal string `"WITA"` as `timeZone`; use `Asia/Makassar`. Choose zone deliberately for the operating region, with a visible label; the backend does not infer it from GPS.

## 6. Timemark-style evidence: implemented renderer and trust boundary

`src/infrastructure/services/activity-watermark.ts` is the single final stamper:

- Rotates/normalizes the source, resizes within 1600 × 1600 without enlargement, appends a footer and outputs a JPEG data URL. EXIF is stripped in this re-encoding path. The footer expands the canvas, preserving the photo area rather than covering it.
- Displays local time/date in WIB, WITA or WIT, six-decimal coordinates, reported GPS accuracy (or “unavailable”), and wrapped address lines (up to four lines in the trip layout).
- The expanded layout displays origin/destination, transport code where available, shipment count, plate, vehicle model/description and driver. Transport routes load this context from the database, not arbitrary client fields. Current model/description text comes from the vehicle's `name`, not a new normalized model field.
- Pickup/delivery proof context comes from the shipment and assigned courier (with uploader fallback), with shipment count 1. These routes do not supply vehicle details; unavailable fields are shown as unavailable, not fabricated. The renderer also retains a compact fallback layout when expanded context is absent.
- Final stamped images are recompressed within the existing per-image size budget. Expense creation uses a per-image share of the 10 MiB aggregate budget so detailed stamped receipts remain compatible with the web editor; unusually large output can be downscaled further or rejected rather than silently exceeding storage/edit limits.
- Pickup/delivery list, detail and edit responses enforce `proof_photo.view` on the server. Without it, `photoUrl` is null and precise capture metadata is omitted; planned task coordinates remain available. Authorized upload responses still return the submitting user's evidence.
- `mockLocation: true` is stored and renders a warning. False/null does **not** certify a real GPS fix. This is partial B8 metadata support, not attestation, spoof detection or an independent audit verdict.

Coordinates printed to six decimal places are display precision, not six-decimal physical accuracy. The server validates ranges, freshness and checkpoint distance using submitted values; it does not independently determine the phone's position, address or shutter time. A device-supplied address is not server-geocoded or verified. Server-derived trip context is distinct from these untrusted capture fields.

**Compatibility boundaries:** historical photos are not re-stamped. Valid legacy no-GPS receipts/proofs remain unstamped and are stored as submitted after decode validation, so no blanket EXIF-removal claim applies to them. Expense PUT deliberately does not stamp historical or replacement photos with a new time; see the contract below. Do not infer evidence quality solely from the presence of metadata columns.

## 7. Backend contracts now available

### 7.1 Common request and validation rules

Use `Authorization: Bearer <session-token>`, `x-corp-id: <corporate-id>` and `Content-Type: application/json` for JSON mutations. Existing permission, tenant, assignment, state, scan and invoice gates still apply.

| Capture field | Implemented contract |
| --- | --- |
| `locationLabel` | Optional string or null, maximum 240 Unicode code points checked before sanitization. Controls/bidi controls removed or replaced, whitespace collapsed; blank becomes null. Device-supplied, not verified. |
| `timeZone` | Optional, **non-null** enum: `Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`. Omission defaults to Jakarta/WIB. |
| `capturedAt` | ISO timestamp string with explicit `Z` or offset; when supplied, no older than 300 seconds and no more than 30 seconds ahead of server time. Required for activity/ACTIVITY-arrival evidence; other extended routes default to server time if omitted. Null is not omission. |
| `mockLocation` | Optional boolean or null; omit/null for unknown. Strings such as `"false"` are invalid. Not a trusted anti-spoof signal. |
| `latitude`, `longitude` | Finite numbers within ±90 / ±180. Required for activity and check-in. Optional as a pair for pickup/delivery proof. Expense creation permits omission of all location fields; supplying any location field requires valid coordinates **and accuracy**. Native clients should send numbers, not rely on legacy coercion in check-in. |
| `locationAccuracy` | Non-negative finite number in metres; optional/null for activity, check-in and pickup/delivery. Expense location validation requires a number when location is supplied. |
| Image inputs | JPEG/PNG base64 data URLs, maximum 2,500,000 characters each (not a binary 2.5 MB allowance). Invalid/corrupt or unprocessable images fail validation. |

Invalid metadata, coordinates, stale timestamps and image processing failures generally return **422** before evidence is saved. Authentication can return **401**, permission/assignment failures **403**, missing records **404**, and concurrent/state conflicts may return **409**. Check business error messages; do not blindly retry a failed mutation or treat a 5xx/lost response as proof nothing was saved.

### 7.2 Evidence route table

All routes below are under `/api/v1`. “Metadata” refers to the common optional `locationLabel`, `timeZone`, `capturedAt`, `mockLocation` fields above, with route-specific requirements preserved.

| Method and route | Payload / behaviour | Persistence and limitations |
| --- | --- | --- |
| `POST /transports/{id}/activities` | Required `photo`, GPS pair and `capturedAt`; optional accuracy and metadata. ACTIVITY mode and existing status/access checks. | Stamped `TransportActivity`, metadata stored; trip context loaded server-side. |
| `POST /transports/{id}/arrive` | ACTIVITY arrival normally uses the same evidence body as activities. Existing no-photo permission exception and CHECKPOINT behaviour remain. | Uses the shared evidence parser/renderer when evidence is required; not a universal mandatory-photo endpoint. |
| `POST /transports/{id}/checkins` | Required `checkpointId`, `photo`, GPS pair; optional accuracy and metadata. Server recomputes radius and retains duplicate/assignment checks. | Stamped `CheckpointRecord`; optional capture time stored separately from server `recordedAt`. First/final checkpoint automation unchanged. |
| `POST /transports/{id}/expenses` | Required `type`, `amount`; optional description, legacy single `photo`, `photos` array (up to 8) and metadata. With location, require GPS pair + accuracy. Prefer `photos` rather than sending both representations. | Each supplied receipt is stamped when GPS exists. Without GPS, valid receipts remain unstamped. One capture metadata set applies to the row/photos; do not mix unrelated capture locations/times. Create response contains `hasPhoto`/`photoCount`, not photo bytes. |
| `PUT /transports/{id}/expenses/{expenseId}` | Existing PENDING-expense edit contract, not a fresh capture/stamping endpoint. Validates newly supplied images; location edits require the complete valid location set. | Does not re-stamp photos. Photo changes or changed location clear row `locationLabel`, `timeZone`, `capturedAt`, `mockLocation` to avoid misleading mixed/historical metadata. Text-only edits preserve it. New POST metadata handling must not be assumed for PUT. |
| `POST /pickups/{id}/confirm` | Required `photoUrl`; optional notes, capture GPS/accuracy and metadata. Existing invoice/scan/assignment gates remain. | GPS-bearing proof stamped; without GPS retained unstamped. Sets pickup to `PICKED_UP`, not warehouse-completed. Stores capture GPS separately from planned coordinates. |
| `POST /deliveries/{id}/complete` | Required `photoUrl` and `proofOfDelivery` (receiver/proof string); optional notes, capture GPS/accuracy and metadata. Existing scan/payment/business checks remain. | GPS-bearing proof stamped; without GPS retained unstamped. Stores capture GPS separately and retains completion workflow. |

Do not send client `origin`, `destination`, `shipmentCount`, `vehiclePlate`, `vehicleDescription` or `driverName` expecting to override the server stamp. For pickup/delivery, request `latitude`/`longitude` map to stored **`captureLatitude`/`captureLongitude`**, and `locationAccuracy` maps to **`captureAccuracy`**; planned task coordinates are not overwritten.

### 7.3 Payload examples

These are illustrative JSON shapes, not executable fixtures: replace image placeholders with real JPEG/PNG data URLs, IDs with assigned records and `capturedAt` with a fresh timestamp at submission. The fixed timestamp illustrates WITA offset syntax and will fail freshness validation outside its window. Headers are as above.

Activity / evidence-required ACTIVITY arrival:

```json
{
  "photo": "data:image/jpeg;base64,<actual-image-base64>",
  "latitude": -5.147665,
  "longitude": 119.432731,
  "locationAccuracy": 8.5,
  "capturedAt": "2026-11-03T09:02:03+08:00",
  "timeZone": "Asia/Makassar",
  "locationLabel": "Jl. Pelabuhan, Makassar, Sulawesi Selatan",
  "mockLocation": false
}
```

For check-in, add `checkpointId` and capture **at the actual checkpoint**; the illustrative coordinates above are not a geofence bypass. For expense creation, use `type`/`amount` plus `photos` instead of the activity `photo` field:

```json
{
  "type": "BBM",
  "amount": 150000,
  "photos": ["data:image/jpeg;base64,<actual-image-base64>"],
  "latitude": -5.147665,
  "longitude": 119.432731,
  "locationAccuracy": 8.5,
  "capturedAt": "2026-11-03T09:02:03+08:00",
  "timeZone": "Asia/Makassar",
  "locationLabel": "SPBU, Makassar"
}
```

Delivery proof (pickup confirmation uses the same capture fields but does not require `proofOfDelivery`):

```json
{
  "photoUrl": "data:image/jpeg;base64,<actual-image-base64>",
  "proofOfDelivery": "Nama penerima",
  "latitude": -5.147665,
  "longitude": 119.432731,
  "locationAccuracy": 8.5,
  "capturedAt": "2026-11-03T09:02:03+08:00",
  "timeZone": "Asia/Makassar",
  "locationLabel": "Alamat lokasi serah terima"
}
```

Legacy delivery compatibility: `{ "photoUrl": "<valid JPEG/PNG data URL>", "proofOfDelivery": "Nama penerima" }` is still accepted after existing workflow checks, with no invented GPS and no stamp. Optional metadata defaults do not turn that photo into verified capture evidence.

### 7.4 `GET /api/v1/mobile/config` (B9)

This endpoint requires a valid bearer session and resolved tenant but no additional feature permission. Fetch after authentication and when checking clock/version policy; honour `Cache-Control: private, no-store`. Example successful body with default environment configuration (time is illustrative):

```json
{
  "data": {
    "serverTime": "2026-11-03T01:02:03.000Z",
    "android": {
      "minimumVersionCode": 1,
      "latestVersionCode": 1,
      "distribution": "private"
    },
    "evidence": {
      "timeZones": ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"],
      "defaultTimeZone": "Asia/Jakarta",
      "maxLocationLabelLength": 240,
      "maxPhotoDataUrlLength": 2500000,
      "maxCaptureAgeSeconds": 300,
      "maxFutureSkewSeconds": 30,
      "serverWatermark": true,
      "locationLabelSource": "device"
    },
    "capabilities": {
      "offlineCapture": false,
      "idempotentMutations": false,
      "refreshSessions": false,
      "pushNotifications": false,
      "mockLocationMetadata": true
    }
  }
}
```

Runtime environment policy:

| Variable | Behaviour |
| --- | --- |
| `MOBILE_ANDROID_MIN_VERSION_CODE` | Positive safe integer; invalid/missing value falls back to 1. |
| `MOBILE_ANDROID_LATEST_VERSION_CODE` | Positive safe integer; invalid/missing falls back to minimum. Returned latest is clamped to at least minimum. |
| `MOBILE_DISTRIBUTION` | Only exact `public` returns public; every other/missing value returns `private`. This flag does not secure a download URL or implement store readiness. |

Use `serverTime` to estimate clock skew (allowing for request latency) and warn users rather than hiding their device's wrong clock. Version comparisons use Android integer `versionCode`, not display-version string ordering. A future client must implement any upgrade UI; no download URL, update installer, push registration or refresh token is provided here. Keep all four deferred capability flags **false** until their backend contracts exist; `mockLocationMetadata: true` only advertises metadata support.

## 8. Backend work status

| ID | Working-tree status | Remaining scope / caveat |
| --- | --- | --- |
| B1 — address and zone metadata | **Implemented** | Nullable storage, sanitized 240-code-point address, wrapping and WIB/WITA/WIT renderer. Native geocoding and capture UI remain to build. |
| B2 — shared evidence stamping | **Implemented with compatibility limits** | Activity/arrival, check-in, GPS-bearing expense creation and pickup/delivery proofs. Legacy no-GPS photos stay unstamped; expense edits are not a restamping flow; no historical backfill. |
| B9 — mobile config | **Implemented** | Authenticated tenant-resolved no-store discovery, server time, Android version/distribution policy, evidence limits and honest flags. Client upgrade gate and deployment verification remain. |
| B3 — push registration/assignment notifications | **Deferred** | No push capability advertised. |
| B4 — longer mobile session, refresh/revocation | **Deferred** | Existing 12-hour bearer sessions remain; no refresh capability advertised. |
| B5 — mutation idempotency | **Deferred** | Needed before safe automatic retry/replay; duplicate check-in guard is insufficient. |
| B6 — bounded offline capture/submission | **Deferred** | No offline capture capability; old photos still fail freshness checks when a capture timestamp is supplied. Omitting time must not be used as an offline workaround. |
| B7 — thumbnails/binary photo delivery | **Deferred** | Inline base64 list/performance limits remain. No invented config flag for this work. |
| B8 — mock-location signal | **Metadata storage and rendered warning implemented only** | Flag is client-supplied and untrusted. Certified anti-spoofing, attestation and any richer audit UX are not implemented by it. |

## 9. Navigation and location policy

- **Getting there:** deep-link to an installed maps app with checkpoint/drop/pickup/delivery destination coordinates. Validate supported schemes on Android, and later iOS declarations. Do not rebuild turn-by-turn navigation.
- **Knowing when to capture:** show distance to the next checkpoint using its `radiusMeters`; a small map/haptic is optional. The server still rejects out-of-radius check-in based on submitted coordinates. Route destination coordinates are never a substitute for device capture coordinates.
- **Accuracy:** wait briefly for a fresh fix, show its measured accuracy and explain degraded conditions. Decide a product warning/block threshold in the spike; do not claim an accuracy threshold is enforced by these changes. Approximate-only location may prevent reliable checkpoint use.
- **Foreground only:** no region-entry notifications, background tracking or background geofences in MVP. Adding them requires a separate necessity, permission, privacy and publishing review.
- **Privacy:** precise location and addresses embedded in photos remain sensitive even after EXIF removal. Restrict evidence access to authorized tenant users; no public photo sharing or public download links. Protect local drafts, minimize retention and prevent logs/analytics/crash attachments from leaking tokens, full photos or precise coordinates. Platform geocoding/maps can send coordinates to their provider; disclose and assess that data flow.

## 10. Roadmap and distribution

Estimates are planning ranges for one or two experienced React Native developers, not completed milestones.

**Phase 0 — Android spike (about 1 week).** Pin a compatible stable SDK/toolchain; verify Expo UI native component availability instead of assumed version claims. Test live camera, foreground precise/approximate permissions, WITA rendering, geocoder fallback, payload size and memory on low-end Android. Measure time to fix and shutter latency. Verify any contracts extraction builds with Next.js and Metro. iOS investigation is secondary and must not block the Android pilot.

**Phase 1 — online Android driver MVP (about 5 weeks after spike).** Build login/home/transport/check-in/activity/depart/arrive/expenses/unload/navigation flows against B1/B2/B9 already in source. Implement secure storage, session-expiry UX, disabled automatic mutation retries, version policy UI and state reconciliation. Exit: real drivers complete CHECKPOINT and ACTIVITY trips on staging with readable WITA stamps and correct trip context. No offline guarantee.

**Phase 2 — private pilot and field hardening.** Deliver a **signed private APK**, for example EAS internal distribution, through an access-controlled/download-protected channel. Do not treat an unguessable link alone as authorization. Limit testers, provide installation/update/support instructions and account revocation, and test upgrade over an installed build. Keep the package ID stable, back up/restrict the signing key and credentials, and monotonically increase `versionCode`. Choose identity/signing with a future Play migration in mind and verify that path before the first pilot. Add Kurir/DIRECT QR flows as prioritized. Implement B3–B7 separately before promising push, durable offline queues, refresh sessions or safe replay.

**Phase 3 — future public publishing (separate decision).** Android publishing normally requires a release **AAB** and Play App Signing planning. Verify **current Google Play policies at submission time**: target API, required testing/verification tracks, account requirements, signing, data safety, privacy policy, permission declarations and any applicable location/photo rules. Test release builds and updates, establish support/crash monitoring and staged rollout. Private distribution does not waive privacy/security obligations. iOS later needs its own SDK, signing, device testing, privacy and distribution review; TestFlight/App Store readiness is not implied.

Optional later work: warehouse/owner screens and supported platform-specific visual polish after core driver reliability is proven.

## 11. Validation and remaining release gates

Backend test sources already cover metadata validation and renderer behaviour in `tests/shared/evidence-photo.test.ts` and `tests/shared/activity-watermark.test.ts`; route coverage includes `tests/app/api/v1/evidence-routes.test.ts`, expense route tests and delivery completion tests. These are not evidence of a working native client or production tenant deployment.

**Backend validation performed (4 November 2026):** production `npm run build`, TypeScript checking, Prisma schema validation, targeted ESLint and whitespace checks passed. The focused evidence/config/proof-visibility run passed 291 tests, including WITA midnight date rollover. Full `npm test` passed 1,257 tests and failed 9; an isolated `git archive HEAD` baseline had the same 9 failures with identical messages and no shared test changed status. Existing failures are five print-layout QR assertions (missing `getCorpId` mock), one invoice-filter accessibility assertion, two shipment-expense fixture failures and one finance-summary DB mock failure. These unrelated failures were not changed. No tenant migrations or real-device validation were performed. Graphify AST refresh succeeded; SQL extraction warned that optional `tree_sitter_sql` is not installed.

Before the private pilot:

- [ ] Run the relevant backend suites and verify production-like authenticated tenant/config behaviour, including 401, no-store headers, version env fallbacks/clamping and capability values.
- [ ] Verify the migration on staging and every tenant, generated Prisma Client, role/assignment isolation and unchanged scan/invoice/geofence gates.
- [ ] Inspect rendered JPEGs with WITA/WIB/WIT date rollover, long/Unicode addresses, missing context, mock warnings, small/portrait/landscape photos, EXIF removal on stamped paths and footer legibility without photo obstruction.
- [ ] Check legacy no-GPS receipts/proofs stay unstamped and do not borrow planned coordinates; verify expense edits clear metadata when photos/location change and do not re-stamp historical evidence.
- [ ] Add native unit/component tests and emulator E2E flows once the app exists; do not describe planned tests as passing today.
- [ ] Test real low-end Android, mid-range Samsung and an aggressive-battery OEM device. Select minimum Android OS after the SDK/device spike, not from an unverified SDK prediction.
- [ ] Exercise permission denial/re-grant, approximate location, bad GPS, missing/throttled geocoder, camera failure, wrong clock, zone boundary/rollover, large images, airplane mode, lost response, session expiry and app backgrounding. Ensure location watches stop.
- [ ] Verify private APK signing, controlled distribution, stable package identity, increasing versionCode, install/upgrade, secure drafts and upgrade/reauthentication UX. Do not enable retries/offline based only on UI readiness.
- [ ] Approve privacy notice, location/photo retention, tenant access controls, logging redaction and support procedure. No public evidence sharing.

Public release remains blocked on current store-policy verification, AAB/signing/update validation, required declarations/testing and an explicit publishing decision. Performance/crash targets must be measured in the pilot, not presented as achieved.

## 12. Backend deployment checklist

This is an operator checklist, not a statement that deployment has happened.

1. Back up tenant databases, inventory every target tenant and rehearse the additive migration on staging. Review existing migration history before rollout; do not retrofit or reset it.
2. Apply **`prisma migrate deploy` for each tenant database** using that tenant's configured database connection and the project's Prisma CLI (for example `npx prisma migrate deploy`). Ensure `20261103120000_mobile_evidence_metadata` is applied successfully everywhere the new backend will serve requests.
3. Run **`prisma generate`** (for example `npx prisma generate`) for the build/runtime artifact that will be deployed, then build and deploy the updated backend against migrated tenants. Do not serve new code with an old generated client or unmigrated tenant schema.
4. **Do not use `db:push`, `prisma db push`, `db:reset` or `prisma migrate reset` for this rollout.** The repository's development migration/reset scripts are not the production deployment procedure.
5. Set/verify `MOBILE_ANDROID_MIN_VERSION_CODE`, `MOBILE_ANDROID_LATEST_VERSION_CODE` and `MOBILE_DISTRIBUTION=private` in the actual runtime environment. Align minimum/latest with available signed APKs; do not force users to a build they cannot access.
6. Smoke-test `GET /api/v1/mobile/config` with real tenant headers and authentication: 200 envelope, fresh `serverTime`, `private, no-store`, expected version policy, three zones, four deferred capabilities false and mock metadata true. Verify unauthenticated access fails and tenant isolation is preserved.
7. Smoke-test assigned-user capture on each extended flow, WITA footer output, legacy no-GPS compatibility and separate pickup/delivery capture coordinates. Verify failure cases leave no evidence mutation and existing web clients remain usable.
8. Monitor processing failures, upload size, latency and auth errors without logging sensitive payloads. Record tenant migration results and rollback/support procedures; do not “roll back” by dropping nullable evidence columns or resetting databases.

## 13. Decisions still open

Android-first delivery, WITA support, foreground-only MVP location and private distribution are settled priorities, not unanswered questions. Remaining decisions are:

1. Actual Android fleet/minimum OS and low-memory device targets; when iOS becomes necessary.
2. Product warning/block policy for poor GPS accuracy, including approximate-only permission and geocoder failure UX.
3. Whether route connectivity justifies prioritizing B4–B7 before a larger rollout; no offline promise until their contracts and recovery tests exist.
4. Stable package ID, signing-key ownership/backup, protected distribution provider and future Play signing migration plan.
5. Exact shared-workspace layout and SDK/native UI choices after the spike; preserve the current web deployment.
6. Evidence/local-draft retention, authorized viewers, geocoding provider disclosure and privacy ownership.
