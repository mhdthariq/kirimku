# 06 — Seeding & Demo Accounts

## Two seeding paths (both idempotent)

| Path | When it runs | How |
|---|---|---|
| **Auto-seed** | On the **first API request** after a fresh database | `ensureSeed()` is invoked by the API layer (`src/lib/api-helpers.ts`) — mirrors a Docker "migrate + seed on boot" entrypoint |
| **CLI seed** | Manually / in CI | `bun run db:seed` → `prisma/seed.ts` → the same `ensureSeed()` routine |

Both are safe to run repeatedly: every insert is an upsert or existence check. Running the seeder on an already-seeded database does nothing except print the summary.

## What gets created

### Accounts (8 users)

| Username | Password | Role | Position |
|---|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner (full access) | Owner |
| `siti` | `Demo#Pass2026` | Admin Kantor | Admin Kantor |
| `budi` | `Demo#Pass2026` | Marketing | Marketing |
| `agus` | `Demo#Pass2026` | Admin Gudang | Admin Gudang |
| `dewi` | `Demo#Pass2026` | Kurir | Kurir |
| `rizky` | `Demo#Pass2026` | Kurir | Kurir |
| `joko` | `Demo#Pass2026` | Driver | Driver |
| `andi` | `Demo#Pass2026` | Kenek | Kenek |

Each staff user is linked 1:1 to an `Employee` row (`EMP-000001`…`EMP-000008`), and role assignments are created via `UserRole`. Passwords are hashed with scrypt — the plaintext only exists in this documentation.

### Master data

- **3 Gudang** — Jakarta Pusat, Bandung, Surabaya (with real coordinates for the map).
- **3 Vehicles** — Engkel Box, CDD 6 Ban, Fuso (one `MAINTENANCE`); CDD has a seeded crew assignment (driver Joko + kenek Andi).
- **2 Routes** — JKT–BDG (Tol Cipularang) and JKT–SBY (Pantura), each with **3 checkpoints** (start gudang, rest area, end gudang) with radii.
- **4 Tariffs** — JKT→BDG and JKT→SBY, each in b2b/b2c variants, with configurable volumetric multipliers (250 kg/m³ Bandung, 300 kg/m³ Surabaya) and prices computed by the real formula (e.g. MKT-000002 "Karton Tulis" ×10 → 25 kg → Rp112.500).
- **5 Customers** — mix of b2b (PT Maju Bersama, CV Sinar Jaya) and b2c.

### Transactional data (6 shipments across the whole lifecycle)

| Shipment | Customer | Status | Priced |
|---|---|---|---|
| `MKT-000001` | Rina Amelia (b2c) | `READY_FOR_PICKUP` | — |
| `MKT-000002` | PT Maju Bersama (b2b) | `PICKED_UP` | 25 kg × 4.500 |
| `MKT-000003` | CV Sinar Jaya (b2b) | `RECEIVED_AT_GUDANG` | 60 kg × 7.500 |
| `MKT-000004` | Tono Susilo (b2c) | `IN_TRANSPORT` | 3 kg × 8.500 |
| `MKT-000005` | PT Maju Bersama (b2b) | `DELIVERED` | 40 kg × 4.500 |
| `MKT-000006` | Sari Indah (b2c) | `CREATED` | — |

Plus: 8 detail items, tracking events matching each lifecycle position, 4 pickups (completed), 1 completed delivery with proof, 1 `DEPARTED` transport carrying MKT-000004, 4 payments in various states (`RECORDED`/`VERIFIED`), 1 `SENT` invoice (PT Maju Bersama, 2 lines), and 12–16 audit log entries across modules.

**QR-scan demo tasks (open, assigned to kurir `rizky`):**

| Task | Shipment | Status | Purpose |
|---|---|---|---|
| `PICK-2026-000001` | `MKT-000001` (READY_FOR_PICKUP) | `ASSIGNED` | Login as **rizky** → Pickups shows only this task → "Proses / Scan QR" → scan `DTL-000001-01`, `DTL-000001-02` → confirm → tracking shows **"Picked-up by Rizky Hidayat"** |
| `DLV-2026-000002` | `MKT-000003` (RECEIVED_AT_GUDANG) | `ASSIGNED` | Deliveries as rizky → "Antar / Scan QR" → scan `DTL-000003-01`, `DTL-000003-02` → PoD → DELIVERED |

The kurir role template ships with `pickup.scan` / `delivery.scan` / `pickup.confirm` / `delivery.confirm` — and the owner can adjust any role's capabilities in Access Control → Roles without creating a new role.

The dataset is deliberately **cross-linked**: e.g. the transport references the seeded route/vehicle/crew, the invoice lines reference real shipment codes — so every page has something meaningful to show the moment you log in.

## Reset & customize

**Reset to a fresh seeded state (SQLite):**

```bash
rm db/custom.db
bun run db:push     # recreate schema
bun run db:seed     # (optional — first API request also seeds)
```

**Reset on Supabase:** Dashboard → Database → *Reset database*, then `bun run db:push && bun run db:seed`.

**Change the mock data:** edit `src/lib/seed.ts` (the single source for both paths — the CLI file just calls it). Useful spots:

| Want to change | Where |
|---|---|
| Staff accounts / roles | `staff` array at the top |
| Owner credentials | `ownerPassword` / the owner upsert block |
| Gudang list | `gudangDefs` |
| Vehicles | `vehicleDefs` |
| Routes & checkpoints | `routeDefs` (add a 4th checkpoint to see the editor light up) |
| Tariffs / customers | `tariffDefs` / `customerDefs` |
| Shipments & lifecycle coverage | `shipmentDefs` |

After editing, reset the database (above) so the new dataset is created.

> The seeder only runs its "create" blocks when the relevant tables are empty — that's what makes it idempotent. It never overwrites existing rows (except RBAC, which self-heals to match `rbac.ts`).

## RBAC bootstrap note

Before accounts, `ensureSeed()` calls `ensureRbac()`: it upserts the **79 permissions** and **6 system roles** and re-links role→permission rows if the catalog in code has changed. This runs even outside the demo seed (it's also called on API boot), so a production database gets the RBAC catalog without demo data.

## Revision 4 — seeder additions

- **New demo account `wawan` / `Demo#Pass2026`** — Staff Gudang, assigned (`Employee.warehouseId`) to Gudang Jakarta Pusat; role `staff-gudang` with `warehouse.scope_own` (sees only his gudang).
- Every seeded shipment now carries a **Penerima** (name/address/contact) and gudangs carry **customer support contacts** (printed on resi).
- Demo states for the new flows: **MKT-000002** (PICKED_UP, 10 Karton Tulis, DP 60,000 of 112,500) sits in the gudang arrival queue; **MKT-000001** (READY_FOR_PICKUP, priced, DP ≥ 50%) has the open pickup task for kurir `rizky` (scan 4 packages + collect balance on confirm); **MKT-000006** (CREATED, unpriced) is the walk-in candidate.
- Completed pickups/deliveries include seeded scans with mixed methods (mostly SCANNED, some TYPED) so Riwayat Scan demonstrates the differentiation.
- `scripts/reset-demo-db.ts` truncates all tables **in place** (never delete `db/custom.db` while a dev server is holding it open — that causes "readonly database" errors). Re-seed afterwards with `bun run db:seed`.
