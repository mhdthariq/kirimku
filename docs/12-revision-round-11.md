# 12 — Revision Round 11 (Volume Column, Direct Volume Entry, Vehicle Formatting, Google Maps)

This document covers four related changes delivered together:

1. **Volume (m³) column in shipment detail** — both the "Semua" (per-package) and "Ringkas" (grouped) detail barang tables now show a "Volume (m³)" column right after the "Dimensi (cm)" column.
2. **Direct volume entry (skip dimensions)** — new `volumeM3` field on `DetailShipment`. When set, the package volume is used directly (no L×W×H computation). Useful for irregularly-shaped packages. When dimensions are absent, the "Dimensi" column shows "—".
3. **Vehicle volume formatting** — `maxVolumeM3` now shows 2 decimal places (e.g., `12,89 m³` instead of `13 m³`) on the Vehicles page and My Vehicles page.
4. **Google Maps redirect button on checkpoints** — every checkpoint in the route editor (CheckpointMapEditor) and the transport detail page now has a "Buka di Google Maps" button that opens Google Maps at the checkpoint's coordinates.

---

## 1. Volume (m³) column in shipment detail

### Background

The shipment detail's detail barang tab showed dimensions (L×W×H in cm) and weight (kg), but not the computed volume (m³). The user wanted to see the volume per package right after the dimensions.

### What's new

A new "Volume (m³)" column appears after the "Dimensi (cm)" column in both detail barang views:

- **"Semua" tab (per-package)** — each row shows the package's volume in m³ (3 decimal places, e.g., `0.009 m³`). Uses `volumeM3` when set, otherwise computes `L×W×H/1.000.000`. Shows "—" when neither path yields a positive volume.
- **"Ringkas" tab (grouped)** — each group shows the total volume (per-package × quantity) plus a per-package breakdown. E.g., `0.027 m³ (0.009/paket)` for 3 packages at 0.009 m³ each.

### Files changed

| File | Change |
|---|---|
| `src/components/app/pages/shipments-page.tsx` | New "Volume (m³)" column in the "Semua" table. New `volumeM3` field on `DetailGroupRow` + the grouped computation. New "Volume (m³)" column in the "Ringkas" table showing total + per-package. |

---

## 2. Direct volume entry (skip dimensions)

### Background

Some packages are irregularly shaped — measuring L, W, H separately is impractical. The user wanted to optionally enter the volume directly (in m³) and skip the dimension fields. When dimensions are absent, the "Dimensi" column should show "—".

### Schema change

```prisma
model DetailShipment {
  // …existing fields…
  /// Revise round 11 — optional direct volume entry (m³). When set, this
  /// value is used directly for the package volume (no L×W×H computation).
  volumeM3       Float?
  // …existing fields…
}
```

New nullable column. Defaults to NULL. Existing rows keep their computed volume (from L×W×H). No data migration required.

### Volume computation logic

Both `shipment-totals.ts` and `pricing.ts` now use a shared `detailVolumeM3` helper:

```ts
function detailVolumeM3(d: DetailLike): number {
  if (d.volumeM3 != null && d.volumeM3 > 0) return d.volumeM3;
  return ((d.lengthCm ?? 0) * (d.widthCm ?? 0) * (d.heightCm ?? 0)) / 1_000_000;
}
```

Priority: explicit `volumeM3` → computed L×W×H/1.000.000 → 0.

### API changes

