# Changes 2026-09-30 — B2B tariff-selection bug + seeder update

## Bug fixed
When creating a shipment for a B2B customer, their tied tariff never showed
up in the Rute dropdown.

**Root cause:** `GET /api/v1/options` (which feeds the shipment-creation
form) explicitly `select`s which Tariff columns to send, and that list was
never updated when B2B tariffs got tied to a customer — `customerId` (and
`name`, `pricingMethod`, `ratePerKoli`, `ratePerCubic`, the koli/cubic
minimums) were all missing from the response. The client-side filter
(`tariffsForCustomer`, which checks `t.customerId === customer.id`) was
correct, but `t.customerId` was always `undefined` because the server never
sent it — so no B2B tariff ever matched, for any customer.

**Fix:** `src/app/api/v1/options/route.ts` now selects every Tariff field
the UI actually needs. One-line-select omissions like this are exactly the
kind of bug that's easy to introduce when a field gets added to a model
after the endpoint was written — worth grepping for other explicit
`select: { ... }` tariff/customer queries if similar issues turn up
elsewhere.

## Seeder updated to match the new B2B tariff model
`src/lib/seed.ts` previously created one untied B2B tariff per corridor —
exactly the "legacy, no customer" shape the new feature is meant to replace,
so the demo data no longer matched how the app actually works. Reseeding
now gives you:

- **Customers are seeded before tariffs** (tariffs need `customer.id` to
  exist first — this was also a necessary reordering).
- **PT Maju Bersama** (B2B, Medan → Banda Aceh) gets *two* tariffs on the
  same corridor to demo the "same lane, different name" feature:
  **"Reguler"** (/kg, Rp8.000 — same price the existing demo shipments were
  already priced with) and **"Kolian"** (/koli, Rp22.000/koli).
- **CV Sinar Jaya** (B2B, Medan → Lhokseumawe) gets **"Cubic"** (/cubic,
  Rp900.000/m³) — so a /cubic tariff exists in the demo data too. Because
  this is CV Sinar Jaya's only tariff, the existing demo shipment
  **MKT-000003** now prices with the /cubic method automatically — a real,
  already-in-the-database example of a /cubic B2B shipment, useful for
  checking the Resi Detail fix from earlier.
- **B2C tariffs are untouched in effect** — still generic (no customer),
  still /kg only, just named **"Reguler"** now instead of nameless.
- Shipment pricing snapshots (`pricingMethod`, `chargeableKoli`,
  `chargeableVolumeM3`) are now written during seeding too, matching what
  the real `/shipments/{id}/price` endpoint stores — previously the seeder
  only set `chargeableWeightKg`/`ratePerKg`, which happened to look right
  for /kg tariffs but would have been silently incomplete for /koli or
  /cubic ones.

**To pick this up:** re-run your seed script. It's idempotent (`upsert` /
"does this tariff name+corridor already exist" checks throughout), so it's
safe to run again against a database that already has the old seed data —
existing rows get backfilled, nothing is duplicated. Your **existing B2B
tariffs from before this fix still have no customer tied** (that's a
separate, pre-existing data gap, not something re-seeding fixes) — go to
Tarif → B2B and set the customer on each one.

## Verification
- All 63 existing unit tests still pass (this change doesn't touch
  `src/lib/pricing.ts` / `tariff-form.ts` / etc., only the options endpoint's
  select list and the seed script).
- `seed.ts` and `options/route.ts` pass an esbuild syntax check.
- **Please smoke-test**: re-seed, then create a shipment for "PT Maju
  Bersama" and confirm both "Reguler" and "Kolian" appear in the Rute
  dropdown (and nothing from CV Sinar Jaya's tariffs); same for CV Sinar
  Jaya and "Cubic". Also worth opening MKT-000003 to see the /cubic pricing
  reflected on its Resi.
