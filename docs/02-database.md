# 02 — Database

## Quick facts

- **ORM:** Prisma 6 — schema at `prisma/schema.prisma` (single source of truth)
- **Default engine:** SQLite file at `db/custom.db` (created by `bun run db:push`)
- **Models:** 21
- **PostgreSQL-ready:** the schema uses only `String`, `Int`, `Float`, `Boolean`, `DateTime` — no SQLite-only features, no DB enums, no `Json` — so it runs on **Supabase Postgres unchanged**. See the switch guide at the bottom.

## Model catalog

### Access control

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `Employee` | Staff master data | `employeeNumber @unique`, `position`, 1:1 optional `User` |
| `User` | Login accounts | `username @unique`, `passwordHash` (scrypt), `isOwner` (owner bypasses RBAC = `*`), `isActive` |
| `Role` | Permission bundles | `slug @unique`, `isSystem` (seeded roles can't be deleted via UI) |
| `Permission` | 62 permission slugs | `slug @unique`, grouped by `module` |
| `UserRole` | M:N user ↔ role | composite PK, `onDelete: Cascade` |
| `RolePermission` | M:N role ↔ permission | composite PK, cascade |
| `SessionToken` | Bearer sessions | `token @unique`, `expiresAt` (12 h) |

### Customers & shipments

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `Customer` | Shipper master | `code @unique`, `type` = `"b2b" \| "b2c"` (drives tariff selection + invoice eligibility) |
| `MasterShipment` | The shipment/booking | `masterCode @unique` (`MKT-000NNN`), `resi @unique`, `status` (lifecycle — see `05-business-flows.md`), `origin`/`destination` city names, `tariffId` (tariff selected from the route dropdown — Revision 3), FKs to origin/destination `Warehouse`, `arrivedWarehouseId` (gudang where arrival was confirmed — Revision 4), **Penerima**: `penerimaName`/`penerimaAddress`/`penerimaContact` (printed on both resi types — Revision 4), pricing snapshot: `chargeableWeightKg`, `ratePerKg`, `priceAmount`, `pricedAt` |
| `DetailShipment` | **One row = one physical package** (Revision 3) | `detailCode @unique` (`DTL-…`), `description`, dims `lengthCm/widthCm/heightCm`, `actualWeightKg` — cascade delete with master. No `quantity` column: an input of N packages expands into N rows, each carrying its own QR label |
| `TrackingEvent` | Immutable tracking timeline | `event`, `description`, optional `actorId` (User), `occurredAt` — cascade with master |

### Gudang (warehouses)

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `Warehouse` | Physical warehouse node | `code @unique` (`WH-000NNN`), `name`, `city`, `address`, optional `latitude`/`longitude` (map picker in UI), `customerSupportContact` (printed on Resi Shipment & Resi Detail — Revision 4) |

> Per requirement #9: there is **no `type` column and no separate "Gateway" entity/table** in the rebuilt schema. A gudang is a single kind of physical node; origin/destination linkage on `MasterShipment` covers everything the old split table tried to represent.

### Fleet & routes

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `Vehicle` | Truck fleet | `vehicleNumber @unique` (e.g. `B 9455 KTB`), `status` = `ACTIVE \| MAINTENANCE \| INACTIVE`, `maxWeightKg`, `maxVolumeM3` |
| `VehicleAssignment` | Crew history per vehicle | `vehicleId + driverId + kenekId + validFrom` unique; `validTo` for rotations |
| `Route` | Linehaul route master | `name`, `origin`, `destination`, `isActive` |
| `Checkpoint` | Geo-fence point on a route | `routeId` FK, `sequence` (unique per route), `latitude`, `longitude`, `radiusMeters` (default 100) — **API enforces ≥ 3 checkpoints per route** (`MIN_CHECKPOINTS`) |
| `Transport` | A linehaul trip | `transportCode @unique` (`TRP-YYYY-000NNN`), FKs: `routeId`, `vehicleId`, `driverId`, `kenekId` (→ Employee), `status` = `PLANNED \| DEPARTED \| ARRIVED \| CANCELLED` |
| `TransportShipment` | M:N transport ↔ shipment | composite PK, cascade — which shipments ride which trip |
| `CheckpointRecord` | Check-in evidence | FKs `transportId` + `checkpointId`, actual `latitude/longitude`, `withinRadius` boolean, `recordedBy` (User) |

### Pickup & delivery (first/last mile)

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `Pickup` | Kurir pickup task | `pickupCode @unique` (`PICK-YYYY-…`), FK `masterId`, `kurirId` (→ Employee), `status` = `ASSIGNED \| IN_PROGRESS \| COMPLETED \| CANCELLED` |
| `HandoverScan` | QR scan log at pickup, delivery & gudang-arrival handover | `pickupId?` / `deliveryId?` (one set) or `masterId + context="gudang_arrival"`, `scanLevel` = `master \| detail`, `detailId?` matched package, `payload`, `result` = `ok \| duplicate \| unexpected`, **`method`** = `SCANNED` (camera / reader tool) \| `TYPED` (manual input — Revision 4), `scannedById` |
| `Discrepancy` | Missing/unexpected items | `type` = `MISSING_DETAIL \| UNEXPECTED_PAYLOAD`, `resolvedById/At`, `resolution` |
| `Delivery` | Last-mile delivery task | `deliveryCode @unique` (`DLV-YYYY-…`), `kurirId`, `status` = `ASSIGNED \| COMPLETED \| FAILED`, `proofOfDelivery` text |

### Pricing, payments, invoicing

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `Tariff` | Rate table | `origin` + `destination` + `customerType` (`b2b`/`b2c`, null = all), `ratePerKg`, `minChargeableKg`, `volumetricMultiplier` (kg per m³, default 250 — Revision 3 replaced `volumetricDivisor`), `roundingMode` (`UP`/`NEAREST`), `roundingUnitKg`, `effectiveFrom/To` |
| `Payment` | Shipment payment | `method` = `CASH \| TRANSFER`, `amount`, `status` = `RECORDED \| VERIFIED \| REJECTED`, recorder + verifier users |
| `Invoice` | B2B consolidated bill | `invoiceNumber @unique` (`INV-YYYY-000NNN`), `status` = `DRAFT \| SENT \| PARTIALLY_SETTLED \| SETTLED \| CANCELLED`, `issueDate`, `dueDate` |
| `InvoiceLine` | Line items of an invoice | `description`, `quantity`, `unitPrice` — cascade with invoice |
| `InvoiceSettlement` | Payments against an invoice | `amount`, `method`, `reference`, `settledAt` |

### Audit

| Model | Purpose | Notable fields / rules |
|---|---|---|
| `AuditLog` | Append-only activity trail | `action` (`created/updated/deleted/login/logout/status_change/…`), `entityType` (`customer/shipment/warehouse/vehicle/route/checkpoint/pickup/transport/invoice/tariff/auth/…`), `entityId`, `entityLabel` (human-readable, e.g. `MKT-000002 → PICKED_UP`), `actorId`, optional `beforeData`/`afterData` JSON snapshots |

## Entity relationships (text ERD)

```
Employee 1—1 User *—* Role *—* Permission
                      User 1—* SessionToken

Customer 1—* MasterShipment *—1 Warehouse (origin)
                                  *—1 Warehouse (destination)
MasterShipment 1—* DetailShipment
MasterShipment 1—* TrackingEvent
MasterShipment 1—* Pickup 1—* HandoverScan   (QR detail scans)
MasterShipment 1—* Delivery 1—* HandoverScan  (QR detail scans)
MasterShipment 1—* HandoverScan (context = gudang_arrival — Revision 4)
MasterShipment 1—* Payment
MasterShipment *—* Transport   (via TransportShipment)
Employee *—1 Warehouse (staff gudang scope — Revision 4)

Route 1—* Checkpoint
Route 1—* Transport *—1 Vehicle
Transport *—1 Employee (driver) *—1 Employee (kenek)
Transport 1—* CheckpointRecord *—1 Checkpoint
Vehicle 1—* VehicleAssignment (driver/kenek → Employee)

Customer 1—* Invoice 1—* InvoiceLine
                     1—* InvoiceSettlement

User 1—* AuditLog   (actor)
```

## Indexes & integrity

- All code/number fields are `@unique` (`masterCode`, `resi`, `pickupCode`, `transportCode`, `invoiceNumber`, `employeeNumber`, `vehicleNumber`, …).
- Detail/child records (shipment details, tracking events, pickups, deliveries, payments, invoice lines/settlements) **cascade-delete** with their parent — deleting a shipment cleans the whole paper trail.
- `Checkpoint` has `@@unique([routeId, sequence])` — sequence numbers can't collide inside a route.
- FK actions were chosen so *reference* integrity (e.g. Transport → Vehicle) blocks accidental deletes where children exist.

---

## Switching to Supabase Postgres (step-by-step)

The app ships with SQLite for zero-config local development. To move the database to **Supabase** (or any PostgreSQL), follow these steps — no code rewrite is needed.

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Save the **database password** you choose and the **Project Ref** (found in *Project Settings → General*; it looks like `abcdefghijklmnopqrst`).
3. Note your **region** (e.g. `aws-0-ap-southeast-1`) from *Project Settings → Database → Connection info*.

### 2. Get the connection string

In Supabase Dashboard → **Project Settings → Database → Connection string → URI**, you'll see three flavors (all shown as templates in **`.env.example`**):

| Flavor | Port | Use it for |
|---|---|---|
| **Direct** — `postgres:<pw>@db.<ref>.supabase.co` | 5432 | `prisma db push` / migrations (needs IPv6) |
| **Session pooler** — `postgres.<ref>@aws-0-<region>.pooler.supabase.com` | 5432 | **Recommended**: CLI **and** long-running app servers (IPv4-friendly) |
| **Transaction pooler** — same host | 6543 | Serverless runtime only (Vercel/Edge); **not** valid for `db push` |

### 3. Flip the Prisma provider (one line)

Edit `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

### 4. Set `DATABASE_URL` in `.env`

```bash
cp .env.example .env        # if you don't have .env yet
```

Then comment out the SQLite line and use the **session pooler** (recommended — works for both CLI and runtime):

```bash
DATABASE_URL="postgresql://postgres.YOUR-REF:YOUR-PASSWORD@aws-0-YOUR-REGION.pooler.supabase.com:5432/postgres?sslmode=require"
```

> `sslmode=require` is mandatory — Supabase rejects unencrypted connections.
> URLs with special characters in the password must be percent-encoded (e.g. `#` → `%23`).

### 5. Push the schema and re-seed

```bash
bun install                 # regenerate Prisma client for postgres
bun run db:push             # creates all 21 tables in Supabase
bun run db:seed             # loads the mock-up dataset (idempotent)
bun run dev
```

`db push` handles the full schema — 21 tables, unique indexes, FK cascades. No manual SQL is required.

### 6. Optional: the official two-URL setup

If you deploy the app to a serverless platform, Prisma recommends separating runtime and migration URLs. Add to the datasource block:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")       // transaction pooler (6543) at runtime
  directUrl = env("DIRECT_URL")         // direct/session (5432) for db push
}
```

…then in `.env` set `DATABASE_URL` to the transaction pooler and `DIRECT_URL` to the direct connection (both templates exist in `.env.example`).

### 7. Verify

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","password":"ChangeMeOwner#2026"}'
```

