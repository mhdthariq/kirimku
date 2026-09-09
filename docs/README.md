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
