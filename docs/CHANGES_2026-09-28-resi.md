# Changes 2026-09-28 — Master Resi AND Resi Detail (package labels) now reflect the B2B pricing method

You asked for this ahead of continuing the routing migration, since it's a
real data-display bug: B2B can choose /kg, /koli, or /cubic, but the resi
print always showed weight/volume stats regardless of which method was
actually chosen — showing a chargeable weight to a customer who's billed
/koli, for example. Originally applied to the Master Resi only; extended to
also cover **Resi Detail** (the per-package "colly" labels — what the code
calls "Package Label") on request, since the same problem existed there.

## Rule implemented (as specified), on BOTH sheets
- **Jumlah / Colly (package count) always shows** — how many pieces are in
  the shipment matters for handling no matter how it's billed.
- **PER_KG** → show weight (Aktual + Chargeable on Master Resi, Berat on
  Resi Detail), hide volume (and, on Resi Detail, the Dimensi cell that
  feeds it).
- **PER_CUBIC** → show volume (+ Dimensi on Resi Detail), hide weight.
- **PER_KOLI** → hide both weight and volume/dimensi — the koli count
  itself is the billing unit, already covered by the always-shown
  Jumlah/Colly cell.
- **B2C is unaffected** — always /kg, unchanged, still shows every cell on
  both sheets.

## Added
- **`src/lib/resi-display.ts`** (new, pure, unit-tested) —
  `resiStatVisibility(method)` returns `{ showWeight, showVolume }` per the
  rule above; `resiPricingMethodLabel(method)` returns the printable label
  ("/ KG", "/ Koli", "/ Cubic (m³)").
- **`src/lib/resi-display.test.ts`** — 6 tests covering all 3 methods plus
  the defensive fallback for an unrecognized value.
- **A B2B pricing-method mark on the Master Resi** — a new inverted
  (black-background/white-text) 16px band right under the stats row,
  shown only for B2B, reading e.g. "Metode Tarif B2B　/ Koli". This is the
  "mark it on Master Resi" part of the ask — staff can now see at a glance
  which of the 3 methods this shipment is billed by, which also explains
  why the stats row above shows what it shows.

## Changed
- **`src/components/app/resi-print.tsx`**:
  - **Master Resi** — the stats row (previously a fixed 4-column grid) is
    now built from an array of visible cells and adapts its column count
    (1/2/3/4) to how many are actually shown, so the remaining cells stay
    evenly spaced. A B2B-only pricing-method mark band was added right
    below it.
  - **Resi Detail / package labels** — same treatment: the 4-cell stats row
    (Berat, Volume, Dimensi, Colly) now conditionally renders Berat and the
    Volume+Dimensi pair per the same rule, Colly always shown last, grid
    columns adapting the same way. Each package label also gets its own
    (slightly more compact, ~14px) B2B pricing-method mark band, so a
    package handled on its own — away from the master resi, e.g. at a
    checkpoint scan — still tells staff which method the shipment is billed
    by.
  - Which method is "effective" for a shipment (shared by both sheets) is
    resolved as
    `shipment.pricingMethod ?? shipment.tariff?.pricingMethod ?? "PER_KG"`
    — this prefers the snapshot taken when the shipment was actually priced,
    but falls back to the selected tariff's method so the mark and the
    hidden/shown cells are correct even if someone prints the resi *before*
    running "Hitung Harga".
  - Updated the file's own documented height budget (a comment at the top)
    for both sheets to account for the new conditional row(s), including an
    honest note about the one worst-case combination on the Master Resi
    (B2B + both the price row AND the insurance row shown) where the
    non-critical footer ("printed at/by") may get compressed to make room —
    the resi number, QR, route, stats, and price are never affected by
    this. The Resi Detail sheet has no such optional rows, so it has no
    equivalent worst case.

## Verification
```
$ npm test
 ✓ src/lib/pricing.test.ts (17 tests)
 ✓ src/lib/coordinates.test.ts (15 tests)
 ✓ src/lib/customer-display.test.ts (6 tests)
 ✓ src/lib/resi-display.test.ts (6 tests)
 Test Files  4 passed (4)
      Tests  44 passed (44)
```
`resi-print.tsx` and the `resi-display.ts`/`.test.ts` files pass an
esbuild syntax check. This component itself (React + DOM portal + print
CSS) isn't unit-testable the way the pure logic is — please **visually
smoke-test** by printing/previewing a resi for one B2B shipment on each of
the 3 pricing methods (check both the Master Resi AND at least one Resi
Detail/package label sheet each time), and one B2C shipment (to confirm
it's unchanged on both sheets), before relying on this in production.
