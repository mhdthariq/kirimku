# Project Documentation — Shipment & Logistics Management System

This folder explains **everything that was built**: the architecture, the database, the API, the frontend, the business flows, the mock-up seeder, and how to run & deploy the app.

> For a quick start (install → seed → run), read the root **`README.md`**.
> To switch the database from SQLite to **Supabase Postgres**, see **`docs/02-database.md`** and **`.env.example`**.

---

## What is this system?

A complete rebuild of a legacy Laravel + separate-frontend shipment management app into **one modern fullstack Next.js application**. It manages the full logistics chain: customers request shipments → kurir picks them up → goods are consolidated in a gudang (warehouse) → linehaul transports move them along routes with geo-checkpoints → last-mile deliveries complete the journey → payments, invoices, and audit logs close the loop.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma ORM (SQLite default, PostgreSQL-ready) · API Routes (`/api/v1`) · Leaflet maps · Recharts.

## The 10 original requirements → where they live

| # | Requirement | Where it is implemented |
|---|---|---|
| 1 | Responsive on laptop / desktop / tablet / phone | `src/components/app-shell.tsx` + per-page card layouts (see `04-frontend.md`) |
| 2 | Light & dark mode | `next-themes` + emerald design tokens in `src/app/globals.css` |
| 3 | Logo top-left (mock-up) | `public/logo.svg`, rendered in sidebar & login page |
| 4 | Missing CRUD buttons (Pickups, Deliveries, Tariffs, Invoices) | All four pages have full Dialog-based CRUD (`src/components/pages/`) |
| 5 | Modern, high-standard UI/UX | Design system + AppShell + shadcn/ui components throughout |
| 6 | "Add" button opens a modal form (no inline table forms) | Every module uses `Dialog` forms + `AlertDialog` delete confirms |
| 7 | Per-menu audit logs (in addition to global timeline) | Every page has a "Log Aktivitas" tab; API: `GET /api/v1/audit-logs?entityType=…` |
| 8 | Redesigned login page | `src/components/pages/login.tsx` — split-screen brand panel + demo quick-fill |
| 9 | Gudang: remove "Gateway" wording + `type` field; table exists & migrates | `model Warehouse` in `prisma/schema.prisma` (no `type` column); `db:push` on boot |
| 10 | Checkpoint mapping with Leaflet (min 3, unlimited) | `src/components/pages/routes.tsx` + `MIN_CHECKPOINTS = 3` in `src/lib/shipment-flow.ts` |

Database and API were fully rebuilt and corrected in the process — details in `02-database.md` and `03-api-reference.md`.

## Revision round 2 — role editing, QR handover scanning, bug fixes

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Owner can edit existing role permissions** (no need to create new roles) | `PUT /roles/{id}` + Access Control → Roles (system roles: owner-only, name/slug locked, permissions editable) — see `03-api-reference.md` & `05-business-flows.md` |
| R2 | **Kurir sees only their own pickups** + "Complete" action with **QR scanning of every detail barang**; all scanned → confirm → tracking shows **"Picked-up by [Kurir Name]"** | `?mine=true` executor mode, `POST /pickups/{id}/scans`, scan-gated `POST /pickups/{id}/confirm`, `src/components/app/qr-scan-dialog.tsx` |
| R3 | **Delivery shows detail barang** (handed over or not) + same QR scan flow → all packages scanned + PoD → DELIVERED | `GET /deliveries` embeds `details[]` + `allScanned`; `POST /deliveries/{id}/scans`; scan-gated complete |
| R4 | **Kendaraan (Vehicles) tab not showing** — fixed | Missing `driver`/`kenek` relations on `VehicleAssignment` were added to the Prisma schema (the API include referenced them) |
| R5 | **Transport tab not showing** — fixed | `TransportShipment` relation renamed to `master` to match the API's `include`; plus `driver`/`kenek` relations on `Transport` |
| R6 | Docs aligned with the new flows | This update — `03` (endpoints), `04` (QR dialog), `05` (flows), `06` (demo tasks) |

