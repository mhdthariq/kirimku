# Changes 2026-09-30 (part 3) — search broken on Postgres (worked on SQLite)

## The bug
Every list/search endpoint in the app did this:
```ts
const search = str(params.get("search"))?.toLowerCase();
// ...
where: { name: { contains: search } }
```
**SQLite's `LIKE` (what Prisma's `contains` compiles to) is case-insensitive
by default for ASCII text — Postgres's is not.** Lowercasing the search term
happens to paper over that on SQLite (doesn't matter what case you compare
in, it always matches regardless), but on Postgres it does the opposite of
what was intended: it forces the search term to lowercase and then compares
it, case-sensitively, against real data that's almost never all-lowercase
("PT Maju Bersama", "Reguler", "Kolian" — never matches a lowercased search
term). Net effect on Postgres: **typing anything into a search box returns
zero results**, silently — no error, just nothing found. That's exactly why
it looked broken specifically for Tariff on Postgres but fine on SQLite —
it's not a schema or migration issue, it's this one pattern repeated
everywhere search exists.

## Fix
Stopped lowercasing the search term, and added `mode: "insensitive"`
(Postgres's actual case-insensitive-match option) to every `contains`
filter instead. Fixed in **all 13 endpoints** that had this pattern, not
just Tariffs — this bug affected every searchable list in the app on
Postgres:

`users`, `employees`, `deliveries`, `invoices`, `audit-logs`, `shipments`,
`transports`, `customers`, `warehouses`, `tariffs`, `pickups`, `vehicles`,
`routes`.

Two *unrelated* `.toLowerCase()` calls were deliberately left alone — they
weren't part of this bug: username normalization in `users/route.ts`, and
sender-snapshot normalization in `shipments/route.ts`.

## What you need to do
Nothing schema-side — this was pure application code, no migration
involved. Just deploy this code. If you were working around it (e.g. always
typing search terms in lowercase, or avoiding search on Postgres
entirely), that workaround is no longer necessary.

## Verification
- All 13 files pass an esbuild syntax check.
- All 63 unit tests still pass (this fix doesn't touch `src/lib/**`).
- I can't run this against a live Postgres database from here (same
  sandbox network restriction as before — no path to `binaries.prisma.sh`
  for a real `prisma generate`/`tsc` check). **Please verify directly**:
  search for something in mixed case (e.g. search "koli" and confirm a
  tariff named "Kolian" shows up) on both your Tariffs and Customers pages
  against your real Postgres database.

## If this *isn't* what you were seeing
This was the most likely explanation given "works on SQLite, not on
Postgres" plus "for tariff" — a genuine, verifiable, and very common
Postgres-portability bug I found directly in the tariff code. If you're
still seeing a problem after this, it'd help to know the exact error
message or what specifically fails (e.g., does creating a tariff error out?
Does the B2B tariff still not show when creating a shipment? Does the
Tariffs page fail to load at all?) so I can look at the right thing next.
