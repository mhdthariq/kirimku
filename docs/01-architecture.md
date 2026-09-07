# 01 — Architecture

## Overview

The application is a **single Next.js 16 project** that contains both the frontend and the backend. There is no separate API server and no separate frontend build — one process serves the UI and the REST API.

```
┌────────────────────────────────────────────────────────────┐
│                     Next.js 16 process                     │
│                                                            │
│  Browser (SPA, hash-routed)          REST API /api/v1/*    │
│  ┌──────────────────────────┐        ┌──────────────────┐  │
│  │ React 19 + Tailwind 4    │  fetch │  Route Handlers  │  │
│  │ shadcn/ui + Leaflet      │ ────►  │  RBAC-guarded    │  │
│  │ next-themes (dark/light) │  JSON  │  Zod-validated   │  │
│  └──────────────────────────┘        └────────┬─────────┘  │
│                                               │            │
│                                    Prisma Client            │
│                                               │            │
└───────────────────────────────────────────────┼────────────┘
                                                │
                        SQLite (default) or PostgreSQL (Supabase)
```

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router | One codebase for UI + API, file-based routing, server route handlers |
| Language | TypeScript (strict) | Type safety across the API boundary and DB |
| UI | Tailwind CSS 4 + shadcn/ui | Fast, consistent, accessible primitives (Dialog, Tabs, Table, etc.) |
| State | Per-page `useState`/`useEffect` + a small `client-api.ts` fetch layer | Deliberately no global store — pages are independent and simple |
| Maps | Leaflet 1.9 (loaded with `ssr: false`) | Open-source, no API key, works offline with OSM tiles |
| Charts | Recharts | Dashboard lifecycle bar chart |
| ORM | Prisma 6 | Typed queries, migrations via `db push`, provider-switchable |
| Auth | Custom scrypt + DB-stored bearer tokens | No external auth service needed; 12-hour sessions |
| Validation | Zod | Request body validation at the API layer |
| DB | SQLite (dev default) → PostgreSQL (prod-ready) | Zero-config start; one-line switch to Supabase |

## Folder structure

```
├── db/                        # SQLite database file lives here (db/custom.db)
├── prisma/
│   ├── schema.prisma          # 21 models — the single source of truth
│   └── seed.ts                # CLI seeder (bun run db:seed)
├── public/
│   └── logo.svg               # mock-up brand logo
├── src/
│   ├── app/
│   │   ├── api/v1/            # ~30 route handler groups (see 03-api-reference.md)
│   │   ├── globals.css        # design tokens, light/dark palettes
│   │   ├── layout.tsx         # fonts, ThemeProvider, Toaster
│   │   └── page.tsx           # mounts the SPA shell, hash router
│   ├── components/
│   │   ├── ui/                # shadcn/ui primitives (button, dialog, table, …)
│   │   ├── app-shell.tsx      # responsive nav shell (sidebar/drawer/bottom-nav)
│   │   └── pages/             # one component per feature page
│   │       ├── login.tsx, dashboard.tsx, shipments.tsx, …
│   ├── hooks/                 # use-hash-route, use-theme helpers, etc.
│   └── lib/                   # server-side + shared libraries (below)
├── .env / .env.example        # DATABASE_URL (Supabase options documented)
└── docs/                      # this documentation
```

## Server-side libraries (`src/lib/`)

| File | Responsibility |
|---|---|
| `db.ts` | Prisma client singleton (reuses one connection across hot reloads) |
| `auth.ts` | `hashPassword`/`verifyPassword` (Node scrypt), `createSession`, `getUserFromAuthHeader`, 12h bearer tokens |
| `rbac.ts` | `PERMISSIONS` catalog (79 slugs), `ROLE_TEMPLATES` (6 system roles), `ensureRbac()` idempotent bootstrap, `can(user, permission)` check |
| `audit.ts` | `logAudit({action, entityType, entityId, entityLabel, before, after, actor})` — append-only, used by every mutating endpoint |
| `shipment-flow.ts` | `SHIPMENT_STATUSES`, `VALID_TRANSITIONS`, `canTransition()`, `MIN_CHECKPOINTS = 3` — single source of truth shared by API **and** UI |
| `code-generator.ts` | `nextCode(prefix)` — collision-proof code generator (`MKT-000008`, `PICK-2026-000012`, …) based on max suffix in DB |
| `api-helpers.ts` | `{ok, fail}` response envelope, error codes, pagination params, `requireAuth`/`requirePermission` guards, `ensureSeed()` hook on first request |
| `seed.ts` | The idempotent mock-up seeder (see `06-seeding-and-demo-accounts.md`) |
| `client-api.ts` | Typed browser-side fetch wrapper (attaches bearer token, unwraps envelope) |
| `utils.ts` | `cn()` class merge, formatters (rupiah, dates, status labels) |

## Key design decisions

**1. Hash-routed SPA in one page.** The whole authenticated app lives at `/` and switches views via the URL hash (`#/shipments`, `#/gudang`, …). This keeps the app deployable as a single static-ish page with client-side navigation, instant view switches, and zero server round-trips for navigation — while API routes remain clean REST resources.

**2. Lifecycle rules in code, not just docs.** `shipment-flow.ts` is imported by both the API (to reject illegal transitions) and the frontend (to render status badges and enabled/disabled buttons). Rules can never drift between layers.

**3. Auto-seed on first API request.** `api-helpers.ts` calls `ensureSeed()` before handling requests. After a fresh `db:push`, the first request populates RBAC + demo data — mirroring the "migrate + seed on boot" behaviour of a Docker entrypoint (see `07-deployment.md`).

**4. Statuses are `String` columns, not DB enums.** SQLite does not support Prisma enums; using validated strings keeps the schema **portable to PostgreSQL without any changes** — important for the Supabase path (see `02-database.md`).

**5. Money as `Float`.** Amounts (`priceAmount`, `ratePerKg`, `amount`, `unitPrice`) are `Float` to keep the mock-up simple and portable. For a production accounting-grade system, switch these to `Decimal @db.Decimal(65, 2)` on PostgreSQL — a drop-in change documented in `02-database.md`.

**6. RBAC is permission-slug based, not role-name based.** Roles are just bundles of permission slugs; endpoints check `shipment.create`, not `role == "marketing"`. You can create new roles in the Access Control UI without touching code.

**7. Leaflet loaded client-side only.** Map components are imported dynamically with `ssr: false` to avoid `window is not defined` during SSR — Leaflet simply doesn't work on the server, so it never runs there.

## Data flow example (create shipment)

1. User clicks **"Tambah"** on `#/shipments` → `Dialog` form opens (no inline table form).
2. Submit → `POST /api/v1/shipments` with JSON body.
3. Route handler: `requireAuth` → `requirePermission("shipment.create")` → Zod parse → validate customer + gudang ids → `nextCode("MKT")` → Prisma insert → `logAudit("created", "shipment", …)`.
4. Response `{ "data": { … } }` → client refreshes the list table.
5. The audit entry is immediately visible in the page's **"Log Aktivitas"** tab and in the global Audit Timeline.