## Revision round 3 — pricing formula, route dropdown, package-per-row detail barang

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Shipment calculation fixed** — no more hardcoded `÷6000` in the UI; formula is now `L×W×H / 1.000.000 × volumetricMultiplier` with the **multiplier configurable per tariff** (kg/m³) | `src/lib/pricing.ts` (shared engine), `POST /shipments/{id}/price`, `pricingPreview` in `GET /shipments/{id}` — see `05-business-flows.md` |
| R2 | **No more typing Kota Asal/Tujuan** — shipment creation uses a **route dropdown fed by active tariffs**, filtered by the customer's **B2B/B2C label** (a B2B customer only sees B2B routes) | Create dialog in `shipments-page.tsx`; `POST /shipments` accepts `tariffId` and stores it on `MasterShipment.tariffId` |
| R3 | **Detail barang: quantity → unique codes** — inputting e.g. "Karton Tulis" qty 10 creates **10 rows with 10 unique codes**; DB structure = the "All" view (no quantity column) | `POST /shipments/{id}/details` expands N; `nextDetailCodes()` bulk generator |
| R4 | **Detail Barang tabs** — `Semua` (Kode \| Deskripsi \| Dimensi \| Berat, one row per package) and `Ringkas` (Deskripsi \| Dimensi \| Jumlah \| Berat — grouped, UX-only aggregation) | `shipments-page.tsx` detail view |
| R5 | **Price recompute** — "Hitung Ulang Harga" available while `CREATED/READY_FOR_PICKUP/PICKED_UP` so previously wrong snapshots can be corrected | `shipments-page.tsx` + price route guard |
| R6 | Seed data rewritten to match: tariffs with multipliers (250/300), N-package rows, prices computed by the real engine (payments & invoice lines stay coherent) | `src/lib/seed.ts` |

## Revision round 4 — gudang arrival workflow, scan methods, resi printing, PWA

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Pickup requires a counted price** — submitting a shipment for pickup is rejected (422) until "Hitung Harga" has stored a price; Penerima must also be filled (printed on resi) | `POST /shipments/{id}/ready` gates; guidance banner in shipments detail |
| R2 | **Cancel confirmation dialog** — cancelling a shipment always asks first (AlertDialog), never a direct cancel | `shipments-page.tsx` cancel AlertDialog |
| R3 | **Permission to confirm arrival at gudang** (`shipment.confirm_arrival`) + **Scan-Semua button** for Admin Gudang to bulk-scan every pending package in reader mode | `POST /shipments/{id}/arrive`, `POST /shipments/{id}/arrival-scan-all`; Gudang ops page |
| R4 | **Camera / reader / typed scanning with codes hidden** — kurir & gudang scan via phone camera (jsQR), hardware reader tools (fast keyboard-wedge auto-detected), or manual typing; package codes & QR are never displayed and paste into the scan field is blocked | `scan-console.tsx`; reworked `qr-scan-dialog.tsx`; scan APIs accept `method` |
| R5 | **Scanned vs Typed differentiation** — every HandoverScan stores `method`; Riwayat Scan shows Scanned (camera/reader) vs Typed badges | `HandoverScan.method`, progress responses include `scanMethod` |
| R6 | **Reader tools supported** — barcode guns act as fast keyboards; the timing heuristic marks them SCANNED | `scan-console.tsx` keystroke timing detection |
| R7 | **Admin Gudang can request pickups & walk-in arrival** — gudang staff may create pickup tasks for customers they know; a customer handing the package over at the counter is confirmed "Tiba di Gudang" directly, no scanning | Gudang ops "Pelanggan Langsung" tab; `POST /shipments/{id}/arrive` `mode:"walk_in"` |
| R8 | **Resi printing when pickup is requested** — after Submit for Pickup the print preview opens automatically; also a "Cetak Resi" button | `resi-print.tsx` overlay; `shipments-page.tsx` |
| R9 | **Volume + Berat columns** in the shipment list | `GET /shipments` totals; list columns |
| R10 | **Penerima (name/address/contact)** on every shipment + **customer support contact per gudang** — both printed on Resi Shipment & Resi Detail | `MasterShipment.penerima*`, `Warehouse.customerSupportContact` |
| R11 | **Resi Shipment** (resi no + QR + code, Penerima, Berat, Volume, Detail count, company header) + **Resi Detail sticker per package** (QR + code, Penerima, individual berat/volume, pcs 001/004, Pengirim + phone) | `resi-print.tsx`; `@media print` rules in `globals.css` |
| R12 | **Status tabs** All / Created / Ready for Pickup / Picked Up / Arrive at Gudang / In Transport / Delivered / Cancelled | shipments list toolbar (Arrive at Gudang merges RECEIVED + ARRIVED) |
| R13 | **Responsive + PWA** — installable app (manifest, icons, service worker, install menu item), layout verified desktop/laptop/tablet/phone | `public/manifest.webmanifest`, `public/sw.js`, `pwa.tsx`, `layout.tsx` metadata |
| R14 | **DP payment rule** — packages can only be picked up after ≥ 50% is paid; kurir records the balance at pickup; gudang can Notify Marketing about unpaid shipments | `POST /pickups/{id}/confirm` DP gate + `payment`; `POST /shipments/{id}/notify-marketing` |
| R15 | **Warehouse scoping** — roles below Admin Gudang (new `staff-gudang` role, demo user `wawan`) only see their own gudang's queue/contents | `warehouse.scope_own` permission, `Employee.warehouseId`, `GET /gudang` scope filter |