A response containing `"token"` means the Supabase database is live and seeded.

### Moving existing SQLite data (optional)

`db:seed` gives you a fresh demo dataset. If you have **real rows** in `db/custom.db` you want to keep, use Prisma's introspection-free approach: run both clients side by side (`bunx prisma studio` against each URL) and export/import per table, or a generic tool like `sqlite3 → csv → Supabase import`. For the mock-up dataset this is unnecessary — the seeder reproduces everything.

### Production-grade tweaks worth doing on Postgres

| Concern | SQLite (mock) | Postgres (production) |
|---|---|---|
| Money precision | `Float` | `Decimal @db.Decimal(65,2)` on `priceAmount`, `amount`, `ratePerKg`, `unitPrice` |
| Status safety | validated `String` | optionally `@default` + check constraints, or keep app-level validation |
| Sessions cleanup | none | periodic delete of expired `SessionToken` rows (cron) |
| Connection pooling | n/a | Supabase pooler (already handled above) |
| Backups | copy the .db file | Supabase daily backups / PITR |

---

## Day-to-day commands

| Command | What it does |
|---|---|
| `bun run db:push` | Sync `schema.prisma` → database (creates/alters tables; SQLite file auto-created) |
| `bun run db:seed` | Idempotent mock-up seeder (CLI entry) |
| `bun run db:generate` | Regenerate the Prisma client after schema edits |
| `bunx prisma studio` | Visual DB browser at `http://localhost:5555` |
| `bunx prisma validate` | Lint the schema file |
| `bunx prisma migrate diff` | Inspect what `db push` would change |

**Reset everything (SQLite):** delete `db/custom.db` → `bun run db:push` → `bun run db:seed`.
**Reset everything (Supabase):** Supabase Dashboard → Database → Reset database, then re-run push + seed.

### Revision 4 — schema additions

- `MasterShipment`: `penerimaName` / `penerimaAddress` / `penerimaContact` (recipient — printed on resi), `arrivedWarehouseId` (gudang that confirmed the arrival)
- `Warehouse.customerSupportContact` — CS phone printed on Resi Shipment & Resi Detail
- `Employee.warehouseId` — staff gudang assignment; combined with the `warehouse.scope_own` permission it scopes roles below Admin Gudang to their own gudang (new `staff-gudang` system role)
- `HandoverScan`: `method` (`SCANNED` \| `TYPED`), `context` (`pickup` \| `delivery` \| `gudang_arrival`), `masterId` (for gudang-arrival scans)
- Status flow: `CREATED`/`READY_FOR_PICKUP` → `RECEIVED_AT_GUDANG` direct transitions added (walk-in arrivals)
