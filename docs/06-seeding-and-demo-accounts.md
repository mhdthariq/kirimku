# 06 — Seeding & Demo Accounts

## Two-step setup: schema first, seed optional (Revision 6)

| Step | Command | What it does |
|---|---|---|
| 1. **Push schema** | `bun run db:push` | Creates / syncs every table, index, and relation declared in `prisma/schema.prisma`. **Required** before the app can store anything. |
| 2. **Seed demo data** *(optional)* | `bun run db:seed` | Idempotently inserts the mock-up dataset: demo accounts, gudang, vehicles, routes, tariffs, shipments, invoices, etc. |
| 3. **Run the app** | `bun run dev` | Starts the Next.js dev server on `http://localhost:3000`. |

> **Revision 6 (new behaviour).** The app **no longer auto-seeds on the first
> API request**. The previous flow mixed two concerns (schema sync + demo
> dataset) and made it impossible to test a truly empty database. The seeder
> is now an explicit, opt-in CLI step.

To restore the old "migrate + seed on boot" Docker behaviour — useful when
running inside a container where you can't SSH in to run `db:seed` manually
— set the env var `AUTO_SEED_ON_BOOT=true`. With it set, a fresh
`db:push` followed by the first API request will trigger `ensureSeed()`
exactly once per default tenant. **Production / multi-tenant databases are
NEVER auto-seeded**, even with the flag set — the auto-seed only runs for
the default (local-dev) tenant.

The seeder is fully idempotent: every insert is an upsert or existence
check, so running it on an already-seeded database is a no-op except for
printing the summary.

## What gets created

### Accounts (8 users)

| Username | Password | Role | Position |
|---|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner (full access) | Owner |
| `siti` | `Demo#Pass2026` | Admin Kantor | Admin Kantor (Gudang Medan) |
| `budi` | `Demo#Pass2026` | Marketing | Marketing (Gudang Medan) |
| `agus` | `Demo#Pass2026` | Admin Gudang | Admin Gudang (Gudang Medan) |
| `ratna` | `Demo#Pass2026` | Admin Gudang | Admin Gudang (Gudang Lhokseumawe — data isolation demo) |
| `dewi` | `Demo#Pass2026` | Kurir | Kurir (Gudang Medan) |
| `rizky` | `Demo#Pass2026` | Kurir | Kurir (Gudang Medan) |
| `joko` | `Demo#Pass2026` | Driver | Driver (Gudang Medan) |
| `andi` | `Demo#Pass2026` | Kenek | Kenek (Gudang Medan) |
| `wawan` | `Demo#Pass2026` | Staff Gudang | Staff Gudang (Gudang Medan) |
| `hendra` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner (hendra — owns BK 9102 KTA & BK 9455 KTB) |
| `sari` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner (sari — owns BK 7788 KTC) |

Each staff user is linked 1:1 to an `Employee` row (`EMP-000001`…`EMP-000008`), and role assignments are created via `UserRole`. Passwords are hashed with scrypt — the plaintext only exists in this documentation.

### Master data (Sumatra Island — main corridor Medan → Banda Aceh)

- **3 Gudang** — **Medan** (origin hub), **Banda Aceh** (destination hub), **Lhokseumawe** (mid-route branch — demonstrates per-gudang data isolation: ratna only sees LSM-side data).
- **3 Vehicles** — Engkel Box, CDD 6 Ban, Fuso (one `MAINTENANCE`); plates are Sumatran (BK = North Sumatra / Aceh). CDD has a seeded crew assignment (driver Joko + kenek Andi).
- **2 Routes** — `MDN - BNA Aceh Timur` (Medan → Banda Aceh via the east-coast Trans-Sumatran highway, 4 checkpoints) and `MDN - LSM Lintas Sumatera` (Medan → Lhokseumawe, 3 checkpoints). Real lat/long for each checkpoint so the driver dashboard map shows the route.
- **4 Tariffs** — MDN→BNA and MDN→LSM, each in b2b/b2c variants, with configurable volumetric multiplier (250 kg/m³) and prices computed by the real formula.
- **5 Customers** — mix of b2b (PT Maju Bersama Medan, CV Sinar Jaya Lhokseumawe) and b2c.

### Transactional data (8 shipments across the whole lifecycle)

