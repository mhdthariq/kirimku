# Changes 2026-10-01 — simple B2B /kg pricing + confirm before abandoning input

## 1. B2B /kg is now "weight entered × rate"
- `computePricing`: for a **B2B tariff with method /kg**, chargeable weight = the total weight
  the user typed. No volumetric multiplier, no minimum kg, no rounding. Price = weight × rate/kg.
  B2C /kg is unchanged (volumetric + min + rounding).
- Tariff form: B2B /kg now shows only **Tarif per kg**. Min kg / Multiplier / Pembulatan /
  Satuan exist for B2C only. The payload sends neutral defaults for B2B.
- Tariff list "Aturan" column says "berat yang diinput × tarif/kg" for B2B /kg.
- Shipment pricing card: B2B /kg shows just "Berat (yang diinput)" and "Tarif" (no volumetric row).
- Master Resi: B2B /kg shows one **Berat** cell instead of Aktual + Chargeable (they'd be identical).
- Price audit log text reflects the simple calculation.
- Existing B2B /kg tariffs keep their old multiplier/rounding values in the database, they are just ignored.
- I dropped the minimum kg too (read "and etc" as all the extras). If you want a minimum for B2B /kg, say so.
- **Shipments already priced keep their stored price** until "Hitung Harga" is run again.

## 2. Confirmation before abandoning typed input
Done once, in the shared `Dialog` (`src/components/ui/dialog.tsx`), so all 17 form dialogs get it
(customer, tariff, shipment, pickup, delivery, gudang, invoice, wallet, top-up, etc.).
- If the user typed/picked something inside a form and then closes with **Esc** or the **X button**
  (or an outside click, for dialogs without an X), a confirmation appears:
  "Tutup dan buang isian?" with **Lanjut mengisi** / **Buang & tutup**.
- The explicit **Batal** button and the automatic close after a successful save do NOT prompt.
- Dialogs without a form (details, scan, photo, confirmations) never prompt. Opt out per dialog
  with `<Dialog confirmOnClose={false}>`.
- Limitation: button-style controls other than radio/checkbox/switch don't count as "typed".

## Verification
68 unit tests pass (5 new for B2B /kg, 1 new for the tariff payload); all touched files pass an
esbuild syntax check. The dialog behavior and print layouts are UI, so **please click through**:
type in a form dialog, press Esc, confirm the prompt; press Batal, confirm no prompt; save, confirm no prompt.
