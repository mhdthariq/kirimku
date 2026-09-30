# Changes 2026-10-01 (part 2) — Min kg back for B2B /kg, all maps on Google tiles

## 1. Min kg is back for B2B /kg
B2B /kg pricing is now: **max(weight entered, Min kg) × rate per kg**.
Still no volumetric multiplier and no rounding for B2B /kg (B2C is unchanged).
- Tariff form (B2B /kg): shows **Tarif per kg** and **Min. kg**. Multiplier / Pembulatan / Satuan stay hidden.
  /koli and /cubic still show none of the kg fields.
- Payload: B2B /kg sends your Min kg, and neutral defaults for multiplier/rounding.
- Tariff list: "min X kg · berat yang diinput × tarif/kg".
- Shipment pricing card (B2B /kg): Berat (yang diinput), **Berat ditagih (min X kg)**, Tarif.
- Master Resi (B2B /kg): one "Berat" cell normally; when Min kg lifts the billed weight above
  the entered weight, it shows both Aktual and Chargeable so the difference is visible.
- Price audit text says "min X kg → ditagih Y kg".

## 2. Leaflet tiles audit: every map is on Google Maps now
Found 4 Leaflet maps in the system. Two were still on OpenStreetMap:
| Map | Before | Now |
|---|---|---|
| `leaflet-picker.tsx` (Gudang / location picker) | Google | Google |
| `task-points-map.tsx` (kurir pickup/delivery map) | Google | Google |
| `transport-map.tsx` (transport detail map) | **OpenStreetMap** | Google |
| `checkpoint-map-editor.tsx` (checkpoint editor) | **OpenStreetMap** | Google |

All four now call one shared helper, `googleTileLayer(L)` in `src/lib/map-tiles.ts`, so the tile URL
lives in exactly one place. `map-tiles.test.ts` scans the whole `src/` tree and **fails if any file
uses an OpenStreetMap tile URL or calls `tileLayer()` directly** (I checked that it does fail when I
plant one). No other map library, iframe or embed exists; the `google.com/maps/search` links are just
external "open in Google Maps" links.
Reminder: this is Google's unofficial key-less tile endpoint. For production traffic Google expects the
official Maps JavaScript API with a billed key. If you want that later, only `map-tiles.ts` needs to change.

## Verification
72 unit tests pass (was 68); all touched files pass an esbuild syntax check.
Maps and the tariff form are UI, so please open: Tarif → B2B → /kg (Min kg present, no multiplier),
a transport detail page and the checkpoint editor (Google tiles), and price a B2B /kg shipment below its Min kg.