| Shipment | Customer | Status | Priced |
|---|---|---|---|
| `MKT-000001` | Rina Amelia (b2c) | `READY_FOR_PICKUP` | — |
| `MKT-000002` | PT Maju Bersama (b2b) | `PICKED_UP` | B2B Master Resi demo |
| `MKT-000003` | CV Sinar Jaya (b2b) | `RECEIVED_AT_GUDANG` | 60 kg × 5.500 |
| `MKT-000004` | Tono Susilo (b2c) | `IN_TRANSPORT` | 3 kg × 9.500 |
| `MKT-000005` | PT Maju Bersama (b2b) | `DELIVERED` | 40 kg × 8.000 |
| `MKT-000006` | Sari Indah (b2c) | `CREATED` | — |
| `MKT-000007` | Sari Indah (b2c) | `AT_DEST_GUDANG` | (driver checked in Banda Aceh, awaiting Admin Gudang scan) |
| `MKT-000008` | PT Maju Bersama (b2b) | `READY_FOR_PICKUP` | B2B Master Resi demo (8 cartons, single scan suffices) |

Plus: 8 detail items, tracking events matching each lifecycle position, 4 pickups (completed), 1 completed delivery with proof, 1 `DEPARTED` transport carrying MKT-000004, 4 payments in various states (`RECORDED`/`VERIFIED`), 1 `SENT` invoice (PT Maju Bersama, 2 lines), and 12–16 audit log entries across modules.

**QR-scan demo tasks (open, assigned to kurir `rizky`):**

| Task | Shipment | Status | Purpose |
|---|---|---|---|
| `PICK-2026-000001` | `MKT-000001` (b2c, READY_FOR_PICKUP) | `ASSIGNED` | Login as **rizky** → Pickups → "Proses / Scan QR" → scan each package QR code shown on the shipment → confirm → tracking shows **"Picked-up by Rizky Hidayat"** |
| `PICK-2026-000008` | `MKT-000008` (b2b, READY_FOR_PICKUP) | `ASSIGNED` | **B2B Master Resi demo** — login as **rizky** → Pickups → "Proses / Scan QR" → scan the **Master Resi ONCE** (`MKT-000008`) and all 8 packages are automatically marked scanned → confirm |
| `DLV-2026-000002` | `MKT-000003` (b2b, RECEIVED_AT_GUDANG) | `ASSIGNED` | **B2B Master Resi demo** — Deliveries as rizky → "Antar / Scan QR" → scan the Master Resi once → all packages auto-scanned → PoD → DELIVERED |

The kurir role template ships with `pickup.scan` / `delivery.scan` / `pickup.confirm` / `delivery.confirm` — and the owner can adjust any role's capabilities in Access Control → Roles without creating a new role.

The dataset is deliberately **cross-linked**: e.g. the transport references the seeded route/vehicle/crew, the invoice lines reference real shipment codes — so every page has something meaningful to show the moment you log in.

## Reset & customize

**Reset to a fresh seeded state (SQLite):**

```bash
rm db/custom.db
bun run db:push     # step 1 — create schema
bun run db:seed     # step 2 — populate demo data (optional but recommended for local dev)
bun run dev         # step 3 — start the app
```

**Reset on Supabase:** Dashboard → Database → *Reset database*, then `bun run db:push && bun run db:seed`.

**Run with an empty database (no demo data):**

```bash
rm db/custom.db
bun run db:push     # schema only
bun run dev         # start — login will fail because no users exist yet;
                    # create the first Owner via `bunx prisma studio`
                    # or by inserting into User with isOwner=true.
```

**Change the mock data:** edit `src/lib/seed.ts` (the single source for both the CLI seeder and — when `AUTO_SEED_ON_BOOT=true` — the auto-seed path). Useful spots:

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

## Revision 5 — B2B Master Resi scan + Sumatra Island + Owner Dashboard redesign