## Revision round 5 — B2B Master Resi scan, Owner Dashboard redesign, partial-payment profit clarification

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Owner can edit their own name & password** (previously the `/users/{id}` endpoint blocked all Owner edits, so the Owner had no way to self-serve) | New `PUT /api/v1/profile` endpoint accepts `{name?, currentPassword?, newPassword?}` for ANY user — including the Owner — and only touches the caller's own row. UI: Profile page now shows two new forms (Nama Tampilan + Password). The existing `/users/{id}` admin endpoint still guards the Owner row, because that path is for managing OTHER users. |
| R2 | **Optional receipt upload on invoice settlement** — when recording a settlement payment (full or partial), the Admin Kantor / Owner can now attach an optional receipt (image/PDF, ≤ 8 MB). Stored on the new `InvoiceSettlement.proofUrl` column. | `prisma/schema.prisma` (`InvoiceSettlement.proofUrl`), migration `20260917090320_init/migration.sql`, `POST /api/v1/invoices/{id}/settlements` accepts `proofUrl`, `invoices-page.tsx` Settle dialog has a file picker + preview, settlement history shows a clickable "Bukti" chip |
| R3 | **Partial invoice payments explicitly counted as company profit** — the finance dashboard now has a dedicated "Profit dari Pembayaran Invoice" section showing total realized (lunas + parsial), the SETTLED vs PARTIALLY_SETTLED split, the latest 8 settlement rows with proof badges, and a monthly timeline. Visible ONLY to `financial.report.view` (Admin Kantor + Owner). | `GET /api/v1/finance/summary` adds `totals.realizedInvoicePayments/settledInvoicePayments/partialInvoicePayments` + a full `invoicePayments` block; `finance-page.tsx` renders the new section with a "Hanya Admin Kantor & Owner" badge |
| R4 | **Separate `db:push` and `db:seed` — operator-controlled** | Added `db:seed` script to `package.json` (runs `prisma/seed.ts` via Bun). The auto-seed-on-first-API-request behaviour is now OPT-IN via the `AUTO_SEED_ON_BOOT=true` env var (default off). Production tenants are NEVER auto-seeded regardless of the flag. RBAC bootstrap (`ensureRbac()`) still always runs. Docs: `06-seeding-and-demo-accounts.md`, `07-deployment.md`, `03-api-reference.md`, root `README.md`, `.env.example` |

