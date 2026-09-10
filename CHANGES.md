# Changes — Gudang data separation (revisi pemisahan data antar gudang)

This round implements warehouse-level data isolation across the whole app,
plus per-gudang browsing tabs for the owner.

## 1. Every karyawan belongs to one gudang (`Employee.warehouseId`)

- **`prisma/schema.prisma`**: `Employee.warehouse` relation added (with the
  `Warehouse.employees[]` back-relation) — the field already existed, now it
  is a first-class relation and the single source of gudang membership.
- **`src/lib/gudang-scope.ts`** (new): universal scoping helpers.
  `scopeForUser()` resolves the user's gudang: the **owner (or `*`
  permissions) is unscoped**; **every other user is scoped to their
  employee's gudang** — an account without a gudang sees no operational data.
- **`src/lib/rbac.ts`**: the obsolete `warehouse.scope_own` permission was
  removed (scoping is no longer permission-based — it applies to every
  non-owner role). `ensureRbac()` now prunes permissions that were removed
  from the catalog so the count check stays in sync.
- **`src/lib/seed.ts`**: every seeded employee is stationed at a gudang
  (default Jakarta Pusat); new demo account **`ratna` (Admin Gudang ·
  Gudang Bandung)** demonstrates the isolation. A backfill assigns the first
  gudang to unbound employees of pre-existing databases.

## 2. Data visibility — gudang sendiri saja, owner melihat semua

Ownership follows the physical package location in the lifecycle:

| Entity | Gudang(s) |
|---|---|
| Shipment CREATED → RECEIVED_AT_GUDANG | gudang asal (arrivedWarehouseId saat sudah diterima) |
| Shipment IN_TRANSPORT | kedua ujung rute (asal + tujuan) |
| Shipment ARRIVED_AT_GUDANG / DELIVERED | gudang tujuan |
| Pickup | gudang asal master (tetap, histori milik cabang pelaksana) |
| Delivery | gudang posisi master saat ini |
| Transport | gudang asal + tujuan rute (+ shipment yang dimuat) |

- APIs now scope their responses: `GET /shipments`, `/pickups`,
  `/deliveries`, `/transports`, `/gudang` (workspace), `/dashboard`
  (operational counters & recent shipments), `/audit-logs` (entries about
  shipment/pickup/delivery/transport/payment entities are filtered to the
  scope; company-wide entities such as customers/invoices remain visible),
  and `/unpaid`. Each list row also carries **`gudangIds`** so the owner UI
  can group rows per gudang.
