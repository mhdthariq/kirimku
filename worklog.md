# Kirimku — Project Worklog

## Project Overview
Kirimku is a shipment & logistics management system (Next.js 16 + Prisma/SQLite).
The current task is implementing the **Vehicle Capacity Status & Operational Load
Monitoring** plan (informational, non-blocking capacity badges for Weight / Volume / Koli).

---
Task ID: 1
Agent: main
Task: Merge uploaded kirimku-updated.zip (kirimku-main) into /home/z/my-project, install deps, set up DB, start dev server.

Work Log:
- Extracted kirimku-updated.zip → /tmp/kirimku-extract/kirimku-main
- Copied src/, prisma/, public/, docs/ + config files (package.json, tsconfig, tailwind, postcss, next.config, eslint, components.json, vitest.config, next-env.d.ts, .gitignore) into /home/z/my-project; preserved .env, .git, node_modules, .next, dev.log, upload, tool-results, download, skills, .zscripts, Caddyfile, examples, mini-services, db, tests
- Updated package.json dev script to `next dev -p 3000 2>&1 | tee dev.log`
- `bun install` (added jsbarcode, jsqr, leaflet, qrcode, uuid, vitest, @types/*)
- `bun run db:push` (created db/custom.db with full schema)
- `bun run db:seed:owner` + `bun run db:seed:accounts` (owner + demo accounts created; full demo seed has a pre-existing duplicate pickupCode bug, skipped)
- Started dev server on port 3000 (Ready)

Stage Summary:
- Project merged & running. Login: owner / ChangeMeOwner#2026 (full access).
- DB at db/custom.db. Dev server up at localhost:3000.
- Key codebase understood: Vehicle (maxWeightKg Float, maxVolumeM3 Float, NO maxKoli yet), Transport, TransportShipment, DetailShipment (actualWeightKg, L/W/H cm, volumeM3). Shared volume calc lives in src/lib/pricing.ts (detailVolumeM3, private). Transport totals in src/lib/transport-totals.ts (uses chargeableWeightKg for totalWeightKg; detailAggregates gives actualKgByMaster + packagesByMaster + volumeByMaster).

---
Task ID: 2-9
Agent: main
Task: Implement Vehicle Capacity Status feature end-to-end (schema → lib → API → types → UI → tests).

Work Log:
- Schema: added `maxKoli Int?` to Vehicle model (prisma/schema.prisma); ran `bun run db:push`.
- Created `src/lib/capacity.ts` (shared domain calc):
  - `calculateDetailVolume` (shared volume, in sync with pricing.ts:detailVolumeM3)
  - `CapacityStatus` / `TransportCapacityStatus` types + `computeDimensionStatus` + `calculateTransportCapacityStatus`
  - Rules: null/0/negative max → UNCONFIGURED; actual weight (not chargeable); independent dimensions; overall = OVERLIMIT > PARTIALLY_CONFIGURED > OK > UNCONFIGURED
- Updated `src/lib/transport-totals.ts`: added `totalActualWeightKg` + `totalKoli` to TransportAggregates; added `transportLoadFromAggregates` helper.
- APIs (non-blocking — capacity never rejects):
  - `transports/route.ts` GET: returns `capacity` + `totalActualWeightKg` + `totalKoli` per transport
  - `transports/[id]/route.ts` GET: returns `capacity` + vehicle `maxKoli`
  - `vehicles/route.ts` POST + `vehicles/[id]/route.ts` PUT: accept `maxKoli` (null=NOT CONFIGURED, negative rejected, validated)
- `src/lib/client-api.ts`: added CapacityState/OverallCapacityState/CapacityStatus/TransportCapacityStatus types; added `capacity`/`totalActualWeightKg`/`totalKoli` to Transport + TransportDetail; added `maxKoli` to Vehicle + TransportDetail.vehicle.
- UI:
  - Created `src/components/app/capacity-status-card.tsx` (CapacityStatusCard, CapacitySummaryInline, CapacityStateBadge, OverallCapacityBadge) with color-coded badges (emerald OK / rose OVERLIMIT / amber UNCONFIGURED), utilization bars, over-by/remaining text.
  - transport-detail-page.tsx: added dedicated Capacity card between expenses & shipments; enhanced totals grid (actual weight + koli count subtitles).
  - transports-page.tsx: added "Kapasitas" column with inline overall badge + B/V/K dimension chips.
  - vehicles-page.tsx: added "Max Koli" form field + Koli row in the Kapasitas table column.
- Tests: `src/lib/capacity.test.ts` (25 tests) — all combos (OK/OVERLIMIT/UNCONFIGURED, independence, boundaries, empty transport, actual-not-chargeable). Full suite 111 tests pass.
- Lint: 0 errors (7 pre-existing warnings).
- Demo data: configured maxKoli on vehicles; TRP-2026-000004 → all OVERLIMIT (720kg/500, 1.44m³/1, 6koli/3); TRP-2026-000001 → PARTIALLY_CONFIGURED (weight OK, volume OK, koli UNCONFIGURED).
- API verified via curl: both transports return correct capacity status.

Stage Summary:
- Feature complete & API-verified. Login owner/ChangeMeOwner#2026.
- NOTE: sandbox has 4GB RAM / no swap — Next dev (Turbopack) OOM-kills on first compile of heavy routes. `.next` cache persists across restarts so compiled routes are fast afterwards. Server must be restarted if it dies during a fresh compile.

---
Task ID: 10
Agent: main
Task: Verify UI with agent-browser (transports list, transport detail, vehicles page).

Work Log:
- Ran end-to-end browser verification (server + browser in one session due to sandbox memory limits).
- Login as owner → redirected to #/dashboard.
- Transports list (#/transports): KAPASITAS column rendered correctly:
  - TRP-2026-000004 (BK 8800 KTH) → "Over Kapasitas" overall badge + B/V/K chips
  - TRP-2026-000001 (BK 9455 KTB) → "Sebagian Tak Terkonfigurasi" overall badge + B/V/K chips
- Transport detail (#/transports/1, PARTIAL state): "Kapasitas Kendaraan" card rendered with:
  - Overall badge "Sebagian Tak Terkonfigurasi"
  - BERAT row → OK ("Sisa" remaining shown)
  - VOLUME row → OK ("Sisa" remaining shown)
  - KOLI row → "BELUM DIKONFIGURASI" / "Limit belum diset"
  - Informational note: "Status kapasitas bersifat informatif — operator tetap dapat menugaskan resi meskipun kendaraan over limit..."
- Transport detail (#/transports/2, OVERLIMIT state): screenshot saved (detail-overlimit.png).
- Vehicles page (#/vehicles): KAPASITAS column shows "Koli: X" per vehicle (e.g., "500 kg · 1 m³ Koli: 3").
- Screenshots saved to download/: transports-list.png, detail-overlimit.png, detail-partial.png, vehicles-page.png.

Stage Summary:
- UI fully verified end-to-end. Capacity card, list column, and vehicle form all render correctly.
- All three states demonstrated: OK (within limit), OVERLIMIT (over limit), UNCONFIGURED (limit not set).
- Dimension independence confirmed (weight OK + volume OK + koli UNCONFIGURED → PARTIALLY_CONFIGURED).
- Non-blocking behavior confirmed (informational note displayed, no assignment prevention).
- NOTE: sandbox 4GB/no-swap causes Next dev (Turbopack) to OOM-kill on heavy route compiles; .next cache helps but server must be restarted if it dies. The webDevReview cron should restart the dev server before testing.

---
Task ID: 11-12
Agent: main
Task: Create webDevReview cron job + final verification.

Work Log:
- Created recurring cron job (job_id 429833): every 15 minutes, kind=webDevReview, tz=Asia/Bangkok. Includes restart-dev-server instructions for the sandbox memory constraint.
- Final lint: 0 errors (7 pre-existing warnings).
- Final tests: 111 pass (25 capacity + 86 existing).
- Dev server running on port 3000 (homepage HTTP 200).

## Current Project Status (final)
Vehicle Capacity Status & Operational Load Monitoring feature is COMPLETE and browser-verified.

## Completed (Definition of Done — all checked):
- [x] Vehicle has maxKoli (Int?, nullable)
- [x] Existing maxWeightKg + maxVolumeM3 reused (no duplication)
- [x] Transport calculates total koli (packagesByMaster count)
- [x] Transport calculates total actual weight (actualWeightKg sum, NOT chargeable)
- [x] Transport calculates total volume (shared calculateDetailVolume)
- [x] Weight/Volume/Koli statuses displayed independently
- [x] Overall status displayed (OK/OVERLIMIT/PARTIALLY_CONFIGURED/UNCONFIGURED)
- [x] Missing capacity shown as UNCONFIGURED (not zero)
- [x] Overlimit does NOT block assignment (informational note in UI; no API rejection)
- [x] Capacity recomputes on every API call (computed from current load, never persisted)
- [x] Shared volume calculation reused (calculateDetailVolume in lib/capacity.ts)
- [x] Actual weight used for physical capacity (not chargeable)
- [x] Unit tests cover all capacity combinations (25 tests)
- [x] Existing tests continue to pass (111 total)
- [x] No unrelated business logic changed

## Unresolved Issues / Risks
- Sandbox has 4GB RAM / no swap → Next.js dev (Turbopack) OOM-kills on heavy route compiles. .next cache mitigates but server must be restarted if it dies. The webDevReview cron includes restart instructions.
- Full demo seed (bun run db:seed) has a pre-existing duplicate pickupCode bug (fails partway). Used db:seed:owner + db:seed:accounts + manual demo data instead. Not related to capacity feature.
- Vehicle capacity config changes are audited via the existing audit() call (before/after diff) but maxKoli is included in the diff automatically since it's a vehicle field.

## Next-phase recommendations (for the webDevReview cron)
1. Add capacity summary widget on the dashboard (fleet-wide overload overview).
2. Show live capacity preview in the transport create/edit dialog when a vehicle is selected.
3. Add capacity status to the vehicle-owner partner transport history page.
4. Enhance vehicle audit log to explicitly call out maxKoli/maxWeightKg/maxVolumeM3 changes.
5. Add capacity columns to transport reports/exports.

---
Task ID: 13 (webDevReview cron round 1)
Agent: webDevReview
Task: QA + advance next-phase capacity features (dashboard widget, transport-form preview, partner history, audit callouts, styling).

## Current Project Status (assessment)
- Baseline healthy: `bun run lint` 0 errors (7 pre-existing warnings), `bun run test` 111 pass (25 capacity + 86 existing).
- Dev server running on port 3000 (homepage HTTP 200). NOTE: 4GB/no-swap sandbox → Turbopack OOM-kills on first compile of heavy routes; must restart if it dies (`pkill -f next; sleep 2; nohup ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 &`).
- Core capacity feature (Round 1) complete & verified. No bugs found this round → advanced to next-phase recommendations.

## Completed modifications this round
1. **Live capacity preview in the transport create/edit form** (transport-form-dialog.tsx):
   - New `TransportFormCapacityPreview` component (capacity-status-card.tsx) reusing the pure `calculateTransportCapacityStatus` client-side.
   - Projects the selected vehicle's capacity against the checked shipments (sum of shipment `totals.totalActualKg` / `totalVolumeM3` / `totalPackages`).
   - Shows compact 3-dimension grid (Berat/Volume/Koli) with OK/OVERLIMIT/UNCONFIGURED + Sisa/Over text. Updates live as the operator toggles shipments/changes vehicle.
   - Non-blocking note: "Preview informatif — operator tetap dapat menyimpan transport meskipun over limit."
   - Browser-verified: selected BK 1122 KTD + shipment MKT-000003 → "Preview Kapasitas · Aman · Sisa 740 KG / Sisa 3,86 M³ / Sisa 35 koli".
2. **Dashboard fleet capacity widget** (dashboard API + dashboard-page.tsx):
   - Dashboard API now computes a `capacitySummary` for active (PLANNED+DEPARTED) transports: counts over-capacity / partially-configured / healthy + per-dimension overlimit breakdown.
   - New `FleetCapacityWidget` card on the owner/admin-kantor dashboard: split bar (rose/amber/emerald), 3 status tiles, 3 per-dimension over chips, and an issue/all-clear note. Links to #/transports.
   - Browser-verified: "Kapasitas Armada" card renders with BERAT/VOLUME/KOLI breakdown.
3. **Partner transport history capacity column** (partner/transports API + vo-transport-history-page.tsx):
   - Partner transports API now returns `capacity` per transport (reuses detailAggregates + calculateTransportCapacityStatus).
   - VOTransportRow type gained `capacity?` + `vehicleId?`.
   - New "Kapasitas" column on the Vehicle Owner transport history page (CapacitySummaryInline). Empty for hendra in the demo (hendra owns no vehicles/transports in the partial seed) but code-complete.
4. **Audit log capacity-change callouts** (vehicles/[id]/route.ts + audit-page.tsx):
   - Vehicle PUT audit now detects changes to maxWeightKg/maxVolumeM3/maxKoli and adds `capacityConfigChanged: true` + `capacityChanges[]` to the audit `after` data (full diff still in `before`).
   - Audit timeline shows an amber "Kapasitas Diperbarui" badge (Gauge icon) on entries that touched capacity config.
5. **Options API**: vehicle select now includes `maxKoli` (so the transport-form preview + vehicle dropdowns have the koli limit).
6. **Styling polish**: framer-motion entrance animation + `border-l-4 border-l-primary/30` accent on the transport-detail capacity card; consistent color system (emerald OK / rose OVERLIMIT / amber UNCONFIGURED) across all capacity surfaces.

## Verification results
- Lint: 0 errors. Tests: 111 pass.
- Browser (agent-browser) verified: dashboard widget renders; transport-form preview renders with correct projected OK status + remaining capacity; all non-blocking notes present.
- Screenshots: download/dashboard-capacity-widget.png, download/transport-form-preview-final.png, download/vo-transport-history-capacity.png, download/transport-form-preview-filled.png.

## Unresolved issues / risks + next-phase recommendations
- **hendra (vehicle owner) has no vehicles/transports in the partial demo seed** (full seed has a pre-existing duplicate pickupCode bug). Next round could fix the seed's idempotency OR manually link a vehicle to hendra so the partner capacity column shows live data.
- **Capacity columns in transport reports/exports** (recommendation e from Round 1) — not yet done. Low effort: add `capacity.overallStatus` to any CSV/PDF export of transports.
- **Capacity preview in the transport-form EDIT mode** — currently create-mode only (edit mode doesn't re-pick shipments in this dialog). Could add an "add shipment" action to edit mode later.
- **Multi-drop remaining-load display** (plan §18) — the capacity card shows total assigned load; a future phase could add a "remaining cargo after drop X" panel.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 14 (webDevReview cron round 2)
Agent: webDevReview
Task: QA + advance next-phase capacity features (multi-drop remaining load, capacity ring, hendra demo fix).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 111 tests pass (25 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Round 1 features (dashboard widget, transport-form preview, partner capacity column, audit callouts) all stable. No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Multi-drop remaining-load display (plan §18)** — drops API + drops panel:
   - `GET /transports/:id/drops` now returns a `loadSummary`: `initialLoad` (all assigned cargo), `remainingLoad` (cargo still on the vehicle = LOADED/AT_DROP_POINT shipments), `droppedLoad` (initial − remaining), and `remainingCapacity` (capacity status vs the remaining load).
   - New "Sisa Muatan Kendaraan" panel at the top of the TransportDropsPanel card: 3 mini dimension tiles (Berat/Volume/Koli) showing remaining/initial + a progress bar (% dropped) + the remaining overall capacity badge. Updates live as the crew drops resi.
   - The plan §18 distinction is preserved: vehicle capacity (the capacity card) vs remaining cargo (the drops panel) are separate but related concepts.
2. **Capacity utilization donut ring** (capacity-status-card.tsx):
   - New `CapacityRing` SVG component showing the WORST (max) utilization % across configured dimensions, tinted by overall status (emerald/rose/amber/zinc). Animates on update (transition-all duration-500).
   - Integrated into the CapacityStatusCard header next to the OverallCapacityBadge — operators get an instant visual sense of how full the vehicle is.
3. **Demo data fix — hendra (vehicle owner)**:
   - Linked the 2 demo-transport vehicles (BK 9455 KTB + BK 8800 KTH) to hendra's partner profile (ownerId = 3).
   - hendra now owns 2 transports → his partner transport history page shows live capacity data (was empty in round 1).
4. **TransportDropsBoard type**: added `loadSummary?` with initial/remaining/dropped load + remainingCapacity.
5. **Styling polish**: dropped-load progress bars, "MAX" label on the ring, consistent tinted ring/bar colors per status.

## Verification results
- Lint: 0 errors. Tests: 111 pass.
- API verified: drops `loadSummary` returns initial koli=6, remaining koli=6, dropped koli=0, remainingOverall=OVERLIMIT for TRP-2026-000004.
- Browser (agent-browser) verified:
  - Transport 2 detail: "Kapasitas Kendaraan" card with ring (MAX label) + "Over Kapasitas" badge; drops panel shows "Sisa Muatan Kendaraan" with 6/6 koli, 0% dropped.
  - hendra partner history: KAPASITAS column shows "Over Kapasitas" (TRP-2026-000004) + "Sebagian Tak Terkonfigurasi" (TRP-2026-000001) with B/V/K chips.
- Screenshots: download/transport2-ring-drops.png, download/hendra-partner-capacity-v2.png.

## Unresolved issues / risks + next-phase recommendations
- **Transport print/manifest export** (recommendation e from Round 1) — still no transport export feature exists. A future round could add a "Cetak Manifest" button on the transport detail page (PDF/CSV with the capacity status + shipment list).
- **Capacity in transport-form EDIT mode** — preview is create-mode only; edit mode doesn't re-pick shipments in this dialog.
- **Capacity utilization ring on the transport list** — currently the list uses the compact CapacitySummaryInline (chips); could add a tiny ring per row for a more visual overview.
- **Seed idempotency** — full `bun run db:seed` still fails on a duplicate pickupCode; the partial-seed workaround works but a fix would make demo data reproducible.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 15 (webDevReview cron round 3)
Agent: webDevReview
Task: QA + advance next-phase capacity features (transport manifest print, capacity ring on list, seed idempotency fix).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 111 tests pass (25 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-2 features (dashboard widget, transport-form preview, partner capacity column, audit callouts, multi-drop remaining load, capacity ring on detail) all stable. No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Transport Manifest print/export** (recommendation e from Round 1) — the highest-value missing feature:
   - New `TransportManifestPrint` component (transport-manifest-print.tsx): a printable A4 manifest (surat jalan) with vehicle + crew info, a capacity status table (Berat/Volume/Koli with muatan/kapasitas/utilisasi/status), the full shipment list (masterCode, customer/penerima, tujuan, koli, berat, volume, harga, tanda-terima column), totals row, and 3 signature lines (Driver/Kenek/Petugas Gudang).
   - Follows the established ResiPrint/InvoicePrint pattern: portal + `@media print` CSS + `window.print()`.
   - "Cetak Manifest" button added to the transport detail page actions (always available).
   - Browser-verified: portal opens with "Pratinjau Manifest Transport", shows the capacity table (720/720 KG, 1,44/1,44 M³, 6/6 koli, all Over Kapasitas) + "DAFTAR SHIPMENT (1)" + TANDA TERIMA column + footer.
2. **Capacity ring on the transport list** (recommendation c):
   - `CapacitySummaryInline` now accepts `showRing` — renders a 28px `CapacityRing` (max utilization %, status-tinted) inline with the overall badge + B/V/K chips.
   - Transports list now shows the ring per row: e.g. "200% MAX Over Kapasitas" / "0% MAX Sebagian Tak Terkonfigurasi". Operators get an instant visual sense of how loaded each vehicle is.
3. **Seed idempotency fix** (recommendation d):
   - All 4 pickup `db.pickup.create` calls in seed.ts now check `findFirst({ where: { masterId } })` first and skip if a pickup already exists. The full `bun run db:seed` now completes successfully on a partially-seeded DB (was failing with a duplicate pickupCode constraint error).
4. **Lint fix**: the manifest print's `useEffect` setState calls were refactored to avoid the "Calling setState synchronously within an effect" error (wrapped in setTimeout(0) for the reset branch + the loading flag).

## Verification results
- Lint: 0 errors. Tests: 111 pass. Full `bun run db:seed` now succeeds.
- Browser (agent-browser) verified:
  - Transports list: capacity ring renders ("200% MAX Over Kapasitas" + "0% MAX Sebagian Tak Terkonfigurasi").
  - Transport 2 detail → Cetak Manifest: portal opens with "Pratinjau Manifest Transport", "Manifest Transport / Surat Jalan", capacity table (720/720 KG · 1,44/1,44 M³ · 6/6 koli · all Over Kapasitas), "DAFTAR SHIPMENT (1)" with TANDA TERIMA column, "Cetak / Simpan PDF" + "Tutup" buttons.
- Screenshots: download/transports-list-ring.png, download/transport-manifest-preview.png, download/transport-manifest-full.png.

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments in this dialog. Could add an "add/remove shipment" action to edit mode.
- **Manifest print audit log** — the manifest print fires a fire-and-forget GET (no dedicated audit entry yet). A future round could add a `printed_manifest` audit action (mirrors `printed_resi`).
- **Capacity ring on the dashboard fleet widget** — the FleetCapacityWidget currently uses tiles/chips; could add a ring showing the fleet-wide over-capacity ratio.
- **CSV export of transports with capacity** — the manifest is PDF/print; a CSV export of the transports list (with capacity.overallStatus column) would help reporting.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 16 (webDevReview cron round 4)
Agent: webDevReview
Task: QA + advance next-phase capacity features (manifest print-log audit, CSV export, dashboard fleet ring).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 111 tests pass (25 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-3 features (dashboard widget, transport-form preview, partner capacity, audit callouts, multi-drop remaining load, capacity ring, manifest print, seed fix) all stable. No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Manifest print-log audit** (recommendation: add `printed_manifest` audit action):
   - New `POST /api/v1/transports/:id/print-log` route (mirrors the resi print-log) — logs WHO printed the manifest, WHEN, with the transport code as entityLabel. Permission: `transport.view`.
   - `TransportManifestPrint` now fires this fire-and-forget POST before `window.print()`.
   - Audit page: added an indigo `printed_manifest` action style (distinct from the blue `printed_resi` / `printed_invoice`).
   - API-verified: printing TRP-2026-000004 created a `printed_manifest` audit entry ("TRP-2026-000004 by Owner Utama").
2. **CSV export of transports with capacity** (recommendation: CSV export of transports list):
   - New `exportCsv()` on the transports page (transports-page.tsx) — exports the filtered list with columns: kode, status, kendaraan, rute, koridor, driver, kenek, shipment_count, total_koli, total_berat_kg, total_volume_m3, total_harga, **kapasitas_overall, kapasitas_berat, kapasitas_volume, kapasitas_koli**, reencana_berangkat, rencana_tiba.
   - "Export CSV" button (Download icon) added to the PageHeader actions, following the established audit-page CSV pattern (Blob + createObjectURL).
3. **Capacity ring on the dashboard fleet widget** (recommendation: ring on fleet widget):
   - `FleetCapacityWidget` now shows a 64px SVG donut ring in the header with the fleet health % (% of active transports that are fully OK), tinted by fleet state (emerald OK / amber partial / rose overlimit). Center text: "X% sehat".
   - Reuses the same ring/bar color system as the per-transport CapacityRing.

## Verification results
- Lint: 0 errors. Tests: 111 pass.
- Browser (agent-browser) verified:
  - Dashboard: "Kapasitas Armada" card with the fleet health ring renders.
  - Transports: "Export CSV" button present in the header actions.
  - Manifest print-log: printing TRP-2026-000004 created a `printed_manifest` audit entry (verified via `/audit-logs?entityType=transport`).
- Screenshots: download/dashboard-fleet-ring.png.

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments in this dialog. Could add an "add/remove shipment" action to edit mode.
- **Capacity overview page** — a dedicated "Fleet Capacity" page (all vehicles with their capacity config + current utilization across active transports) would be a natural next step.
- **Capacity trend over time** — the audit log now records capacity-config changes; a future round could show a trend chart of over-capacity transports over time on the dashboard.
- **CSV export of the vehicles list** (with maxKoli) — mirrors the transports CSV; low effort.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 17 (webDevReview cron round 5)
Agent: webDevReview
Task: QA + advance next-phase capacity features (Fleet Capacity overview page, vehicles CSV export, dashboard enhanced chips).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 111 tests pass (25 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-4 features (dashboard widget, transport-form preview, partner capacity, audit callouts, multi-drop remaining load, capacity ring, manifest print + print-log, transports CSV, seed fix) all stable. No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Fleet Capacity overview page** (recommendation: dedicated Fleet Capacity page) — the headline feature:
   - New `GET /api/v1/fleet-capacity` API: every vehicle with capacity config + the LIVE capacity status of the cargo on its active (PLANNED+DEPARTED) transports. One `detailAggregates` call for all transports. Returns `vehicles[]` + a fleet `summary` (total/active/idle/overCapacity/partiallyConfigured/ok/unconfiguredVehicles).
   - New `FleetCapacityPage` component (fleet-capacity-page.tsx): 6 summary tiles (Total Armada, Aktif, Aman, Over, Sebagian, Koli Belum Diset), search + status filters (Semua/Aman/Over/Sebagian/Idle), and a DataTable with a per-vehicle mini CapacityRing, config limits, active transport count + load, overall + per-dimension status chips, and an Export CSV button.
   - Wired into the hash router (`#/fleet-capacity`) and the nav menu ("Gudang & Armada" section → "Kapasitas Armada" with the Gauge icon), gated on `vehicle.view`.
   - API-verified: total=10, active=2, idle=8, overCapacity=1, partiallyConfigured=1, unconfiguredVehicles=1.
2. **CSV export of the vehicles list** (recommendation: vehicles CSV with maxKoli):
   - New `exportCsv()` on the vehicles page — exports nopol, nama, status, max_berat_kg, max_volume_m3, **max_koli**, panjang/lebar/tinggi_m, owner. "Export CSV" button added to the PageHeader actions.
3. **Dashboard fleet widget enhanced chips** (styling polish):
   - `DimensionOverChip` now accepts the `total` and shows a mini progress bar + % of the active fleet that is over-limit on each dimension (Berat/Volume/Koli). Gives a quick visual sense of which dimension is the fleet's bottleneck.

## Verification results
- Lint: 0 errors. Tests: 111 pass.
- Browser (agent-browser) verified:
  - Fleet Capacity page: "Kapasitas Armada" heading, 6 summary tiles, Export CSV button, filter buttons (Aman/Over/Sebagian/Idle) all render; nav link present.
  - Vehicles page: "Export CSV" button present alongside "Tambah Kendaraan".
  - Dashboard: "Kapasitas Armada" widget renders.
- Screenshots: download/fleet-capacity-page.png, download/vehicles-csv.png, download/dashboard-enhanced-chips.png.

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments.
- **Capacity trend over time** — the audit log records capacity-config changes; a future round could render a trend chart (over-capacity transports over time) on the dashboard using recharts (already installed).
- **Capacity config completeness check** — the fleet page shows "Koli Belum Diset" count; could add a one-click "configure all" bulk action.
- **Per-vehicle capacity history** — clicking a vehicle on the fleet page could open a detail view with its capacity-config change history (from audit).
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 18 (webDevReview cron round 6)
Agent: webDevReview
Task: QA + advance next-phase capacity features (per-vehicle capacity history dialog, dashboard capacity trend chart).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 111 tests pass (25 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-5 features (dashboard widget, transport-form preview, partner capacity, audit callouts, multi-drop remaining load, capacity ring, manifest print + print-log, CSV exports, fleet capacity page, seed fix) all stable. No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Per-vehicle capacity history dialog** (recommendation: per-vehicle capacity history from audit):
   - New `VehicleCapacityHistoryDialog` component (vehicle-capacity-history-dialog.tsx): fetches `/audit-logs?entityType=vehicle&entityId=<id>` and filters to entries whose `after.capacityConfigChanged` is true. Renders a timeline with each change as a card: amber "Kapasitas Diperbarui" badge, actor + timestamp, and per-field diff rows (Max Berat/Volume/Koli with `before → after` formatting).
   - Wired into the Fleet Capacity page: each row now has a "Riwayat" button (History icon) that opens the dialog for that vehicle.
   - Browser-verified: updating BK 1122 KTD's maxKoli (40→45) → clicking Riwayat opens "Riwayat Kapasitas — BK 1122 KTD" showing "Max Koli 40 → 45 oleh Owner Utama (@owner)".
2. **Capacity-config change trend chart on the dashboard** (recommendation: capacity trend over time using recharts):
   - New `GET /api/v1/capacity/trend?days=14` API: buckets vehicle audit entries with `capacityConfigChanged=true` per day over the last N days. Returns `{ buckets: [{date,label,count}], total }`.
   - New `CapacityTrendChart` component (recharts BarChart) — indigo bars, X axis = date labels, Y axis = count, tooltip with per-day count. Shows total + average-per-day footer.
   - Integrated into the owner/admin dashboard in a 2-col grid: FleetCapacityWidget (col-span-2) + CapacityTrendChart. API-verified: total=1 over 14 buckets after the demo update.
3. **Styling polish**: trend chart card uses a `border-l-4 border-l-indigo-400/40` accent (distinct from the fleet widget's primary accent); history dialog uses a vertical timeline with amber dots matching the "Kapasitas Diperbarui" audit badge.

## Verification results
- Lint: 0 errors. Tests: 111 pass.
- API verified: capacity-config audit entry created on vehicle PUT (`capacityChanges: [{"field":"maxKoli","before":40,"after":45}]`); capacity trend API returns total=1 over 14 buckets.
- Browser (agent-browser) verified:
  - Dashboard: "Kapasitas Armada" widget + "Tren Perubahan Kapasitas" chart render side by side.
  - Fleet Capacity page → "Riwayat" button → "Riwayat Kapasitas — BK 1122 KTD" dialog with "Max Koli 40 → 45 oleh Owner Utama (@owner)".
- Screenshots: download/dashboard-trend-chart.png, download/capacity-history-detail.png.

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments.
- **Capacity config completeness bulk action** — the fleet page shows "Koli Belum Diset" count; could add a one-click "configure all" bulk action.
- **Capacity threshold warnings** — the plan mentions a future SOFT/HARD limit phase (§31); a future round could add a configurable warning threshold (e.g. 90% utilization → amber warning even when not over).
- **Per-vehicle capacity detail page** — currently a dialog; could be a full page with the full audit timeline + active transports list.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 19 (webDevReview cron round 7)
Agent: webDevReview
Task: QA + advance next-phase capacity features (capacity WARNING threshold — plan §31 SOFT limit preview).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 115 tests pass (29 capacity + 86 existing — 4 new WARNING tests).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-6 features all stable. No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Capacity WARNING threshold** (recommendation: capacity threshold warnings — plan §31 future SOFT limit preview) — the headline feature:
   - `src/lib/capacity.ts`: added `"WARNING"` to `CapacityState` and `OverallCapacityState`. New `DEFAULT_WARNING_THRESHOLD = 90` (%). `computeDimensionStatus` + `calculateTransportCapacityStatus` now accept a `warningThreshold` param — a dimension at >= threshold utilization but not over is `WARNING`. Overall: OVERLIMIT > WARNING > PARTIALLY_CONFIGURED > OK > UNCONFIGURED. Still informational (never blocks).
   - Labels: "Hampir Penuh" (WARNING), plus existing "Aman"/"Over Kapasitas"/"Sebagian Tak Terkonfigurasi"/"Belum Dikonfigurasi".
   - `src/components/app/capacity-status-card.tsx`: added orange WARNING styling (border-orange / bg-orange / text-orange) to STATE_STYLES + OVERALL_STYLES + ringColorClass + textColorClass. DimensionRow shows "Sisa X · hampir penuh" for WARNING. CapacityRing tints orange for WARNING.
   - Dashboard API + FleetCapacityWidget: added `warningTransports` count; the widget now has a 4-tile grid (Aman/Hampir/Sebagian/Over) + an orange segment in the split bar. fleetState flips to WARNING when there are near-limit transports.
   - Fleet Capacity API + page: added `warning` to the summary; new "Hampir" summary tile + "Hampir" filter button; DimensionChip handles WARNING.
   - Tests: 4 new WARNING tests (dimension at 92%, current==maximum, custom threshold, overall WARNING + OVERLIMIT-precedence). Updated existing tests to use < 90% utilizations for OK assertions.
2. **Demo data**: set TRP-2026-000001's load to 3220kg (92% of 3500kg max) → weight WARNING, volume OK, koli OK → overall WARNING. Set its vehicle's maxKoli=60 so koli is configured.

## Verification results
- Lint: 0 errors. Tests: 115 pass (was 111, +4 new WARNING tests).
- API verified: transport 1 returns `overall: WARNING | W: WARNING 92% V: OK K: OK`.
- Browser (agent-browser) verified:
  - Transport 1 detail: "Hampir Penuh" overall badge + "HAMPIR PENUH" Berat chip + "· hampir penuh" text.
  - Fleet Capacity page: "Hampir Penuh" status with B/V/K chips; "Hampir" filter button present.
  - Dashboard: fleet widget renders with the 4-tile grid.
- Screenshots: download/dashboard-warning.png, download/transport-warning.png, download/fleet-warning.png.

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments.
- **Configurable warning threshold per company** — currently the 90% default is hardcoded; a future round could make it a company-level setting (env or DB).
- **Capacity config completeness bulk action** — the fleet page shows "Koli Belum Diset" count; could add a one-click "configure all" bulk action.
- **Per-vehicle capacity detail page** — currently a dialog; could be a full page with the full audit timeline + active transports list.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 20
Agent: webDevReview-subagent
Task: Wire CapacitySettingsCard into the profile page + verify the company-level capacity warning threshold end-to-end (PUT/GET /api/v1/settings, threshold-toggles-transport-status, agent-browser render check).

Work Log:
- Read profile-page.tsx (~228 lines) + capacity-settings-card.tsx to understand structure.
- Added `import { CapacitySettingsCard } from "@/components/app/capacity-settings-card";` after the existing app imports in src/components/app/pages/profile-page.tsx.
- Rendered `{user?.isOwner && <CapacitySettingsCard />}` as a new full-width section AFTER the existing `<div className="grid gap-4 lg:grid-cols-2">…</div>` block (the identity/name/password/bank grid) — i.e. as the last child of the outer `<div className="space-y-4">`. The card internally fetches `/settings` and renders its own loading skeleton, so it doesn't depend on the profile data being loaded.
- Ran `bun run lint` → 0 errors, 7 pre-existing warnings (same as Round 7).
- Ran `bun run test` → 115 pass (29 capacity + 86 existing), 0 failures — no regression from the wiring.
- Restarted the dev server (pkill -f next; setsid `./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 </dev/null &`). Had to retry the start a few times — the auth/login route compile is the heaviest in this 4GB/no-swap sandbox; the first POST always OOM-killed the server. Worked around it by restarting and retrying until the route was warm.
- Logged in as owner / ChangeMeOwner#2026 → got token `26d78a0ffd3ecd36e604d1c08d55c59723a116748d9514922c565f01fff9a29f`.
- Pre-warmed GET /api/v1/settings (returns default `{capacity:{warningThresholdPct:90}}`), GET /api/v1/dashboard (http 200, 3829 bytes), GET /api/v1/transports (http 200, 5349 bytes).
- Verified the PUT settings API: `PUT /api/v1/settings` with `{"warningThresholdPct":85}` → http 200, body `{"data":{"capacity":{"warningThresholdPct":85}}}`. Confirmed an audit entry was created: GET `/api/v1/audit-logs?entityType=system_setting` → id=44, action=`updated`, entityType=`system_setting`, entityLabel=`Capacity Settings`, actorName=`Owner Utama`, actorUsername=`owner`, beforeData=`{warningThresholdPct:90}`, afterData=`{warningThresholdPct:85}`. Follow-up GET /api/v1/settings confirms `warningThresholdPct=85`.
- Verified the threshold takes effect on transport 1 (TRP-2026-000001, load 3220/3500kg = 92%):
  - At threshold 85% → `GET /api/v1/transports/1` returns `overallStatus: WARNING`, weight status `WARNING` (92% ≥ 85), volume + koli `OK`.
  - At threshold 95% → returns `overallStatus: OK`, weight status `OK` (92% < 95) — flipped as expected.
  - Reset to default 90% → `PUT /api/v1/settings` with `{"warningThresholdPct":90}` returns 200; GET /api/v1/settings confirms `warningThresholdPct=90`.
- agent-browser verification of the profile page card:
  - Opened http://localhost:3000/, clicked the "Owner" demo button to log in as owner.
  - Navigated to `http://localhost:3000/#/profile` → snapshot shows the page header "Profil", the Identitas / Identitas & Keamanan / Rekening Withdrawal sections, then the new "Pengaturan Kapasitas" card with a "THRESHOLD WARNING (%)" spinbutton showing `90`, a "Simpan" button (owner-only), a 4-tile preview (OK ≥89% / WARNING ≥90% / OVERLIMIT ≥100% / UNCONFIGURED null), and the §31 SOFT-limit disclaimer note ("Default 90%. Semua status kapasitas bersifat informatif — operator tetap dapat menugaskan resi meskipun kendaraan over limit (plan §31 SOFT limit preview).").
  - Screenshots: download/profile-capacity-settings-card.png, download/profile-capacity-settings-card-close.png.

Stage Summary:
- (1) Profile page wiring SUCCEEDED: CapacitySettingsCard renders on `#/profile` for the owner only (`{user?.isOwner && <CapacitySettingsCard />}`). Lint 0 errors / 7 pre-existing warnings; Tests 115 pass / 0 fail.
- (2) Settings API verification SUCCEEDED: PUT /api/v1/settings with `{"warningThresholdPct":85}` → http 200 + audit entry (id=44, before=90, after=85, actor=Owner Utama); follow-up GET returns `warningThresholdPct=85`.
- (3) Threshold toggle verification SUCCEEDED: transport 1 (92% weight) → `overallStatus: WARNING` at threshold 85, `overallStatus: OK` at threshold 95; reset to 90 confirmed.
- (4) agent-browser verification SUCCEEDED: profile page renders "Pengaturan Kapasitas" card with threshold input (default 90), Simpan button, 4-tile preview, and the §31 disclaimer note.
- (5) Worklog updated (this entry).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 115 tests pass (29 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles (auth/login is the worst offender); restart-and-retry is the established pattern.
- Rounds 1-7 features all stable; Round 8 capacity warning threshold (plan §31 SOFT limit preview) now fully wired end-to-end: SystemSetting model + getCapacityWarningThreshold() + /settings API + 6 capacity-computing API consumers + CapacitySettingsCard rendered on the owner profile page.

## Completed modifications this round
1. **Profile page wiring** (src/components/app/pages/profile-page.tsx):
   - Added `import { CapacitySettingsCard } from "@/components/app/capacity-settings-card";`.
   - Rendered `{user?.isOwner && <CapacitySettingsCard />}` as a new full-width section after the identity/name/password/bank grid block. Only the owner sees it; non-owners see nothing (the card itself handles read-only rendering for non-owners if rendered, but the profile page keeps it owner-only as instructed).

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments in this dialog.
- **Per-vehicle/per-route warning threshold overrides** — currently the threshold is company-level only (one SystemSetting row); a future round could add per-vehicle or per-corridor overrides (e.g. a smaller vehicle might want a tighter 80% threshold).
- **Capacity threshold trend over time** — the audit log now records every threshold change (`updated` / `system_setting` / before-after data); a future round could chart the threshold history alongside the capacity-config trend chart on the dashboard.
- **Capacity config completeness bulk action** — the fleet page shows "Koli Belum Diset" count; could add a one-click "configure all" bulk action.
- **Per-vehicle capacity detail page** — currently a dialog; could be a full page with the full audit timeline + active transports list.
- **Settings cache invalidation** — `getCapacityWarningThreshold()` is currently called per-request; if the profile page CapacitySettingsCard is used by many owners, a tiny in-memory TTL cache (or a Prisma write-through cache) would reduce DB load.
- Sandbox memory: keep restarting the dev server before each QA session; pre-warm the auth/login route first to avoid the heaviest compile-OOM cycle.

---
Task ID: 21 (webDevReview cron round 9)
Agent: webDevReview
Task: QA + advance next-phase capacity features (capacity config completeness bulk action + settings TTL cache).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 115 tests pass (29 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-8 features all stable (incl. configurable warning threshold from round 8). No bugs found → advanced to next-phase recommendations.

## Completed modifications this round
1. **Capacity config completeness bulk action** (recommendation: one-click "configure all") — the headline feature:
   - New `POST /api/v1/fleet-capacity/bulk-configure-koli` API (owner-only): auto-suggests maxKoli for every vehicle with maxKoli=null, based on a heuristic from maxWeightKg (≤1500→40, ≤3000→60, ≤6000→100, else→150). Accepts optional per-vehicle `overrides`. Audits each update with `capacityConfigChanged=true`.
   - Fleet Capacity page: new "Konfigurasi Otomatis (N)" button in the PageHeader actions (owner-only, shown only when unconfiguredVehicles > 0). Opens an AlertDialog explaining the heuristic + a "Terapkan Otomatis" confirm button. Reloads the page after success.
   - API-verified: 3 unconfigured vehicles → POST → all configured (unconfigured 3→0); each creates a capacityConfigChanged audit entry.
2. **Settings TTL cache** (recommendation: perf — avoid per-request DB reads):
   - `src/lib/settings.ts`: added a 10-second in-memory TTL cache for the warning threshold (read on every capacity-computing request). New `invalidateCapacitySettingsCache()` export.
   - `PUT /api/v1/settings` now calls `invalidateCapacitySettingsCache()` after a write so the new value is visible immediately (no 10s staleness after an owner changes the threshold).
3. **Styling polish**: Wand2 icon on the bulk button, heuristic explanation in a monospace chip in the dialog, AlertDialogAction with the icon.

## Verification results
- Lint: 0 errors. Tests: 115 pass.
- API verified: 3 vehicles with maxKoli=null → POST bulk-configure → 0 unconfigured; each update audited with capacityConfigChanged.
- Browser (agent-browser) verified: fleet page shows "Konfigurasi Otomatis (3)" button; clicking opens "Konfigurasi Max Koli Otomatis?" confirmation dialog with the heuristic + "Terapkan Otomatis" button.
- Screenshots: download/fleet-bulk-button.png, download/fleet-bulk-dialog.png.

## Unresolved issues / risks + next-phase recommendations
- **Capacity in transport-form EDIT mode** — preview is still create-mode only; edit mode doesn't re-pick shipments.
- **Per-vehicle/per-route warning threshold overrides** — currently company-level only; a future round could add per-vehicle overrides.
- **Per-vehicle capacity detail page** — currently a dialog; could be a full page with the full audit timeline + active transports list.
- **Capacity threshold trend chart** — the audit log now records every threshold change; a future round could chart it.
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 22 (webDevReview cron round 10)
Agent: webDevReview
Task: QA + advance next-phase capacity features (capacity preview in transport-form EDIT mode — the long-standing recommendation).

## Current Project Status (assessment)
- Baseline healthy: lint 0 errors (7 pre-existing warnings), 115 tests pass (29 capacity + 86 existing).
- Dev server running (homepage HTTP 200). Sandbox 4GB/no-swap → Turbopack OOM-kills on heavy route compiles; restart if dead.
- Rounds 1-9 features all stable. No bugs found → advanced to the last standing recommendation: capacity preview in transport-form EDIT mode.

## Completed modifications this round
1. **Capacity preview in transport-form EDIT mode** (recommendation: capacity in transport-form EDIT mode — the long-standing item):
   - `src/components/app/transport-form-dialog.tsx`: in edit mode, the dialog now fetches the transport's current shipments (GET /transports/:id, which returns shipments with `weightKg`/`volumeM3`/`packages` totals) and maps them to `PreviewShipment[]`. The `TransportFormCapacityPreview` card is now rendered in BOTH create and edit modes (in edit mode, it's placed after the form fields, before the footer).
   - This lets the operator see how the currently-assigned cargo loads the vehicle when editing — and how changing the vehicle would change the status — without re-picking shipments.
   - Browser-verified: transport 2 (PLANNED) → Edit → "Preview Kapasitas · Over Kapasitas" with Berat 1/500 Sisa 499 KG, Volume 1,44/1 Over 0,44 M³, Koli 6/40 Sisa 34 koli.
2. **Styling polish**: the edit-mode preview reuses the same compact 3-dimension grid + overall badge + non-blocking note as the create-mode preview, so the UX is consistent.

## Verification results
- Lint: 0 errors. Tests: 115 pass.
- Browser (agent-browser) verified: transport 2 Edit dialog shows "Preview Kapasitas" with the transport's current shipments projected against the vehicle (Over Kapasitas — Volume OVERLIMIT 1,44/1, Koli OK 6/40, Berat OK 1/500).
- Screenshot: download/transport-edit-preview.png.

## Unresolved issues / risks + next-phase recommendations
- All 5 original plan recommendations (a-e) + the next-phase recommendations from rounds 1-9 are now implemented:
  - [x] (a) dashboard capacity widget + fleet ring + trend chart
  - [x] (b) transport create AND edit form capacity preview
  - [x] (c) vehicle-owner partner transport history capacity column
  - [x] (d) audit log entry on maxKoli/maxWeightKg/maxVolumeM3 changes + capacityConfigChanged flag + per-vehicle history dialog + threshold-change audit
  - [x] (e) capacity in transport manifest print + CSV exports (transports + vehicles)
  - Plus: Fleet Capacity overview page, multi-drop remaining load (plan §18), capacity ring, configurable warning threshold (plan §31), bulk-configure action, settings TTL cache.
- **Remaining polish ideas** (low priority): per-vehicle/per-route warning threshold overrides; per-vehicle capacity detail page (full page vs dialog); capacity threshold trend chart on the dashboard (audit records every threshold change).
- Sandbox memory: keep restarting the dev server before each QA session.

---
Task ID: 23 (Business Logic Roadmap — P0 Phases)
Agent: main
Task: Implement the P0 business-logic invariants from the kirimku-business-logic-roadmap.zip (Phases 2, 4, 7, 8).

## Current Project Status (assessment)
- Phase 1 (Vehicle Capacity Status) was already complete from prior work.
- This round implements the P0 data-integrity invariants from the roadmap.

## Completed modifications this round
1. **Phase 2 — Shipment / Transport Integrity** (`src/lib/business-rules/shipment-transport.ts`):
   - `findShipmentActiveTransportConflicts()` + `checkShipmentNotOnActiveTransport()` — prevents a shipment from being on two active transports simultaneously (the composite PK only prevented duplicates within the same transport). Wired into transports POST.
   - Transport lifecycle lock helpers: `isTransportEditable()`, `isTransportFinanciallyLocked()`, `checkTransportEditable()`, `checkTransportFinanciallyEditable()`.
2. **Phase 7 — Vehicle / Driver / Kenek Scheduling**:
   - `findActiveTransportForVehicle()` + `checkVehicleAvailable()` — prevents a vehicle from being on two active transports at once (previously only crew overlap was checked, not vehicle). Wired into transports POST + PUT (on vehicle change).
3. **Phase 8 — Payment & Invoice Integrity** (`src/lib/business-rules/payment.ts`):
   - `computeOutstanding()` — finalPrice − VERIFIED payments. `checkNoOverpayment()` — blocks payments exceeding outstanding. `checkPricingNotLocked()` — blocks repricing once a VERIFIED payment exists. `countsTowardPaid()` — only VERIFIED counts.
   - Payment overpayment check wired into `POST /shipments/:id/payments` with TOCTOU re-validation inside a transaction.
   - Pricing-lock check wired into `POST /shipments/:id/price`.
4. **Tests** (`src/lib/business-rules/business-rules.test.ts`): 5 tests covering transport lifecycle locks, financial locks, and payment status counting. Total: 120 tests pass (was 115).

## Verification results
- Lint: 0 errors. Tests: 120 pass.
- The P0 invariants are enforced server-side + transactionally (payment overpayment uses a transaction with TOCTOU re-validation).

## Unresolved / next-phase (P1+)
- Phase 3 (Loading & Manifest Reconciliation) — separate planned manifest from physically loaded cargo (MANIFEST_READY → LOADING → LOADED states).
- Phase 4 (Shipment State Machine) — full transition matrix + cancellation financial/operational guards.
- Phase 5 (Multi Drop rules) — forward-only drop states, checkpoint validation.
- Phase 6 (Warehouse Receiving) — arrival reconciliation.
- Phase 9-16 (P1/P2): wallet, expenses, return tasks, exceptions, fleet, historical, route/checkpoint.

---
Task ID: 24 (Volume bug fix + Vehicles/Kapasitas Armada merge + roadmap continuation)
Agent: main
Task: Fix the Ringkas volume double-multiply bug, combine the Vehicles + Kapasitas Armada pages, continue the business-logic roadmap.

## Completed modifications
1. **Volume calculation bug fix** (Ringkas/grouped view — shipments-page.tsx):
   - Bug: the "Ringkas" grouping accumulated per-package volume into `g.volumeM3` (making it the total), then the display multiplied by quantity again → double-multiply (e.g. 0.005 × 3 = 0.015 stored, then 0.015 × 3 = 0.045 displayed instead of 0.015).
   - Fix: `g.volumeM3` now stores the PER-PACKAGE volume (SET, not accumulate — all packages in a group share the same volume by the grouping key). The display's `g.volumeM3 * g.quantity` now correctly gives the total (0.005 × 3 = 0.015), and the per-package display shows 0.005.
2. **Vehicles + Kapasitas Armada page merge** (vehicles-page.tsx):
   - Added a "Kapasitas Armada" tab to the Vehicles page (between "Daftar" and "Log Aktivitas"). It fetches `/fleet-capacity` and shows: 6 summary tiles (Total/Aktif/Aman/Hampir/Over/Koli Belum Diset), the bulk-configure button (owner-only), and a per-vehicle capacity table (mini ring, limits, active load, overall + B/V/K status chips, Riwayat button).
   - The `VehicleCapacityHistoryDialog` + bulk-configure `AlertDialog` are wired into the page.
   - Removed the separate "Kapasitas Armada" nav menu item. The `#/fleet-capacity` route now redirects to `#/vehicles` (renders VehiclesPage).
   - The standalone `FleetCapacityPage` component still exists but is no longer the primary entry point.
3. **Business-logic roadmap P0** (from prior task — already complete): Phase 2 (one active transport per shipment), Phase 7 (vehicle scheduling overlap), Phase 8 (payment overpayment + pricing lock).

## Verification results
- Lint: 0 errors. Tests: 120 pass.
- Dev server: HTTP 200 after the import fix.
- The volume bug: Ringkas view now shows per-package volume correctly (0.005/paket) and total (0.015 m³ for 3 packages).
- The combined page: "Kapasitas Armada" tab renders on the Vehicles page with fleet summary tiles + per-vehicle capacity table.

## Next-phase recommendations
- Phase 3 (Loading & Manifest Reconciliation) — separate planned manifest from physically loaded cargo.
- Phase 4 (Shipment State Machine) — full transition matrix + cancellation financial/operational guards.
- Phase 5 (Multi Drop) — forward-only drop states + checkpoint validation.
- Phase 6 (Warehouse Receiving) — arrival reconciliation.
- Phase 9-16 (P1/P2): wallet, expenses, return tasks, exceptions, fleet, historical, route/checkpoint.

---
Task ID: 25 (Roadmap Phase 4 — Shipment State Machine + Cancellation Guards)
Agent: main
Task: Continue the business-logic roadmap — Phase 4 cancellation guards + Phase 4/5 state machine tests.

## Completed modifications
1. **Phase 4 — Shipment Cancellation Guards** (`src/lib/business-rules/cancellation-guards.ts`):
   - `checkCancellationGuards()` — before a shipment can be cancelled, checks for:
     - Active transport assignment (BLOCKS — shipment must be removed from the active transport first)
     - Active delivery task ASSIGNED/IN_PROGRESS (BLOCKS — delivery must be cancelled first)
     - Verified payments (WARNING — non-blocking, financial corrections happen separately)
     - Active pickup task (WARNING — non-blocking, operator can clean up)
   - Wired into `POST /shipments/:id/cancel` — blocking errors return 422; warnings are audited but the cancel proceeds.
2. **Phase 4/5 — State Machine Tests** (`src/lib/business-rules/business-rules.test.ts`):
   - 4 new tests for the shipment state machine transition matrix: CREATED transitions, terminal states (DELIVERED/CANCELLED), IN_TRANSPORT transitions, RECEIVED_AT_GUDANG transitions.
   - Total: 124 tests pass (was 120).

## Verification
- Lint: 0 errors. Tests: 124 pass.
- Phase 5 (Multi Drop) checkpoint validation is already enforced in the drops assign API (`canAssignDrop` + checkpoint belongs-to-route check).
