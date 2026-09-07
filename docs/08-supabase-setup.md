# 08 — Supabase PostgreSQL Setup Guide

> **Status: VERIFIED.** This stack was tested end-to-end against a real PostgreSQL 18 server
> (same `postgresql` provider Supabase uses): `db push` (all 29 tables), the seeder, the full
> API surface (26 endpoint checks), login/RBAC, case-insensitive search, the QR scan handover
> flow (pickup + delivery), CRUD writes, and the audit trail. Everything below is the tested path.

The app runs on **SQLite by default** (zero-config) and on **Supabase Postgres** for real
deployments. Both are first-class: the same schema, the same seed data, the same behaviour —
including case-insensitive search, which is handled per-provider by the `ci()` helper in
`src/lib/api-helpers.ts` (see [Behaviour parity](#6-behaviour-parity-what-we-fixed-for-postgres)).

---

## Table of contents

1. [What you need](#1-what-you-need)
2. [Create the Supabase project](#2-create-the-supabase-project)
3. [Pick the right connection string](#3-pick-the-right-connection-string)
4. [Switch the app to Postgres (4 steps)](#4-switch-the-app-to-postgres-4-steps)
5. [Verify the switch](#5-verify-the-switch)
6. [Behaviour parity: what we fixed for Postgres](#6-behaviour-parity-what-we-fixed-for-postgres)
7. [Deploying to a serverless host (Vercel etc.)](#7-deploying-to-a-serverless-host-vercel-etc)
8. [Migrating existing SQLite data](#8-migrating-existing-sqlite-data)
9. [Switching back to SQLite](#9-switching-back-to-sqlite)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What you need

- A Supabase account (free tier is enough — 500 MB database).
- The project running locally at least once on SQLite (so you know it works).
- Prisma requirements: nothing extra — the Prisma CLI is already a dependency.

## 2. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Choose a name, region close to your users, and a **strong database password** — save it now
   (Supabase will not show it again; it can be reset, but that invalidates old URLs).
3. Write down two values from **Project Settings**:
   - **Project Ref** — e.g. `abcdefghijklmnopqrst` (Settings → General).
   - **Region host** — e.g. `aws-0-ap-southeast-1` (Settings → Database → Connection info).

Wait ~2 minutes for the project to finish provisioning before connecting.

## 3. Pick the right connection string

Supabase offers three connection flavors. **Use the session pooler unless you have a reason not to.**

| Flavor | Example host | Port | Works for `db push`/seed | Works for dev/start | IPv4-friendly |
|---|---|---|---|---|---|
| **Session pooler** ⭐ recommended | `aws-0-<region>.pooler.supabase.com` | 5432 | ✅ | ✅ | ✅ |
| **Direct** | `db.<project-ref>.supabase.co` | 5432 | ✅ | ✅ | ⚠️ needs IPv6 |
| **Transaction pooler** | `aws-0-<region>.pooler.supabase.com` | 6543 | ❌ | serverless only | ✅ |

```bash
# Session pooler (recommended) — placeholder values in [BRACKETS]
postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require

# Direct (only if your network supports IPv6)
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require

# Transaction pooler (serverless runtime only — see section 7)
postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require
```

Notes:

- `sslmode=require` is **mandatory** — Supabase rejects unencrypted connections.
- Percent-encode special characters in the password (`#` → `%23`, `@` → `%40`, `:` → `%3A`).
- Find the exact strings in **Supabase Dashboard → Project Settings → Database → Connection string → URI** and copy them verbatim.

## 4. Switch the app to Postgres (4 steps)

### Step 1 — Flip the provider (one line)

Edit `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

That single line is the **only** code change required. The schema uses only
`String` / `Int` / `Float` / `Boolean` / `DateTime` — no SQLite-only features — so all 29
models deploy to Postgres unchanged.

### Step 2 — Point `.env` at Supabase

```bash
cp .env.example .env   # if you don't have .env yet
```

Comment out the SQLite line, then set the session pooler URL:

```bash
DATABASE_URL="postgresql://postgres.YOUR-REF:YOUR-PASSWORD@aws-0-YOUR-REGION.pooler.supabase.com:5432/postgres?sslmode=require"
```

### Step 3 — Push the schema + seed

```bash
bun run db:push     # creates all 29 tables, indexes, FK cascades in Supabase
bun run db:seed     # loads the mock-up dataset (idempotent — safe to re-run)
```

Expected output from `db:seed`:

```
✔ Seed selesai. Ringkasan data mock-up:
   Users: 8 (owner + 7 staff)
   ...
```

No manual SQL is ever required.

### Step 4 — Run the app

```bash
bun run dev
```

The `dev` script runs `prisma generate` automatically, so the Prisma client is regenerated
for the `postgresql` connector on boot.

## 5. Verify the switch

```bash
# 1. Login (also triggers auto-seed if the DB is empty)
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","password":"ChangeMeOwner#2026"}'
# → must contain "token"

# 2. Search must stay case-insensitive (tests the ci() parity helper)
curl -s "http://localhost:3000/api/v1/vehicles?search=fuso" \
  -H "Authorization: Bearer <TOKEN>"
# → must return the "Fuso Besar" vehicle

# 3. Vehicles & Transports pages render crew + shipments
curl -s "http://localhost:3000/api/v1/transports" -H "Authorization: Bearer <TOKEN>"
```

In the Supabase Dashboard you can also open **Table Editor** and see the seeded rows
(Users, MasterShipment, Pickup, …) — a nice sanity check that the data is really there.

## 6. Behaviour parity: what we fixed for Postgres

SQLite and PostgreSQL differ in one visible way for this app: **string search**.

- SQLite's `LIKE` is **case-insensitive** for ASCII by default.
- PostgreSQL's `LIKE` is **case-sensitive** by default.

Naively, the same search box would behave differently per database — searching `fuso` finds
`Fuso Besar` on SQLite but returns **empty** on Postgres. This app fixes that with the `ci()`
helper (`src/lib/api-helpers.ts`), used by **all 33 search filters** across 13 endpoints:

```ts
// Before (broken on Postgres):
{ vehicleNumber: { contains: search } }

// After (case-insensitive on BOTH databases):
{ vehicleNumber: ci(search) }
```

`ci()` inspects `DATABASE_URL`: on Postgres it adds Prisma's `mode: "insensitive"`
(which compiles to `ILIKE`); on SQLite it uses plain `contains` (already case-insensitive).
No behaviour change for SQLite users, correct behaviour for Postgres users.

Everything else in the data layer is Prisma-native and provider-neutral: no raw SQL, no
`PRAGMA`, no SQLite-specific functions anywhere in `src/` or `prisma/`.

## 7. Deploying to a serverless host (Vercel etc.)

Serverless platforms recycle connections aggressively — use the **transaction pooler** there:

1. On the host, set the runtime `DATABASE_URL` to the **6543 transaction pooler** URL
   including `?pgbouncer=true&connection_limit=1` (Prisma disables prepared statements, which
   PgBouncer transaction mode cannot multiplex).
2. Keep `prisma/schema.prisma` with `provider = "postgresql"`.
3. Run schema changes **from your machine**, not from the serverless runtime:

```bash
DATABASE_URL="<session-pooler-5432-url>" bun run db:push
DATABASE_URL="<session-pooler-5432-url>" bun run db:seed
```

> `db push` / `db:seed` / `migrate` **must not** go through the transaction pooler (6543) —
> DDL and multi-statement seed transactions break under transaction-mode pooling.

If you prefer Prisma's official two-URL setup, add `directUrl = env("DIRECT_URL")` to the
datasource block, set `DATABASE_URL` to the transaction pooler and `DIRECT_URL` to the
direct/session URL (templates for both are in `.env.example`).

## 8. Migrating existing SQLite data

The seeder reproduces the full mock-up dataset, so for demo data just re-run
`bun run db:seed`. If you have **real rows** in `db/custom.db` worth keeping:

1. Start a second Prisma Studio against SQLite: `DATABASE_URL="file:../db/custom.db" bunx prisma studio`
2. Start one against Supabase: `DATABASE_URL="<supabase-url>" bunx prisma studio`
3. Export/Import per table (CSV) in dependency order:
   Employee → User/Role/Permission → Warehouse → Route → Checkpoint → Vehicle →
   Customer → MasterShipment → DetailShipment → the rest.
   (A generic `sqlite3 → csv → Supabase import` tool works too.)

## 9. Switching back to SQLite

```prisma
// prisma/schema.prisma
provider = "sqlite"
```

```bash
# .env
DATABASE_URL="file:../db/custom.db"
```

```bash
bun run db:push && bun run db:seed && bun run dev
```

The SQLite file keeps whatever it had — the Supabase experiment never touches it.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `P1001: Can't reach database server` | Wrong host/port, or project paused | Free-tier Supabase projects pause after ~1 week of inactivity — restore in Dashboard, then retry |
| `Connection terminated / timeout` on direct URL (5432 @ `db.<ref>.supabase.co`) | Your network lacks IPv6 | Switch to the **session pooler** URL |
| `Error validating datasource: URL must start with postgresql://` | Shell has an old `DATABASE_URL` exported — a pre-set env var **overrides** `.env` | `unset DATABASE_URL` in that shell (both Prisma and Next load `.env` only into *unset* variables) |
| `prepared statement "..." does not exist` | You used the **transaction pooler (6543)** for a long-running server or `db push` | Use session pooler (5432) for CLI/dev; add `?pgbouncer=true` if 6543 is your runtime URL |
| `password authentication failed` | Password has URL-special chars | Percent-encode: `#`→`%23`, `@`→`%40`, `:`→`%3A` |
| `P3006 / schema drift` on `db push` | Tables were edited in Supabase Studio by hand | Dashboard → Database → Reset database, then re-run `db:push` + `db:seed` |
| Searches return fewer results than on SQLite | (Fixed) `ci()` not applied — only possible on a modified codebase | All 33 filters use `ci()`; keep it that way when adding new search endpoints |
| App still reads old data after switching | Dev server started before `.env` was changed | Restart `bun run dev` (env is read at boot; it does not hot-reload) |

---

Related docs: [02-database.md](02-database.md) (schema catalogue), [07-deployment.md](07-deployment.md) (Docker/hosting), [.env.example](../.env.example) (all URL templates).