## Revision round 7 — Preview mode, Partner Alignment, Customer Gudang, Pickup Address

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Preview mode** — new third runtime mode (Dev / Preview / Production). Preview is a compiled build that still shows the Demo Account panel AND routes through the license server, with the Corporate ID pre-filled `"TRIAL"` | `src/lib/runtime-mode.ts` (new), `src/components/app/login-screen.tsx`, `src/lib/tenant-context.ts`, `package.json` (`build:preview` / `start:preview` scripts), `.env.example`. Docs: [`08-revision-round-7.md`](08-revision-round-7.md) |
| R2 | **"Lacak Paket" link** — visible in the login screen + the account dropdown in Dev + Preview; hidden in Production (customers reach `/tracking-paket` via URL only) | `src/components/app/login-screen.tsx`, `src/components/app/app-shell.tsx` |
| R3 | **Partner Alignment** — Marketing partners can be aligned to a specific Gudang (or "Umum" / general). Helps answer "which gudang is this marketing affiliate tied to?" | `prisma/schema.prisma` (`Partner.warehouseId`), `src/app/api/v1/partners/route.ts`, `src/app/api/v1/partners/[id]/route.ts`, `src/components/app/pages/partners-page.tsx` |
| R4 | **Customer Gudang attachment** — Customers can be attached to a specific Gudang (or "Umum") for gudang-scoped customer lists. Admin Gudang of other gudangs can NOT see customers attached to a different gudang. | `prisma/schema.prisma` (`Customer.warehouseId`), `src/app/api/v1/customers/route.ts`, `src/app/api/v1/customers/[id]/route.ts`, `src/app/api/v1/options/route.ts`, `src/components/app/pages/customers-page.tsx` |
| R5 | **Customer marker on shipment creation** — visual panel showing the customer's DB record, plus amber highlighting on Pengirim fields when they're overridden per-shipment. NOT printed on the resi. | `src/components/app/pages/shipments-page.tsx` |
| R6 | **Pickup address shown to kurir** — kurir sees the pickup address (sourced from `MasterShipment.pengirimAddress`) on the Pickups list, Kurir Dashboard, and the QR scan dialog. Includes sender name + tel: link. | `src/app/api/v1/pickups/route.ts`, `src/app/api/v1/dashboard/kurir/route.ts`, `src/components/app/pages/pickups-page.tsx`, `src/components/app/pages/kurir-dashboard-page.tsx`, `src/components/app/qr-scan-dialog.tsx` |

Full details in [`08-revision-round-7.md`](08-revision-round-7.md).

## Revision round 8 — Fulfillment Mode + Proof Photo Permission

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Shipment Fulfillment Mode (STANDARD / DIRECT)** — new `fulfillmentMode` field on `MasterShipment`. Exposed as top-level `Regular` / `Direct` tabs on the Shipments page. Owner's per-gudang tabs are kept separate — they show only STANDARD shipments (DIRECT is NOT merged into per-gudang view). New `DIRECT` badge on each row. `Mode Fulfillment` dropdown in the create-shipment dialog. | `prisma/schema.prisma` (`MasterShipment.fulfillmentMode`), `src/app/api/v1/shipments/route.ts` (filter + body), `src/lib/client-api.ts` (type), `src/components/app/pages/shipments-page.tsx` (tabs + form + badge) |
| R2 | **`proof_photo.view` permission** — new RBAC permission that gates display of photo evidence (pickup, checkpoint, delivery PoD). Default grant: Admin Gudang + Owner only. Other roles see "foto terkunci" placeholder. New `Pickup.photoUrl` and `Delivery.photoUrl` columns added for future photo uploads. | `prisma/schema.prisma` (`Pickup.photoUrl`, `Delivery.photoUrl`), `src/lib/rbac.ts` (new permission + Admin Gudang grant), `src/lib/client-api.ts` (types), `src/components/app/pages/transport-detail-page.tsx`, `src/components/app/pages/pickups-page.tsx`, `src/components/app/pages/deliveries-page.tsx` (display gating) |

Full details in [`09-revision-round-8.md`](09-revision-round-8.md).

