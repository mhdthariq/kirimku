# Project Documentation — Shipment & Logistics Management System

This folder explains **everything that was built**: the architecture, the database, the API, the frontend, the business flows, the mock-up seeder, and how to run & deploy the app.

> For a quick start (install → seed → run), read the root **`README.md`**.
> To switch the database from SQLite to **Supabase Postgres**, follow the tested guide in **`docs/08-supabase-setup.md`** (templates in **`.env.example`**).

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

## Revision round 3 — PostgreSQL / Supabase support verified

| Item | Result |
|---|---|
| Runtime verification | The full stack (push → seed → API → QR flow → CRUD → audit) tested against a real **PostgreSQL 18** server — the same `postgresql` provider Supabase uses |
| Case-insensitive search parity | New `ci()` helper (`src/lib/api-helpers.ts`) applied to **all 33 search filters** — SQLite and Postgres now behave identically (Postgres gets `mode: "insensitive"`)
| Setup guide | New **`docs/08-supabase-setup.md`** — connection-string decision table, 4-step switch, verification, serverless notes, 8-row troubleshooting table |

## Revision round 4 — transport detail with live vehicle position

| Item | Result |
|---|---|
| Position tracking | New endpoint **`POST /transports/{id}/checkpoints`** (`transport.record_checkpoint`, permission #63) records where the vehicle is — checkpoint check-in or GPS ping (haversine vs. radius geofence); `depart`/`arrive` auto-record origin/destination |
| Transport detail page | **`#/transports/{id}`** — read-only Leaflet journey map (numbered passed/upcoming checkpoints, dashed route, pulsing truck pin, GPS breadcrumbs), stat cards (shipments, koli, actual/volumetric/chargeable kg, value), vehicle capacity bar, position history timeline, shipments table deep-linking to the existing shipment detail page |
| Tracking integration | Each check-in writes a `CHECKPOINT_REACHED` tracking event to every carried shipment + `checkpoint_record` audit entry |
| Docs | `03` (endpoint + position rules), `04` (journey map component + page), `05` (check-in flow), README feature #12 |

## Document index

| File | Contents |
|---|---|
| [`01-architecture.md`](01-architecture.md) | Stack, folder structure, server-side libraries, design decisions |
| [`02-database.md`](02-database.md) | All 29 models explained + relationships + **step-by-step Supabase Postgres switch** |
| [`03-api-reference.md`](03-api-reference.md) | Every endpoint, auth model, request/response shapes, error codes |
| [`04-frontend.md`](04-frontend.md) | Pages, navigation & RBAC gating, responsive behavior, dark mode, modal CRUD, Leaflet editor |
| [`05-business-flows.md`](05-business-flows.md) | Shipment lifecycle state machine, **QR handover scan flows (pickup & delivery)**, pricing & invoicing, RBAC editing |
| [`06-seeding-and-demo-accounts.md`](06-seeding-and-demo-accounts.md) | What the seeder creates, demo accounts, how to reset / customize |
| [`07-deployment.md`](07-deployment.md) | Dev, production build, Docker with migrate-on-boot, hosting notes |
| [`08-supabase-setup.md`](08-supabase-setup.md) | **Tested** Supabase/PostgreSQL setup: connection strings, switch steps, parity notes, troubleshooting |

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
├── schema.prisma       # 29 models (SQLite default / PostgreSQL-ready)
└── seed.ts             # CLI entry for the seeder
```

## Demo accounts (quick reference)

| Username | Password | Role |
|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner — full access (`*` permissions) |
| `siti` | `Demo#Pass2026` | Admin Kantor |
| `budi` | `Demo#Pass2026` | Marketing |
| `agus` | `Demo#Pass2026` | Admin Gudang |
| `dewi`, `rizky` | `Demo#Pass2026` | Kurir |
| `joko` | `Demo#Pass2026` | Driver |
| `andi` | `Demo#Pass2026` | Kenek |