### B2B Master Resi scan mode
For B2B shipments, a single scan of the **Master Resi** (master code) satisfies the entire shipment — no need to scan each detail package. The kurir / driver / Admin Gudang can scan the Master Resi once and the system marks every package as scanned, unlocking the confirm button. This applies to:
- Pickup scans (kurir → customer's warehouse)
- Delivery scans (kurir → final receiver)
- Gudang arrival scans (kurir drop-off at the origin gudang)
- Transport arrival scans (driver drop-off at the destination gudang)
- The "Scan All" bulk action (records a single master-level scan instead of N detail scans for B2B)

B2C shipments keep the per-package scan requirement (one QR per detail barang). The scan progress API returns `isB2B` and `masterScanned` flags so the UI can show a different progress display ("Scan the Master Resi" vs. "Scan each package").

### Owner Dashboard redesign
The owner now sees the dashboard with two priorities:
1. **Approval Queue** (top of page) — items the owner must act on FIRST:
   - Pending Top Up verifications (`PENDING_VERIFICATION` — topup with proof attached)
   - Pending Withdrawal approvals (`PENDING` — partner requests)
   - Pending Payment verifications (`RECORDED` — payments awaiting verification)
   - Pending Marketing Commissions (PENDING — informational, released when invoice settles)
2. **Operational info** (below) — same data as before but filtered by a **date period filter** (calendar) identical to the Kurir & Driver dashboards:
   - Shipment status funnel (period-filtered)
   - Revenue verified (period-filtered)
   - Recent shipments (period-filtered)
   - Recent audit log (period-filtered)
   - Stat cards (counts in period)

The approval queue is permission-gated: only users with `wallet.topup.verify`, `wallet.withdrawal.approve`, `payment.verify`, or `invoice.send` (or owner) see the relevant items.

### Sumatra Island demo dataset
The seeder no longer uses Java locations. All demo data is now Sumatran:
- Gudang: **Medan**, **Banda Aceh**, **Lhokseumawe** (mid-route branch)
- Routes: **MDN → BNA Aceh Timur** (Medan → Banda Aceh, main corridor) and **MDN → LSM Lintas Sumatera**
- Tariffs: MDN→BNA and MDN→LSM (b2b/b2c variants)
- Vehicle plates: BK (Sumatran)
- Customer addresses updated to Medan / Banda Aceh / Lhokseumawe
- Demo B2B Master Resi scan: **MKT-000008** (PT Maju Bersama, 8 cartons, READY_FOR_PICKUP) is an open task assigned to kurir `rizky`
- Demo B2B arrival scan: **MKT-000002** (PT Maju Bersama, PICKED_UP) sits in the gudang arrival queue — Admin Gudang can scan the Master Resi once to receive all 10 packages

## Revision 6 — owner self-service profile, optional settlement receipt, partial-payment profit rule, explicit db:seed

### Owner can edit their own name & password
The Profile page (top-right menu → **Profile**) now exposes two self-service forms for **every** user — including the Owner:
- **Nama Tampilan** — change the display name
- **Password Saat Ini + Password Baru** — change the password (the current password must be typed to confirm)

The `/users/{id}` admin endpoint still guards the Owner row (`Akun Owner tidak bisa diubah dari UI`), because that path is for managing OTHER users. The new `PUT /api/v1/profile` endpoint only ever touches the caller's own row, so the Owner is no longer blocked from updating their own identity.

### Optional receipt upload on invoice settlement
The Settle dialog on the Invoice page now has an **optional** "Bukti Pembayaran" file picker (image or PDF, max 8 MB). The receipt is stored on the `InvoiceSettlement.proofUrl` column (new) and shown as a clickable "Bukti" chip in the Riwayat Settlement list inside the invoice detail dialog. The Finance Dashboard's invoice-payment table also shows a "Bukti" badge when a settlement has a receipt attached.

### Partial invoice payments = company profit (clarified)
A new "Profit dari Pembayaran Invoice" section was added to the Finance Dashboard, visible only to `financial.report.view` holders (Admin Kantor + Owner). It explicitly states that **every Rupiah received against a B2B invoice — whether the invoice ends up FULLY SETTLED or stays PARTIALLY_SETTLED — is realized company profit at the moment it is received**, because:
1. The company owns the invoice (§2).
2. The Marketing partner is owed nothing until the invoice is fully paid (§9 — commission stays PENDING and is only released on SETTLED).
3. Partial payments therefore sit in the company's bank with no offsetting partner liability.

The section shows: total realized invoice payments, the split between SETTLED and PARTIALLY_SETTLED, the latest 8 settlement rows (with proof badge), and the per-month timeline. The `/api/v1/finance/summary` response now exposes `totals.realizedInvoicePayments / settledInvoicePayments / partialInvoicePayments` plus a full `invoicePayments` block.

### Explicit db:push and db:seed separation
- A `db:seed` script was added to `package.json` (it runs `prisma/seed.ts` via Bun).
- The auto-seed-on-first-API-request behaviour was made opt-in via the `AUTO_SEED_ON_BOOT=true` env var (default off). RBAC bootstrapping is still always run.
- Production tenants are never auto-seeded, regardless of the flag.