- **`POST /api/v1/shipments/{id}/details`** — accepts optional `body.volumeM3` (number or null). Stored on the `DetailShipment` row.
- **`POST /api/v1/shipments`** — accepts `volumeM3` on inline detail entries.
- **`PUT /api/v1/shipment-details/{id}`** — accepts `body.volumeM3` (number or null to clear).
- **`GET /api/v1/shipments/{id}`** — `pricingPreview` now uses `volumeM3` when set (the pricing engine's `volumetricKgForDetail` helper respects it).

### UI changes

The detail create/edit form now has a new "Volume langsung (m³) — opsional" field below the dimension inputs:

```
Panjang (cm) | Lebar (cm) | Tinggi (cm)
Volume langsung (m³) — opsional  [mis. 0.009 (opsional)]
  Hint: "Isi jika paket berbentuk tidak beraturan (skip dimensi). Kosongkan untuk hitung otomatis dari P×L×T."
```

When the user enters only the volume (leaving dimensions blank):
- The "Dimensi (cm)" column shows "—" (no dimensions to display).
- The "Volume (m³)" column shows the entered value.
- The pricing engine uses the entered volume for the volumetric kg computation.

### Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | `DetailShipment.volumeM3 Float?` added. |
| `src/lib/shipment-totals.ts` | `DetailLike` interface gained `volumeM3?`. New `detailVolumeM3` helper. `computeTotals` + `totalsByMaster` use it. |
| `src/lib/pricing.ts` | `PricedDetailInput` gained `volumeM3?`. New `volumetricKgForDetail` helper (replaces `volumetricKgFor`). `computePricing` uses the new helper. |
| `src/app/api/v1/shipments/route.ts` | POST inline details forward `volumeM3`. |
| `src/app/api/v1/shipments/[id]/details/route.ts` | POST accepts `volumeM3`. |
| `src/app/api/v1/shipment-details/[id]/route.ts` | PUT accepts `volumeM3`. |
| `src/lib/client-api.ts` | `DetailShipment` interface gained `volumeM3?`. |
| `src/components/app/pages/shipments-page.tsx` | `DetailForm` gained `volumeM3`. `EMPTY_DETAIL` includes it. `openDetailEdit` pre-fills it. `onDetailSubmit` sends it. New "Volume langsung" field in the form. New "Volume (m³)" column in both tables. `DetailGroupRow` gained `volumeM3` field + grouped computation. |

---

## 3. Vehicle volume formatting (2 decimal places)

### Background

The Vehicles page showed `maxVolumeM3` with 0 decimal places (e.g., `13 m³` for a value of `12.89`). The user wanted 2 decimal places (e.g., `12,89 m³`) for precision.

### What's new

All vehicle volume displays now use `formatNumber(value, 2)`:

| Page | Before | After |
|---|---|---|
| Vehicles page (Kapasitas column) | `13 m³` | `12,89 m³` |
| My Vehicles page (Kapasitas column) | `12.89 m³` (raw, no formatting) | `12,89 m³` |

The Indonesian locale uses a comma as the decimal separator (e.g., `12,89` not `12.89`), matching the existing pattern in `driver-dashboard-page.tsx` and `vo-dashboard-page.tsx` (which already used `formatNumber(value, 2)`).

### Files changed

| File | Change |
|---|---|
| `src/components/app/pages/vehicles-page.tsx` | Kapasitas column: `formatNumber(v.maxVolumeM3, 0)` → `formatNumber(v.maxVolumeM3, 2)`. |
| `src/components/app/pages/my-vehicles-page.tsx` | Kapasitas column: raw `{r.maxVolumeM3}` → `formatNumber(r.maxVolumeM3, 2)`. Added `formatNumber` import. |

---

## 4. Google Maps redirect button on checkpoints

### Background

Route checkpoints have GPS coordinates (lat/long), but there was no way to navigate to them. The user wanted a button on each checkpoint that opens Google Maps at that coordinate — useful for drivers navigating to the checkpoint, or for admins verifying the checkpoint location.

### What's new

A "Buka di Google Maps" button now appears on every checkpoint in two places:

1. **Route editor (CheckpointMapEditor)** — in the selected checkpoint's detail panel, right after the lat/long/radius meta line. Opens Google Maps at `https://www.google.com/maps/search/?api=1&query=LAT,LNG` in a new tab.

2. **Transport detail page** — on each checkpoint card in the "Check-in Checkpoint" section, right below the lat/long line. Same URL pattern. Each button is labeled with the checkpoint name in its `title` attribute (e.g., "Buka Checkpoint 2 di Google Maps").

### URL pattern

```
https://www.google.com/maps/search/?api=1&query=LATITUDE,LONGITUDE
```

This is the official Google Maps search URL. On desktop, it opens Google Maps in the browser. On mobile, it typically opens the Google Maps app (if installed) or the mobile web version.

### Button design

- Small pill-shaped link (`<a>` element) with `target="_blank"` + `rel="noopener noreferrer"`.
- Primary color border + light primary background.
- `ExternalLink` icon from lucide-react.
- Text: "Buka di Google Maps" (Indonesian for "Open in Google Maps").

### Files changed

| File | Change |
|---|---|
| `src/components/app/checkpoint-map-editor.tsx` | Added `ExternalLink` import. Added the Google Maps link button after the lat/long/radius line in the selected checkpoint panel. |
| `src/components/app/pages/transport-detail-page.tsx` | Added `ExternalLink` import. Added the Google Maps link button below the lat/long line on each checkpoint card. |

---

## Migration / upgrade notes

### Schema change (run `bun run db:push`)

One new nullable column:

| Table | Column | Type | Default |
|---|---|---|---|
| `DetailShipment` | `volumeM3` | `Float?` | `NULL` |

Existing detail rows keep `volumeM3 = NULL` — their volume continues to be computed from L×W×H (existing behavior). No data migration needed.

### No new permissions

This revision does not add any new RBAC permissions.

### Existing deployments

- Existing production deployments are **unaffected** by the schema change (new column defaults to NULL).
- Existing shipments keep their computed volumes.
- The Google Maps button works out of the box — no API key needed (uses the public Google Maps search URL).

---

## File-by-file change list

### Schema

| File | Change |
|---|---|
| `prisma/schema.prisma` | `DetailShipment.volumeM3 Float?` added. |

### Backend

| File | Change |
|---|---|
| `src/lib/shipment-totals.ts` | `DetailLike` gained `volumeM3?`. New `detailVolumeM3` helper. `computeTotals` + `totalsByMaster` use it. |
| `src/lib/pricing.ts` | `PricedDetailInput` gained `volumeM3?`. New `volumetricKgForDetail` helper. `computePricing` uses it. |
| `src/app/api/v1/shipments/route.ts` | POST inline details forward `volumeM3`. |
| `src/app/api/v1/shipments/[id]/details/route.ts` | POST accepts `volumeM3`. |
| `src/app/api/v1/shipment-details/[id]/route.ts` | PUT accepts `volumeM3`. |

### Frontend

| File | Change |
|---|---|
| `src/lib/client-api.ts` | `DetailShipment` interface gained `volumeM3?`. |
| `src/components/app/pages/shipments-page.tsx` | `DetailForm` + `DetailGroupRow` gained `volumeM3`. Form has a new "Volume langsung" field. Both tables have a new "Volume (m³)" column. |
| `src/components/app/pages/vehicles-page.tsx` | Kapasitas column volume now 2 decimals. |
| `src/components/app/pages/my-vehicles-page.tsx` | Kapasitas column volume now 2 decimals (was raw). Added `formatNumber` import. |
| `src/components/app/checkpoint-map-editor.tsx` | Google Maps button in selected checkpoint panel. |
| `src/components/app/pages/transport-detail-page.tsx` | Google Maps button on each checkpoint card. |
