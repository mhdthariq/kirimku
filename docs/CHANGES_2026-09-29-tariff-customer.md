# Changes 2026-09-29 — Tariff cleanup, tariff names, B2B tariffs tied to customers

## Fixes
1. **kg-only fields hidden for /koli and /cubic.** Min kg, Multiplier, Pembulatan and
   Satuan now only show for /kg tariffs (B2C and B2B /kg). For /koli and /cubic the API
   receives neutral defaults instead of whatever was left in the form.
2. **Tariff name.** New `Tariff.name`. The same corridor can now have several tariffs as
   long as the names differ (duplicate rule = same name + corridor + customer).
3. **Customer form, B2B.** Company name comes first and is required; the old "Nama" field
   becomes "Nama PIC". B2C still shows a single "Nama". The API also rejects a B2B customer
   without a company name (create only, so old B2B rows can still be edited).

## Added
- **B2B tariffs tied to one B2B customer** (`Tariff.customerId`, required for new B2B tariffs).
- **Panel beside "Tambah Customer"** when type = B2B: pick /kg, /koli or /cubic and set the
  tariff, or press **Lewati** and add it later. The tariff is created right after the customer
  and is tied to them automatically. If the tariff step fails the customer is still kept and
  you get a warning to add the tariff from the Tarif page.
- **Tarif page tabs: B2C | B2B | Log Aktivitas.** B2B rows show a customer badge (same style
  as the Marketing (PIC) badge on Customers); a B2B tariff with no customer shows an amber
  "Belum terikat customer" badge.
- **Shipment creation:** a B2B customer only sees the tariffs tied to them; B2C customers see
  B2C + generic tariffs, never B2B ones. Enforced server-side too (shipments POST rejects
  another customer's B2B tariff, and the price fallback never picks another customer's tariff).

## Code structure
- `src/lib/tariff-form.ts` (pure, 19 tests): form defaults, field visibility, payload builder,
  validation, per-customer tariff filtering, labels.
- `src/components/app/tariff-form-fields.tsx` is shared by the Tarif dialog and the customer panel.
- Migration `prisma/migrations/20260928120000_tariff_name_and_customer/` (additive, nullable).

## Needs your attention
- **Existing B2B tariffs have no customer yet**, so they will NOT show up when creating a
  shipment until you open each one (Tarif → B2B) and pick its customer.
- Run `npx prisma generate && npx prisma migrate deploy && npx tsc --noEmit` — the sandbox
  can't reach Prisma's binary host, so only syntax checks (esbuild) and the 63 unit tests
  were run here. The dialogs themselves haven't been clicked through.
