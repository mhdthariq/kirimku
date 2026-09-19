# 10 — Revision Round 9 (DIRECT Form Flow, Photo Detail Buttons, Vehicle Dimensions)

This document covers four related changes delivered together:

1. **Shipment form restructure for DIRECT mode** — Mode Fulfillment dropdown moved BEFORE Gudang Asal/Tujuan; the warehouse fields are hidden when DIRECT is selected (DIRECT doesn't use company warehouses).
2. **DIRECT shipments eligible for transport** — the transport creation API now accepts DIRECT shipments in CREATED / READY_FOR_PICKUP status (skipping the RECEIVED_AT_GUDANG gate that STANDARD shipments must pass).
3. **Photo Detail buttons** — pickups, deliveries, and transport-detail checkpoint photos now have a "Detail Foto" button (or clickable thumbnail) that opens a full-size dialog. Display is gated by `proof_photo.view` (Admin Gudang + Owner).
4. **Transport shipment selector cleanup** — replaced the redundant "(status RECEIVED_AT_GUDANG)" text with a compact `DIRECT` / `STANDARD` badge on each row. Trimmed several over-explained UI banners.
5. **Vehicle dimensions** — added `lengthM` / `widthM` / `heightM` (meters) to the Vehicle schema. When all three are set, `maxVolumeM3` is auto-computed as L × W × H. New "Ukuran" column appears before "Kapasitas" on the Vehicles page.

---

## 1. Shipment form restructure for DIRECT mode

### Background

In revision round 8 we added `fulfillmentMode` (`STANDARD` / `DIRECT`) to `MasterShipment`, but the field appeared AFTER the Gudang Asal / Gudang Tujuan selectors in the create-shipment dialog. This was confusing because:

- For DIRECT shipments, Gudang Asal / Gudang Tujuan are irrelevant (the driver picks up at the customer's location directly and delivers directly to the receiver — no company warehouse involvement).
- The user had to fill in the warehouse fields even though they would be ignored.

### What's new

The create-shipment dialog now has the fields in this order:

1. Customer
2. Customer marker panel (if a customer is selected)
3. Rute (dari daftar tarif)
4. **Mode Fulfillment** ← moved here
5. **Gudang Asal / Gudang Tujuan** ← only shown when `STANDARD` is selected
6. (when DIRECT) A violet info banner explaining the DIRECT mode
7. Discount / Insurance / Pengirim / Penerima / etc.

When `DIRECT` is selected:
- Gudang Asal and Gudang Tujuan fields are hidden.
- A violet banner appears: *"Mode DIRECT — shipment tidak melalui gudang. Driver akan pickup langsung di lokasi pengirim dan mengantar langsung ke penerima. Pastikan alamat Pengirim & Penerima diisi dengan lengkap."*

When `STANDARD` is selected:
- Both gudang fields are shown (existing behavior).
- The auto-fill from tariff origin/destination city still works.

The labels in the dropdown were also shortened:
- Before: `"STANDARD — Lewat gudang (kurir pickup → gudang → transport → gudang tujuan)"`
- After: `"STANDARD — Lewat gudang"`

This keeps the dropdown readable.

### Files changed

| File | Change |
|---|---|
| `src/components/app/pages/shipments-page.tsx` | Moved `Mode Fulfillment` field BEFORE `Gudang Asal / Gudang Tujuan`. Wrapped the gudang fields in a conditional `{form.fulfillmentMode === "STANDARD" && (...)}`. Added a violet info banner for DIRECT mode. Shortened dropdown option labels. |

---

## 2. DIRECT shipments eligible for transport

### Background

The transport creation API (`POST /api/v1/transports`) required every shipment to be in `RECEIVED_AT_GUDANG` status before it could be loaded onto a transport. This is correct for STANDARD shipments (they must go through the warehouse scan flow first), but it blocked DIRECT shipments entirely — DIRECT shipments never go through the warehouse scan flow, so they would never reach `RECEIVED_AT_GUDANG`.

### What's new

The transport creation API now checks `fulfillmentMode`:

| Mode | Allowed statuses for transport loading |
|---|---|
| `STANDARD` | `RECEIVED_AT_GUDANG` only (existing rule) |
| `DIRECT` | `CREATED` or `READY_FOR_PICKUP` (new rule — DIRECT skips the warehouse scan flow) |

The transport-form-dialog on the UI was also updated to fetch from all three status pools (`RECEIVED_AT_GUDANG` + `CREATED` + `READY_FOR_PICKUP`), then filter to keep only:
- STANDARD shipments from the `RECEIVED_AT_GUDANG` pool
- DIRECT shipments from any pool

This way the user can pick from both flows when loading a transport.

### Files changed

| File | Change |
|---|---|
| `src/app/api/v1/transports/route.ts` | POST now checks `fulfillmentMode` and accepts DIRECT shipments in `CREATED` / `READY_FOR_PICKUP` status. |
| `src/components/app/transport-form-dialog.tsx` | Fetches shipments from three status pools (RECEIVED_AT_GUDANG + CREATED + READY_FOR_PICKUP), filters by fulfillment mode, and dedupes by id. |

---

## 3. Photo Detail buttons (pickups, deliveries, checkpoint photos)

### Background

In revision round 8 we added `proof_photo.view` permission and gated the display of photo thumbnails. However, the thumbnails were small (h-16 / h-12) and there was no way to view the photo at full size. The user also requested a "Detail" button on the pickups and deliveries lists to open the photo.

### What's new

A new reusable `PhotoDetailDialog` component was added at `src/components/app/photo-detail-dialog.tsx`. It:
- Shows one or more photos at full size (max-h-72 each).
- Displays metadata: label, recorded-at timestamp, recorded-by name.
- Gates display by `proof_photo.view` — non-permitted users see a "foto terkunci" placeholder instead of the image.
- Opens photos in a new tab when clicked.

The dialog is used in three places:

1. **Pickups page** — new "Detail Foto" button on every pickup row (visible to admins and owner; hidden from kurir executor view). Opens the dialog showing the pickup's `photoUrl` (when present).

2. **Deliveries page** — new "Detail Foto" button on every delivery row. Opens the dialog showing the delivery's `photoUrl` (when present).

3. **Transport detail page** — checkpoint record thumbnails are now clickable. Clicking opens the dialog with all checkpoint records for that checkpoint, so the user can browse them at full size.

### Behavior matrix

| User role | Sees "Detail Foto" button? | Clicking the button shows... |
|---|---|---|
| Owner | Yes (bypasses permissions) | The actual photo at full size |
| Admin Gudang | Yes | The actual photo at full size |
| Kurir / Driver / Kenek | No (button hidden from executor views) | n/a |
| Marketing / Admin Kantor / Vehicle Owner | Yes (button visible) | "Foto bukti tersedia — terkunci" placeholder |

When no photo is set on the row, the dialog shows a "Belum ada foto bukti untuk item ini." placeholder so the user knows there's no photo to view.

### Files changed

| File | Change |
|---|---|
| `src/components/app/photo-detail-dialog.tsx` | **NEW** — reusable dialog component. Accepts `title`, `description`, and an array of `{ url, label, recordedAt, recordedBy }`. Gates image display by `proof_photo.view`. |
| `src/components/app/pages/pickups-page.tsx` | Added `photoPickup` state. Added "Detail Foto" button to the actions column. Renders `PhotoDetailDialog` at the end of the page. |
| `src/components/app/pages/deliveries-page.tsx` | Added `photoDelivery` state. Added "Detail Foto" button to the actions column. Renders `PhotoDetailDialog` at the end of the page. |
| `src/components/app/pages/transport-detail-page.tsx` | Added `photoRecords` state. Wrapped checkpoint record thumbnails in a clickable button. Renders `PhotoDetailDialog` at the end of the page with all records for the clicked checkpoint. |

---

## 4. Transport shipment selector cleanup

### Background

The transport-form-dialog's "Muat shipment" section previously showed the heading "Muat shipment (status RECEIVED_AT_GUDANG)" and each shipment row showed only `MKT-000001 · Customer Name · Destination`. With the new DIRECT mode, the heading was misleading (DIRECT shipments don't go through RECEIVED_AT_GUDANG), and there was no visual indicator of which flow each shipment belonged to.

### What's new

- The heading was shortened to just "Muat shipment" (the `(status RECEIVED_AT_GUDANG)` annotation is no longer accurate for DIRECT shipments).
- Each shipment row now shows a compact badge:
  - `STANDARD` — sky-blue background
  - `DIRECT` — violet background
- The empty-state message was shortened from "Tidak ada shipment siap dimuat saat ini — transport tetap bisa dibuat kosong." to "Tidak ada shipment siap dimuat."

### UI banner cleanup (per user's "delete some of menu with over explanation")

Several over-explained banners in the shipments page were also trimmed:

| Banner | Before | After |
|---|---|---|
| Direct tab banner | "Direct fulfillment — driver ambil langsung di gudang asal dan kirim langsung ke gudang tujuan, tanpa lewat scan gudang." | Removed (the DIRECT badge on each row is sufficient) |
| Regular tab banner | "Regular — kurir pickup → gudang → transport → gudang tujuan → kurir delivery (flow standar)." | Removed |
| Per-gudang tab banner | "Menampilkan data {gudang} — hanya shipment Regular (STANDARD). Shipment Direct ada di tab Direct." | "Gudang {gudang} — Regular only." |
| PICKED_UP status banner | "Shipment PICKED UP sedang dibawa kurir kembali ke gudang. Klik Terima / Scan pada baris untuk scan tiap paketnya (kamera / reader / manual) lalu konfirmasi Tiba di Gudang." | "Shipment PICKED UP — klik Terima / Scan untuk konfirmasi kedatangan paket di gudang." |
| AT_DEST_GUDANG status banner | "Shipment TIBA DI GUDANG TUJUAN — driver transport sudah check-in di checkpoint akhir; paket menunggu Terima / Scan oleh Admin Gudang sebelum berstatus Arrived at (nama gudang) dan bisa ditugaskan ke kurir delivery." | "TIBA DI GUDANG TUJUAN — klik Terima / Scan untuk menerima paket." |

The banners are also visually slimmer (py-1.5 instead of py-2).

### Files changed

| File | Change |
|---|---|
| `src/components/app/transport-form-dialog.tsx` | Removed "(status RECEIVED_AT_GUDANG)" from heading. Added DIRECT/STANDARD badge to each shipment row. Shortened empty-state message. |
| `src/components/app/pages/shipments-page.tsx` | Removed Direct/Regular tab banners. Trimmed per-gudang, PICKED_UP, and AT_DEST_GUDANG banners to single-line. |

---

## 5. Vehicle dimensions (Panjang / Lebar / Tinggi)

### Background

The Vehicle model already had `maxVolumeM3` as a manually-entered field, but there was no way to record the physical cargo box dimensions (length / width / height in meters). The user wanted to:

- Record `Panjang` (length), `Lebar` (width), `Tinggi` (height) in meters (e.g., 4.906m, 1.993m, 2.050m).
- Have `maxVolumeM3` auto-computed as L × W × H when all three dimensions are entered.
- See an "Ukuran" column on the Vehicles page BEFORE the "Kapasitas" column.

### Schema change

```prisma
model Vehicle {
  // …existing fields…
  maxVolumeM3   Float
  /// Revise round 9 — physical cargo box dimensions in meters.
  /// When all three are set, maxVolumeM3 is auto-computed as L × W × H.
  /// Displayed on the Vehicles page as "Ukuran" before "Kapasitas".
  lengthM       Float?
  widthM        Float?
  heightM       Float?
  // …existing fields…
}
```

All three new columns are nullable and default to NULL. Existing vehicles keep their `maxVolumeM3` as-is — no data migration is required. The dimensions are an optional way to express the volume; if any dimension is missing, the existing `maxVolumeM3` value is used as-is.

### API changes

- **`POST /api/v1/vehicles`** — accepts optional `lengthM`, `widthM`, `heightM`. When all three are present and positive, `maxVolumeM3` is auto-computed as `Math.round(L × W × H × 1000) / 1000` (rounded to 3 decimal places). The computed value overrides any `maxVolumeM3` sent on the body.
- **`PUT /api/v1/vehicles/{id}`** — same auto-compute logic on update. Sends `null` to clear a dimension.
- **`GET /api/v1/vehicles`** — returns the new fields (Prisma spreads the full row).
- **`GET /api/v1/options`** — the vehicle dropdown now includes `maxVolumeM3`, `lengthM`, `widthM`, `heightM` (so the transport form can show vehicle dimensions when picking a vehicle).

### UI changes

#### Vehicles page table

A new "Ukuran" column appears BEFORE the "Kapasitas" column:

```
| Nomor Polisi | Ukuran             | Kapasitas         | ... |
|--------------|--------------------|-------------------|-----|
| B 9102 KTA   | P 4.906m           | 3500 kg · 20 m³   | ... |
|              | L 1.993m           |                   |     |
|              | T 2.050m           |                   |     |
| B 7788 KTC   | —                  | 1500 kg · 8 m³   | ... |
```

When dimensions are not set, the cell shows an em-dash.

#### Vehicles page form

The create/edit vehicle form now has a new "Ukuran — Panjang (m)" field with three sub-inputs (P / L / T), placed BEFORE the "Max Volume (m³)" field. The fields use `step="0.001"` to allow millimeter-precision meters (e.g., 4.906).

A live calculation hint appears below the three inputs:

- When all three are filled and positive: `= 20.07 m³`
- When any is missing: `isi ketiganya untuk auto-volume`

The "Max Volume (m³)" field becomes read-only (and shows the computed value) when dimensions are complete. The user can clear the dimensions to override the volume manually.

The "Max Berat (kg)" field was moved out of the grid with "Max Volume (m³)" and now stands alone — the layout is now:

1. Nomor Polisi | Nama / Tipe
2. Status | Max Berat (kg)
3. **Ukuran — Panjang (m)** (3 sub-inputs: P, L, T)
4. **Max Volume (m³)** (auto-computed when dimensions are set)
5. Catatan (full width)
6. Vehicle Owner (full width)

### Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `lengthM Float?`, `widthM Float?`, `heightM Float?` to `Vehicle`. |
| `src/lib/client-api.ts` | `Vehicle` interface gained `lengthM?`, `widthM?`, `heightM?`. `Options.vehicles` items now include `maxVolumeM3`, `lengthM`, `widthM`, `heightM`. |
| `src/app/api/v1/vehicles/route.ts` | POST accepts `lengthM` / `widthM` / `heightM`. Auto-computes `maxVolumeM3` when dimensions are complete. |
| `src/app/api/v1/vehicles/[id]/route.ts` | PUT accepts `lengthM` / `widthM` / `heightM`. Auto-computes `maxVolumeM3` on update. |
| `src/app/api/v1/options/route.ts` | Vehicle dropdown select now includes `maxVolumeM3`, `lengthM`, `widthM`, `heightM`. |
| `src/components/app/pages/vehicles-page.tsx` | Added dimensions fields to `VehicleForm`. Added auto-compute logic in `onSubmit`. New "Ukuran" column before "Kapasitas" in the table. Form layout restructured: dimensions field with 3 sub-inputs + read-only computed volume. |

---

## Migration / upgrade notes

### Schema changes (run `bun run db:push` after pulling this code)

Three new nullable columns are added to `Vehicle`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `lengthM` | `Float?` | `NULL` | Cargo box length in meters (e.g., 4.906). |
| `widthM` | `Float?` | `NULL` | Cargo box width in meters (e.g., 1.993). |
| `heightM` | `Float?` | `NULL` | Cargo box height in meters (e.g., 2.050). |

No data migration is required — existing vehicles keep their `maxVolumeM3` value as-is. The dimensions are an optional way to express the volume; if any dimension is missing, the existing `maxVolumeM3` value is used.

### No new permissions

This revision does not add any new permissions. The `proof_photo.view` permission (added in revision round 8) is reused for the new `PhotoDetailDialog`.

### Existing deployments

- Existing production deployments are **completely unaffected** by this revision.
- Existing vehicles keep their `maxVolumeM3` value — dimensions default to NULL.
- Existing shipments continue to behave as `STANDARD` (the default) — DIRECT is opt-in per shipment.
- The transport creation API now accepts DIRECT shipments in CREATED/READY_FOR_PICKUP status, but this is purely additive — STANDARD shipments must still be RECEIVED_AT_GUDANG.

---

## File-by-file change list

### Schema

| File | Change |
|---|---|
| `prisma/schema.prisma` | `Vehicle.lengthM Float?`, `Vehicle.widthM Float?`, `Vehicle.heightM Float?`. |

### Backend

| File | Change |
|---|---|
| `src/app/api/v1/transports/route.ts` | POST accepts DIRECT shipments in CREATED/READY_FOR_PICKUP status (STANDARD still requires RECEIVED_AT_GUDANG). |
| `src/app/api/v1/vehicles/route.ts` | POST accepts `lengthM`/`widthM`/`heightM`; auto-computes `maxVolumeM3` when dimensions complete. |
| `src/app/api/v1/vehicles/[id]/route.ts` | PUT accepts dimensions; auto-computes `maxVolumeM3` on update. |
| `src/app/api/v1/options/route.ts` | Vehicle dropdown select now includes dimensions + maxVolumeM3. |
| `src/lib/client-api.ts` | `Vehicle` interface gained `lengthM`/`widthM`/`heightM`. `Options.vehicles` items include the same. |

### Frontend

| File | Change |
|---|---|
| `src/components/app/photo-detail-dialog.tsx` | **NEW** — reusable `PhotoDetailDialog` component. |
| `src/components/app/pages/shipments-page.tsx` | Moved `Mode Fulfillment` BEFORE Gudang Asal/Tujuan. Hid gudang fields when DIRECT. Added DIRECT info banner. Trimmed over-explained banners. |
| `src/components/app/pages/pickups-page.tsx` | Added "Detail Foto" button + `PhotoDetailDialog` for pickup photos. |
| `src/components/app/pages/deliveries-page.tsx` | Added "Detail Foto" button + `PhotoDetailDialog` for delivery photos. |
| `src/components/app/pages/transport-detail-page.tsx` | Checkpoint thumbnails are now clickable; opens `PhotoDetailDialog` with all records for that checkpoint. |
| `src/components/app/pages/vehicles-page.tsx` | Added dimensions fields to form. Added "Ukuran" column before "Kapasitas". Auto-compute `maxVolumeM3` from L × W × H. |
| `src/components/app/transport-form-dialog.tsx` | Removed redundant "(status RECEIVED_AT_GUDANG)" text. Added DIRECT/STANDARD badge per row. Fetches from three status pools. |

### Docs

| File | Change |
|---|---|
| `docs/10-revision-round-9.md` | This document. |
| `docs/README.md` | Revision round 9 summary added to the revision history + document index. |
