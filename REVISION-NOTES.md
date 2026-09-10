# Revision Notes — Spec "Shipment Management System — Revision & Fix Specification" (Parts A–AC)

All items from the revision spec are implemented and verified end-to-end
(API test suite + browser QC at 1920×1080 / 1366×768 / 768×1024 / 390×844).
`bun run lint` passes with 0 errors / 0 warnings.

Demo data was reset to the freshly-seeded state before packaging.

---

## 1. Pickup lifecycle (Part A)

- `POST /pickups/{id}/confirm` now sets the pickup to **PICKED_UP**
  (previously it wrongly jumped straight to COMPLETED).
- A pickup only becomes **COMPLETED** when its packages physically arrive at
  the gudang (`POST /shipments/{id}/arrive` completes them).
- Pickup scans no longer set `IN_PROGRESS` on the master shipment.
- Pickups in `PICKED_UP` can no longer be cancelled.
- Seed data + all UI labels/status badges updated to the corrected lifecycle.

## 2. Checkpoint map editor rebuild (Parts B, C, D, E, F, G, H, AA)

- New bulk endpoint `PUT /routes/{id}/checkpoints`: transactional
  create/update/delete of removed points + resequencing + server-side
  validation (≥ 3 checkpoints per route) — the old per-checkpoint save
  architecture is gone.
- `CheckpointMapEditor` rebuilt around a single draft collection:
  - **"Tambah Checkpoint"** uses the exact same editor form as editing an
    existing point (no more state loss when adding while editing).
  - Existing checkpoints are **preserved** on save (verified: 3 + 2 new → 5).
- Routes page gains a main **"Simpan Semua Checkpoint"** action with dirty
  tracking + reset.
- **Radius in KM** (not meters) with circle visualization on the map.
- **Zoom controls moved to bottom-left** of the map.
- Checkpoint status badge fixed so it **no longer overlaps the navbar** after
  scrolling (relative isolate + z-10 inside an isolated wrapper).
- **Default map center = Medan / North Sumatra.**

## 3. Transport planning, detail & aggregates (Parts I, J, K, L, M, N)

- Schema: `Transport` gains origin/destination warehouses, route, vehicle,
  driver, kenek, `plannedDepartureAt` / `plannedArrivalAt`, and live
  `currentLat` / `currentLng`; `CheckpointRecord` gains `photoUrl` and
  `distanceMeters`; new indexes.
- `POST/PUT /transports` accept the full planning fields.
- `GET /transports` (list) and `GET /transports/{id}` (detail) return
  **DB-aggregated totals**: berat (Σ chargeableWeightKg), volume (kubikasi
  per detail, grouped), price (Σ priceAmount), and package counts.
- Transport menu icon now matches the road/linehaul concept.
- Full **Transport detail page**: info card, current-position map, check-in
  history with photo evidence, loaded shipments table with totals.
- **"Arrived" button removed** — arrival is now detected automatically when
  the crew checks in at the final checkpoint of the route.

## 4. Checkpoint selfie check-in (Part O)

- `POST /transports/{id}/checkins`:
  - crew-only (driver/kenek of that transport) authorization,
  - **compressed photo required** (evidence),
  - **server-side Haversine radius validation** — out-of-radius check-ins are
    rejected 422 with a clear KM-distance message,
  - server timestamps, duplicate guard, updates the transport's live
    position, and auto-arrives at the final checkpoint.
- New `CheckpointCheckinDialog`: camera via `getUserMedia` with file-upload
  fallback, GPS position, and live distance preview before submitting.

## 5. Role dashboards & navigation (Parts P–X)

- `GET /dashboard/kurir` and `GET /dashboard/driver`: own-data-only with
  period filters (default: today).
- **Kurir dashboard**: simplified counters + date filter.
- **Driver dashboard**: operational view (assigned transports, check-in
  status) + date filter — both with a calendar-based `DatePeriodFilter`.
- Role-aware router; operational navs:
  - Kurir → Dashboard, Pickups, Delivery
  - Driver/Kenek → Dashboard, Transport, Transport History (+ detail page)
- **Mobile bottom navigation** for operational roles (3 items, no hamburger).

## 6. Server-enforced authorization (Parts Y, Z)

- Executor-only users (driver/kenek) see **only transports they are assigned
  to** — list and detail (403 otherwise).
- Kurir always query their own pickups/deliveries (`?mine=true` enforced
  server-side).
- Bulk checkpoint save, transport create/delete and check-in run inside DB
  transactions.
- Login resets the hash route to `#/dashboard`.

## 7. Gudang data separation (spec follow-up round)

- Every karyawan belongs to one gudang (`Employee.warehouseId`) — see the
  top section of `CHANGES.md` for the full breakdown: per-gudang data
  scoping on all list APIs, 403 on cross-gudang shipment access, owner
  per-gudang tabs, gudang-scoped dashboards/audit logs, and the `ratna`
  demo account (Admin Gudang · Bandung) to try the isolation live.

---

## Demo accounts (after `bun run db:push && bun run db:seed`)

| Username | Password | Role |
|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner (sees everything) |
| `dewi` / `rizky` | `Demo#Pass2026` | Kurir |
| `joko` | `Demo#Pass2026` | Driver |
| `andi` | `Demo#Pass2026` | Kenek |
| `ratna` | `Demo#Pass2026` | Admin Gudang (Bandung) |

## Running locally

```bash
bun install
cp .env.example .env        # (a ready SQLite .env is already included)
bun run db:push             # create db/custom.db
bun run db:seed             # demo data
bun run dev                 # http://localhost:3000
```

Utilities in `scripts/`:

- `reset-full.ts` / `final-reset.ts` — reset demo data to seeded state
- `test-revision-api.sh` — E2E API suite for all revision items above
