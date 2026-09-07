# 07 — Deployment & Operations

## Local development

```bash
bun install          # or: npm install
bun run db:push      # create/sync the database (SQLite file auto-created)
bun run db:seed      # optional — auto-seed also happens on first API request
bun run dev          # http://localhost:3000
```

Environment: copy `.env.example` → `.env` and set `DATABASE_URL` (SQLite default, or Supabase Postgres — full guide in `02-database.md`).

## Production build

```bash
bun run build        # next build + assembles .next/standalone
bun run start        # runs the standalone server (Node/Bun)
```

- The build emits a **standalone server** (`.next/standalone/server.js`) with only the needed `node_modules` — ideal for containers.
- `DATABASE_URL` must be present in the runtime environment (it is read at runtime, not baked in).
- For Supabase in production, use the **transaction pooler** URL (port 6543, `pgbouncer=true`) for serverless/short-lived connections, or the **session pooler** (5432) for a long-running server. Templates are in `.env.example`.

## Docker

The original project ran `migrate + seed` on container boot; the rebuilt app reproduces that behaviour with `prisma db push` + the auto-seed hook. A minimal container:

```dockerfile
FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run db:generate && bunx next build

EXPOSE 3000
# On boot: sync schema, then start (first API request seeds demo data)
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
| Reseed demo data | `bun run db:seed` (idempotent) |
| Browse data | `bunx prisma studio` |
| Lint | `bun run lint` |
| Production build & run | `bun run build && bun run start` |
| Reset demo database | delete `db/custom.db` → `db:push` → `db:seed` |
| Check audit trail | `GET /api/v1/audit-logs` (or `#/audit` in the UI) |

## Health & monitoring pointers

- **Liveness:** `GET /` (login page) returns 200; `POST /api/v1/auth/login` exercises the DB + seeder path.
- **Sessions:** tokens live in `SessionToken` with 12-hour expiry; expired rows are ignored on auth and can be pruned with a periodic job (`DELETE FROM SessionToken WHERE expiresAt < now()`).
- **Audit:** the append-only `AuditLog` is the operational system journal — export via `#/audit` → CSV for retention.
- **Backups:** SQLite — copy `db/custom.db`; Supabase — use scheduled backups/PITR from the dashboard.

## Security notes for production

1. **Change every demo password** (owner + 7 staff) before exposing the app — or disable the seeded users entirely.
2. Serve over HTTPS (reverse proxy or hosting platform TLS) — especially since bearer tokens are used.
3. The mock-up logo (`public/logo.svg`) should be replaced with the real brand asset.
4. Consider adding rate limiting on `/auth/login` at the proxy layer.
5. Keep `SESSION` length (12 h) aligned with your risk appetite — one constant in `src/lib/auth.ts`.