## Revision round 9 — DIRECT Form Flow, Photo Detail Buttons, Vehicle Dimensions

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Shipment form restructure for DIRECT mode** — `Mode Fulfillment` dropdown moved BEFORE `Gudang Asal / Gudang Tujuan`. The gudang fields are hidden when `DIRECT` is selected (DIRECT doesn't use company warehouses). A violet info banner explains the DIRECT mode. | `src/components/app/pages/shipments-page.tsx` |
| R2 | **DIRECT shipments eligible for transport** — transport creation API now accepts DIRECT shipments in `CREATED` / `READY_FOR_PICKUP` status (STANDARD still requires `RECEIVED_AT_GUDANG`). The transport-form-dialog fetches from three status pools. | `src/app/api/v1/transports/route.ts`, `src/components/app/transport-form-dialog.tsx` |
| R3 | **Photo Detail buttons** — new reusable `PhotoDetailDialog` component. Pickups + Deliveries pages now have a "Detail Foto" button. Transport-detail checkpoint thumbnails are clickable to open the dialog. Display gated by `proof_photo.view` (Admin Gudang + Owner). | `src/components/app/photo-detail-dialog.tsx` (new), `src/components/app/pages/pickups-page.tsx`, `src/components/app/pages/deliveries-page.tsx`, `src/components/app/pages/transport-detail-page.tsx` |
| R4 | **Transport shipment selector cleanup** — removed the redundant "(status RECEIVED_AT_GUDANG)" text and replaced it with a compact DIRECT/STANDARD badge per row. Trimmed several over-explained UI banners in the shipments page. | `src/components/app/transport-form-dialog.tsx`, `src/components/app/pages/shipments-page.tsx` |
| R5 | **Vehicle dimensions (Panjang/Lebar/Tinggi in meters)** — added `lengthM`, `widthM`, `heightM` to Vehicle schema. When all three are set, `maxVolumeM3` is auto-computed as L × W × H. New "Ukuran" column appears BEFORE "Kapasitas" on the Vehicles page. | `prisma/schema.prisma`, `src/app/api/v1/vehicles/route.ts`, `src/app/api/v1/vehicles/[id]/route.ts`, `src/app/api/v1/options/route.ts`, `src/lib/client-api.ts`, `src/components/app/pages/vehicles-page.tsx` |

Full details in [`10-revision-round-9.md`](10-revision-round-9.md).

## Revision round 10 — Marketing Gudang Alignment, Admin Gudang Customer CRUD, Seed Updates

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Marketing partner Gudang affiliation on creation** — when creating a Marketing partner from the Access UI, you can now select their Gudang affiliation (or "Umum"). Also editable from the partner edit form. `ensurePartnerProfile` accepts `warehouseId`. `POST/PUT /users` forward it. New "Gudang" column on the Partners table. | `src/lib/partner.ts`, `src/app/api/v1/users/route.ts`, `src/app/api/v1/users/[id]/route.ts`, `src/lib/client-api.ts`, `src/components/app/pages/access-page.tsx` |
| R2 | **Customer Gudang auto-inheritance** — customers created by a Marketing partner aligned to a gudang auto-inherit that gudang. Marketing "umum" partners must pick a gudang manually (UI shows a "wajib" selector). Admin Gudang creating a customer auto-attaches it to their own gudang. | `src/app/api/v1/customers/route.ts`, `src/components/app/pages/customers-page.tsx` |
| R3 | **Admin Gudang customer CRUD** — Admin Gudang now has `customer.view/create/update/delete` permissions. Auto-applied by `ensureRbac()` on next API request. | `src/lib/rbac.ts` |
| R4 | **Seed data updates** — all 5 customers now have `email` + `warehouseId` (attached to the gudang matching their city). All 7 shipmentDefs now carry explicit `pengirim*` snapshot. New DIRECT shipment `MKT-000009` + transport `TRP-2026-000004` demo the DIRECT flow. New "umum" marketing partner `adit`. Budi aligned to Gudang Medan. | `src/lib/seed.ts`, `prisma/seed.ts` |

Full details in [`11-revision-round-10.md`](11-revision-round-10.md).

## Revision round 11 — Volume Column, Direct Volume Entry, Vehicle Formatting, Google Maps

| # | Revision | Where it is implemented |
|---|---|---|
| R1 | **Volume (m³) column in shipment detail** — both "Semua" and "Ringkas" detail barang tables now show a "Volume (m³)" column after "Dimensi (cm)". Uses `volumeM3` when set, otherwise computes L×W×H/1.000.000. | `src/components/app/pages/shipments-page.tsx` |
| R2 | **Direct volume entry (skip dimensions)** — new `volumeM3` field on `DetailShipment`. When set, used directly instead of L×W×H computation. New "Volume langsung (m³) — opsional" field in the detail form. When dimensions are absent, "Dimensi" shows "—". | `prisma/schema.prisma`, `src/lib/shipment-totals.ts`, `src/lib/pricing.ts`, `src/app/api/v1/shipments/route.ts`, `src/app/api/v1/shipments/[id]/details/route.ts`, `src/app/api/v1/shipment-details/[id]/route.ts`, `src/lib/client-api.ts`, `src/components/app/pages/shipments-page.tsx` |
| R3 | **Vehicle volume formatting (2 decimals)** — `maxVolumeM3` now shows 2 decimal places (e.g., `12,89 m³` instead of `13 m³`) on Vehicles page and My Vehicles page. | `src/components/app/pages/vehicles-page.tsx`, `src/components/app/pages/my-vehicles-page.tsx` |
| R4 | **Google Maps redirect button on checkpoints** — every checkpoint in the route editor and transport detail page has a "Buka di Google Maps" button that opens Google Maps at the checkpoint's coordinates. | `src/components/app/checkpoint-map-editor.tsx`, `src/components/app/pages/transport-detail-page.tsx` |

Full details in [`12-revision-round-11.md`](12-revision-round-11.md).

## Document index

| File | Contents |
|---|---|
| [`01-architecture.md`](01-architecture.md) | Stack, folder structure, server-side libraries, design decisions |
| [`02-database.md`](02-database.md) | All 21 models explained + relationships + **step-by-step Supabase Postgres switch** |
| [`03-api-reference.md`](03-api-reference.md) | Every endpoint, auth model, request/response shapes, error codes |
| [`04-frontend.md`](04-frontend.md) | Pages, navigation & RBAC gating, responsive behavior, dark mode, modal CRUD, Leaflet editor |
| [`05-business-flows.md`](05-business-flows.md) | Shipment lifecycle state machine, **QR handover scan flows (pickup & delivery)**, pricing & invoicing, RBAC editing |
| [`06-seeding-and-demo-accounts.md`](06-seeding-and-demo-accounts.md) | What the seeder creates, demo accounts, how to reset / customize |
| [`07-deployment.md`](07-deployment.md) | Dev, production build, Docker with migrate-on-boot, hosting notes |
| [`08-revision-round-7.md`](08-revision-round-7.md) | **Preview mode, Partner Alignment, Customer Gudang attachment, Customer marker, Pickup address** |
| [`09-revision-round-8.md`](09-revision-round-8.md) | **Fulfillment Mode (STANDARD/DIRECT) + proof_photo.view permission** |
| [`10-revision-round-9.md`](10-revision-round-9.md) | **DIRECT form flow, Photo Detail buttons, Vehicle dimensions** |
| [`11-revision-round-10.md`](11-revision-round-10.md) | **Marketing Gudang alignment, Admin Gudang customer CRUD, Seed updates** |
| [`12-revision-round-11.md`](12-revision-round-11.md) | **Volume column, Direct volume entry, Vehicle formatting, Google Maps** |

## Where the code lives (map)

```
src/
├── app/
│   ├── api/v1/…        # REST API (see 03-api-reference.md)
│   ├── globals.css     # design tokens (light/dark)
│   ├── layout.tsx      # root layout (fonts, theme provider)
│   └── page.tsx        # SPA entry — hash-routed app
├── components/
│   ├── ui/             # shadcn/ui primitives
│   ├── app-shell.tsx   # sidebar / drawer / bottom-nav / header
│   └── pages/          # one file per feature page
└── lib/
    ├── auth.ts         # scrypt hashing + bearer sessions
    ├── rbac.ts         # permission catalog + 6 system roles
    ├── audit.ts        # append-only audit logger
    ├── shipment-flow.ts# lifecycle state machine (single source of truth)
    ├── seed.ts         # idempotent mock-up seeder
    ├── code-generator.ts, api-helpers.ts, client-api.ts, utils.ts
prisma/
├── schema.prisma       # 21 models
└── seed.ts             # CLI entry for the seeder
```

## Demo accounts (quick reference)

| Username | Password | Role |
|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner — full access (`*` permissions) |
| `siti` | `Demo#Pass2026` | Admin Kantor |
| `budi` | `Demo#Pass2026` | Marketing |
| `agus` | `Demo#Pass2026` | Admin Gudang |
| `wawan` | `Demo#Pass2026` | Staff Gudang (scoped to Gudang Jakarta Pusat) |
| `dewi`, `rizky` | `Demo#Pass2026` | Kurir |
| `joko` | `Demo#Pass2026` | Driver |
| `andi` | `Demo#Pass2026` | Kenek |
