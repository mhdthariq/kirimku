# 07 — Deployment & Operations

## Local development (Revision 6 — explicit two-step setup)

```bash
bun install          # or: npm install
bun run db:push     # STEP 1 — sync the Prisma schema to the database
bun run db:seed     # STEP 2 — OPTIONAL: seed demo data (idempotent)
bun run dev         # STEP 3 — start the dev server on http://localhost:3000
```

> **Revision 6.** The app **no longer auto-seeds on the first API request**.
> Schema push and demo seeding are now separate, operator-controlled steps.
> To restore the old Docker "migrate + seed on boot" behaviour, set
> `AUTO_SEED_ON_BOOT=true` in `.env` — see the bottom of this doc for the
> Docker recipe. Production tenants are NEVER auto-seeded.

Environment: copy `.env.example` → `.env` and set `DATABASE_URL` (SQLite default, or Supabase Postgres — full guide in `02-database.md`).

### Dev mode — no Corporate ID required

`bun run dev` runs with `NODE_ENV=development`. In this mode:

- The **Corporate ID field is hidden** on the login screen.
- The **demo account quick-fill buttons are shown** (owner, budi, hendra, siti, agus, ratna, wawan, dewi) — these users only exist in the seeded local DB, so they only work here.
- The license server (`LICENSE_API_URL`) is **never contacted**, so the `LICENSE_*` env vars can stay unset.
- Every API request talks to whatever `DATABASE_URL` is in `.env` — exactly what you want when iterating on the schema with `prisma db push`.

This is the recommended workflow for pushing schema changes: edit `prisma/schema.prisma` → `bun run db:push` → (optionally) `bun run db:seed` → `bun run dev` → log in with a demo account.

## Production build

```bash
bun run build        # next build + assembles .next/standalone
bun run start        # runs the standalone server (Node/Bun)
```

- The build emits a **standalone server** (`.next/standalone/server.js`) with only the needed `node_modules` — ideal for containers.
- `DATABASE_URL` must be present in the runtime environment (it is read at runtime, not baked in).
- For Supabase in production, use the **transaction pooler** URL (port 6543, `pgbouncer=true`) for serverless/short-lived connections, or the **session pooler** (5432) for a long-running server. Templates are in `.env.example`.

### Production mode — Corporate ID required

`bun run build` + `bun run start` runs with `NODE_ENV=production`. In this mode:

- The **Corporate ID field is shown** on the login screen and is required.
- The **demo account quick-fill buttons are hidden** — those users don't exist in a real tenant's database, so showing them would only produce login errors. Every login must use a real user account created in the tenant's own DB.
- The license server is contacted on every request (cached for 60 s per corp id) to validate the license and resolve the tenant's PostgreSQL connection details.
- Each tenant is routed to its **own database** — `DATABASE_URL` is only used as the fallback when no Corporate ID is supplied (rare in prod).
- The `LICENSE_API_URL`, `LICENSE_API_KEY`, `LICENSE_API_TOKEN`, and `LICENSE_APLIKASI` env vars must all be set.

## Docker

The original project ran `migrate + seed` on container boot. As of Revision 6
the seed step is opt-in via the `AUTO_SEED_ON_BOOT=true` env var. A minimal
container:

```dockerfile
FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run db:generate && bunx next build

EXPOSE 3000
# On boot: sync schema (always), then start. Set AUTO_SEED_ON_BOOT=true if
# you also want the seeder to run on the first API request (dev/demo only —
# production tenants are never auto-seeded regardless of this flag).
CMD bun run db:push && bun run start
```

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: ${DATABASE_URL}   # Supabase pooler URL, or mount a volume for SQLite
      AUTO_SEED_ON_BOOT: "true"       # OPTIONAL — seed on first request (dev/demo only)
    # volumes:                        # only for SQLite persistence
    #   - ./db:/app/db
```

Notes:

- **SQLite + containers:** mount `./db` as a volume or the database resets with the container. SQLite suits single-node deployments; for anything clustered, use Postgres/Supabase.
- **db push on boot** is safe and fast: it diffs the schema and applies changes only when out of sync. Prefer `prisma migrate deploy` with committed migration files once your schema stabilizes and multiple environments exist.
- `db:push --accept-data-loss` (the npm script) is convenient for dev; in production run plain `bunx prisma db push` so Prisma warns before destructive changes.

## One-page operations runbook

| Task | Command |
|---|---|
| Start dev | `bun run dev` |
| Rebuild DB from schema | `bun run db:push` |
| Reseed demo data | `bun run db:seed` (idempotent — explicit, no longer auto-runs) |
| Browse data | `bunx prisma studio` |
| Lint | `bun run lint` |
| Production build & run | `bun run build && bun run start` |
| Reset demo database | delete `db/custom.db` → `db:push` → `db:seed` |
| Check audit trail | `GET /api/v1/audit-logs` (or `#/audit` in the UI) |

## Health & monitoring pointers

- **Liveness:** `GET /` (login page) returns 200; `POST /api/v1/auth/login` exercises the DB + (if `AUTO_SEED_ON_BOOT=true`) seeder path.
- **Sessions:** tokens live in `SessionToken` with 12-hour expiry; expired rows are ignored on auth and can be pruned with a periodic job (`DELETE FROM SessionToken WHERE expiresAt < now()`).
- **Audit:** the append-only `AuditLog` is the operational system journal — export via `#/audit` → CSV for retention.
- **Backups:** SQLite — copy `db/custom.db`; Supabase — use scheduled backups/PITR from the dashboard.

## Security notes for production

1. **Change every demo password** (owner + 7 staff) before exposing the app — or disable the seeded users entirely.
2. Serve over HTTPS (reverse proxy or hosting platform TLS) — especially since bearer tokens are used.
3. The mock-up logo (`public/logo.svg`) should be replaced with the real brand asset.
4. Consider adding rate limiting on `/auth/login` at the proxy layer.
5. Keep `SESSION` length (12 h) aligned with your risk appetite — one constant in `src/lib/auth.ts`.
6. **The auto-seed flag (`AUTO_SEED_ON_BOOT`) MUST be left unset (or `false`) in production.** It only ever seeds the default/local tenant — but if you point a production `DATABASE_URL` at the default tenant by mistake, the flag would pollute the real database with demo data. Leave it off in prod.
