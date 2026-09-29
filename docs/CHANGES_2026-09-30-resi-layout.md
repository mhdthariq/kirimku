# Changes 2026-09-30 (part 2) — Resi layout tweaks

## 1. Master Resi: "Dicetak oleh" moved to the right corner, same line
Was a second line under "Dicetak: <date+time>". Now both are on one line,
`justify-between`, e.g.:

```
Dicetak: 29/9/2026                                    Dicetak oleh: Owner
```

Also switched the date from a full timestamp (`toLocaleString`, which
includes the time) to just the date (`toLocaleDateString`) to match your
example. The "Dicetak oleh" name truncates instead of wrapping if it's ever
long, so it can't push into a second line and break the one-line layout.

Package label footer (the smaller "Dicetak: ... / Oleh: ..." near the QR)
is untouched — you asked for this on the Master Resi specifically.

## 2. Resi Detail (package label): Pengirim/Penerima now side by side
Was two stacked blocks (Pengirim, then Penerima below it), same as the
Master Resi used to look before that page got the two-column treatment.
Now it's one row, two columns, same layout the Master Resi already uses —
name, phone, and address (now 2 lines instead of 1) for both sender and
receiver, visible together without scanning down the label.

Bonus: this is actually shorter than before (78px vs. the old 100px for two
stacked blocks), so it freed up ~22px more room for the description/footer
area at the bottom of the label — updated the file's own documented height
budget (the comment at the top) to reflect that.

## Verification
- `resi-print.tsx` passes an esbuild syntax check.
- All 63 unit tests still pass (this is layout-only, doesn't touch any
  `src/lib/**` logic).
- This is a visual change to a print component — **please visually
  smoke-test**: print/preview a Master Resi and confirm the footer reads
  correctly on one line, and print/preview a package label (any shipment
  with ≥1 package) and confirm Pengirim/Penerima now sit side by side.