- `GET /shipments/{id}` **rejects cross-gudang access with 403** ("Shipment
  ini berada di gudang lain — data terpisah antar gudang").
- `POST /transports/{id}/arrive` now stamps `arrivedWarehouseId` on every
  shipment (destination gudang) so the scoping stays accurate after arrival.
- `AuthUser` / login / me responses include `warehouseId` & `warehouseName`
  (the badge "Data gudang Anda: …" uses it).

## 3. Owner gets per-gudang tabs on the four operational menus

Before: `Daftar | Log Aktivitas`
After (owner): `Daftar | Gudang Jakarta Pusat | Bandung | Surabaya | … | Log Aktivitas`

- **`src/components/app/gudang-tabs.tsx`** (new): shared tab triggers (one
  per active gudang — the "Gudang " prefix is stripped for short labels),
  the active-gudang banner, and the staff scope badge.
- **`shipments-page` / `pickups-page` / `deliveries-page` /
  `transports-page`**: controlled tabs; owner-only gudang tabs filter rows by
  `gudangIds`; every other role keeps `Daftar | Log Aktivitas` and only ever
  receives their own gudang's rows (scope badge in the header).

## 4. Gudang menu is owner-only

- **`app-shell.tsx`**: the "Gudang" nav item is `ownerOnly` — hidden for
  everyone else. **`gudang-page.tsx`** gates direct `#/gudang` access with a
  friendly message (staff gudang keep working through Shipments — "Terima /
  Scan" on PICKED_UP rows, walk-in on shipment detail).

## 5. Access Control → Employees: gudang assignment UI

- New **Gudang** column (warehouse badge / "belum ditugaskan") and a
  **Gudang Penempatan** select in the create/edit dialog
  (`GET /employees` now includes the `warehouse` relation). Employee create
  and update already accepted `warehouseId` server-side.

## 6. Login screen

- Demo account list updated: hints now show each account's gudang, plus
  **ratna** (Admin Gudang · Bandung) for trying the isolation live.

---

# Previous round — Gudang menu restructure, walk-in & scan UX, true responsive layout

This round builds on the previous update (dialog max-height, camera scan fix,
"Scan Kedatangan" shortcut, PWA review — see git history / previous notes).

## 1. Menu "Gudang" restructured (Operasional → Gudang & Armada)

- **`src/components/app/app-shell.tsx`**: removed the "Gudang" (`#/gudang-ops`)
  item from the **Operasional** group. The "Gudang" menu now lives once, in
  **Gudang & Armada**, and points to `#/gudang` (the former "Master Gudang").
  Its visibility is `warehouse.view` **or** `shipment.view`, so Staff Gudang
  (warehouse-scoped, no warehouse master rights) still reach their workspace.
- **`src/app/page.tsx`**: the `gudang-ops-page` route was removed; old bookmarks
  `#/gudang-ops` are permanently redirected to `#/gudang`.
- **`src/components/app/pages/gudang-ops-page.tsx`**: deleted. Its features were
  not lost — they moved:
  - *Kedatangan* (arrival queue scanning) → **Shipments** (see §3)
  - *Pelanggan Langsung* (walk-in confirm) → **Shipment detail** (see §4)
  - *Isi Gudang* (per-gudang contents) → **Gudang page** tab (see §2)

## 2. Gudang page — new "Isi Gudang" tab

- **`src/components/app/pages/gudang-page.tsx`**: tabs are now
  **Daftar | Isi Gudang | Log Aktivitas**. "Isi Gudang" (visible only with
  `shipment.view`) shows per-gudang cards — held packages/shipments/kg, unpaid
  counts, expandable kiriman list, and "Notify Marketing" for unpaid ones.
- **`src/components/app/notify-marketing-dialog.tsx`** (new): extracted shared
  dialog for the notify-marketing flow.
- Card title reworked for phones: name + city badge stack vertically instead of
  truncating each other.

## 3. Scan arrive at Gudang — inside the Shipments "Picked Up" view

- **`src/components/app/pages/shipments-page.tsx`**: every row with status
  `PICKED_UP` now has a **"Terima / Scan"** action button (permission
  `shipment.confirm_arrival`), opening the same camera/reader/manual scan
  dialog directly — no detour through another menu. An info banner explains
  the flow when the *Picked Up* filter is active.
- The header **"Scan Kedatangan"** quick-access picker is kept as a
  queue-overview entry point; both use the shared `ArrivalScanDialog`.
- The list now also mirrors the gudang workspace scope for scoped users.

## 4. Walk-in (customer comes straight to the Gudang)

- **`src/components/app/walk-in-dialog.tsx`** (new): the walk-in confirm
  dialog, extracted from the old gudang-ops page.
- **Shipment detail**: next to "Submit for Pickup", shipments that are still
  `CREATED` / `READY_FOR_PICKUP` now show a **"Tiba di Gudang"** button —
  visible **only** to users with `shipment.confirm_arrival` (Admin Gudang &
  anyone granted it). One click + gudang choice confirms arrival without
  scanning; the journey starts at that gudang (backend `POST
  /shipments/{id}/arrive` mode `walk_in` — unchanged).

## 5. Responsive overhaul (the big one)

Root causes found while testing 1920×1080, 1366×768, 768×1024 and 390×844:

- **`src/components/ui/dialog.tsx` / `alert-dialog.tsx`** — dialogs were a
  scrollable `grid` where tall forms pushed the submit button out of view.
  Now a flex column with a **sticky footer bar** (`bg-background/95`,
  backdrop-blur, border-t, negative margins over the dialog padding): the
  Batal/Submit buttons are always visible at every resolution, including
  behind the phone keyboard. Header got `shrink-0 pr-8` so titles never run
  under the close (X) button; added `overscroll-contain`; width is
  `w-[calc(100%-1.5rem)]` capped by `max-h-[calc(100dvh-2rem)]`.
- **`src/components/ui/tabs.tsx`** — tab lists overflowed on narrow screens
  (page-wide horizontal scroll on phones). Now a full-width segmented control
  on mobile (equal flex segments, hidden scrollbar, horizontal scroll
  fallback when labels are long) and the classic inline pill list ≥sm.
- **`src/components/ui/card.tsx`** — Card/CardHeader/CardContent lacked
  `min-w-0`. Grid/flex "automatic minimum size" made cards blow past their
  grid track whenever content contained `whitespace-nowrap` items (the
  dashboard status chart with long badges was the worst offender — cards were
  788px wide inside a 728px track at 768px). Fixed globally.
- **`src/components/app/data-table.tsx`** — toolbar wrapper now
  `min-w-0 max-w-full flex-wrap`, so filter chips can never push the page
  wider than the viewport.
- **Status filter chips** (`shipments-page`, `pickups-page`,
  `deliveries-page`, `transports-page`, `invoices-page`): changed from a
  single non-shrinkable row (which overflowed ~463px on phones/tablets and
  HID filters like Delivered/Cancelled behind a scroll) to wrapping pills.

### QC performed (browser-verified at every resolution)

- 1920×1080 (desktop), 1366×768 (laptop), 768×1024 (tablet), 390×844 (phone):
  all 14 pages scanned for horizontal overflow — 0 overflows remaining
  (before: dashboard + 5 list pages overflowed on tablet/phone).
- Dialogs measured in-viewport with reachable submit at all 4 resolutions,
  including the tallest (Gudang create with Leaflet map, 890px tall on
  desktop, scrollable + sticky footer on laptop/phone).
- End-to-end flows tested with a real browser session:
  - walk-in confirm (MKT-000006 → RECEIVED_AT_GUDANG),
  - Picked Up row → "Terima / Scan" → "Scan Semua Paket" → "Konfirmasi Tiba
    di Gudang" (MKT-000002 → RECEIVED_AT_GUDANG),
  - permission gating (Marketing account sees none of the new buttons),
  - legacy `#/gudang-ops` redirect, mobile bottom nav & hamburger sheet,
  - "Isi Gudang" tab + Notify Marketing dialog.
- Visual review (screenshots) of login, dashboard, shipments, gudang,
  dialogs on phone/tablet/laptop/desktop — no clipped/overlapping UI.
