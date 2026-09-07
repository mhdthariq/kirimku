# 04 — Frontend

## Design system

| Token family | Light | Dark |
|---|---|---|
| Background | near-white `#f8fafc`-tier | deep slate |
| Primary / accent | **emerald** scale | same emerald, adjusted luminance |
| Chart/status colors | semantic greens/ambers/reds | same hues, dark-adjusted |
| Typography | Geist Sans (UI) + Geist Mono (codes) | — |
| Radius / borders | rounded-xl cards, hairline borders | — |

- Defined as CSS variables in `src/app/globals.css` (Tailwind 4 `@theme` tokens), so **dark mode is a variable swap** — no component changes.
- Theme toggle lives in the header (sun/moon) and persists via `next-themes` (localStorage + `class="dark"` on `<html>`).
- Compact, slim scrollbars and consistent 4/8px spacing rhythm across all pages.

## App shell — responsive by breakpoint

`src/components/app-shell.tsx` renders one adaptive navigation:

| Device | Navigation | Content |
|---|---|---|
| **Desktop ≥ 1024px** | Fixed left sidebar (logo top-left, grouped nav, user block at bottom) | Full data tables, multi-column forms |
| **Tablet 768–1023px** | Hamburger → slide-over Sheet drawer | Tables |
| **Phone < 768px** | Hamburger Sheet **+ persistent bottom nav bar** (Beranda, Shipments, Pickup, Delivery, Menu) | Tables switch to **card lists** |

Behaviors:
- Nav groups are **permission-gated** — a kurir never sees Gudang, Tariffs, or Access Control.
- The header shows the page title, theme toggle, and user dropdown (profile, logout).
- The mock-up logo (`public/logo.svg` — emerald hexagon + route mark) appears top-left in the sidebar, the drawer, and the login page.

## Pages (14)

| Route (hash) | Page | Highlights |
|---|---|---|
| `/` (pre-login) | **Login** | Split-screen: brand panel (logo, tagline, feature bullets) + form; demo-account quick-fill chips; error states |
| `#/dashboard` | Dashboard | Stat cards (status funnel, revenue, unpaid), 14-day creation chart (Recharts), recent activity feed |
| `#/shipments` | Shipments | Filterable table (status chips, search) → detail drawer/page: pricing panel, tracking timeline, item CRUD, payments, actions (ready/cancel/price) |
| `#/pickups` | Pickups | Table + create dialog (choose shipment, kurir). **Kurir executor view** (`?mine=true` — sees only own tasks). "Proses / Scan QR" opens the **QR scan dialog**: package checklist, per-item QR image, progress bar, all-scanned → confirm → tracking "Picked-up by [Kurir]" |
| `#/deliveries` | Deliveries | Table + assign dialog. **Detail barang per task** ("Paket" column → checklist dialog). Same **QR scan dialog** for the last mile → all packages scanned + PoD → DELIVERED |
| `#/transports` | Transports | Create dialog (route/vehicle/crew/shipments multi-select), depart/arrive actions |
| `#/vehicles` | Vehicles | CRUD dialogs, status badges, current crew display (driver/kenek via `VehicleAssignment` relations) |
| `#/gudang` | **Gudang** | CRUD dialogs; **no "type" field and zero "Gateway" wording**; optional map location picker (Leaflet) |
| `#/routes` | **Routes & Checkpoints** | Route list + **Leaflet checkpoint editor** (below) |
| `#/customers` | Customers | CRUD dialogs, b2b/b2c type switch |
| `#/tariffs` | Tariffs | CRUD dialogs, b2b/b2c + city pair, volumetric settings |
| `#/invoices` | Invoices | Draft editor with line items, send, settlements; status lifecycle badges |
| `#/unpaid` | Unpaid B2C | Outstanding COD list + record payment |
| `#/access` | Access Control | Tabs: Users / **Roles (edit permission set of any role — system roles owner-only, name/slug locked)** / Employees |
| `#/audit` | Audit Timeline | Global timeline, filters (entity, actor, action, date range), CSV export |

**Every data page** also has a **"Log Aktivitas"** tab showing the audit history *for that module only* (`GET /audit-logs?entityType=<module>`) — requirement #7.

## Modal-based CRUD (requirement #6)

The old UX let users type directly into the table; the rebuilt pattern is:

```
[ + Tambah ]  ──click──►  Dialog (form fields, selects, validation)
                                   │ submit
                                   ▼
                          POST/PUT → API (Zod + RBAC + audit)
                                   │ success
                                   ▼
                        Toast ✓ + table refresh
```

- Create and Edit both use `Dialog`; destructive actions use `AlertDialog` confirmations.
- Form selects are fed by `GET /options` (gudang, vehicles, routes, customers, kurir, tariffs, permissions).
- Client-side validation mirrors server rules; the server remains the authority (Zod).
- No page ever renders an inline editable table row.

## QR handover scan dialog (`src/components/app/qr-scan-dialog.tsx`)

Shared by Pickups and Deliveries (props: `mode`, `task`, `onDone`). One dialog, the whole handover flow:

```
┌─ Scan QR — Pickup PICK-2026-000006 ──────────────────┐
│ Paket ter-scan: 2/2              SEMUA PAKET LENGKAP │  ← Progress bar + counter
│ [ ▯ Tempel/scan QR code di sini…      ] [ Scan ]      │  ← auto-focus; Enter submits
│ ✓ DTL-000001-01  Paket pakaian · oleh Rizky          │  ← green = scanned
│ ▣ [QR] DTL-000001-02  Buku tulis                     │  ← QR image per unscanned pkg
│ ── all scanned ──► [Catatan] [Konfirmasi Pickup …]   │  ← confirm gate unlocks
└──────────────────────────────────────────────────────┘
```

- **Scan input** — USB QR readers and phone-camera keyboards type the `detailCode` and press Enter; each submit calls `POST /{pickups|deliveries}/{id}/scans` and repaints the checklist.
- **QR rendering** — the `qrcode` package renders a small QR per unscanned package, so the flow is demonstrable with a real phone camera (scan the on-screen QR, paste the code).
- **Feedback chips** — `ok` (green), `duplicate` (blue), `unexpected` (amber warning with the unknown payload).
- **Confirm gate** — the confirm section only appears at `allScanned`; delivery mode also requires the PoD receiver name. Completed tasks reopen the dialog read-only as "Riwayat Scan".

## Leaflet checkpoint editor (requirement #10)

On `#/routes`, selecting a route opens a full editor:

- **Click the map** to append a checkpoint (marker + radius circle).
- **Drag markers** to reposition; radius adjustable via a slider (meters, live circle resize) or number input.
- **Reorder** checkpoints (sequence) with up/down buttons; rename inline.
- **Validation:** saving is blocked below **3 checkpoints** (`MIN_CHECKPOINTS`), with an explanatory message; there is **no upper limit**.
- Checkpoint lat/lng and radius persist via `POST/PUT /checkpoints`; deletes that would break the 3-floor are rejected by the API with a clear message.
- Map tiles: OpenStreetMap with a dark-tile CSS layer for dark mode; Leaflet is dynamically imported (`ssr: false`) to keep SSR safe.

The Gudang form reuses a smaller map picker for optional warehouse coordinates.

## State & data fetching

- `src/lib/client-api.ts` — a thin fetch wrapper: attaches `Authorization: Bearer`, unwraps `{data}` / throws on `{error}`, typed generics per resource.
- Each page owns its list state (`useState` + `useEffect` on mount/filter change); mutations then re-fetch the list — simple, predictable, no cache invalidation edge cases.
- Session state (token + user + permissions) lives in a small auth store hydrated from `/auth/me`; on 401 the app redirects to the login screen.
- The **hash router** (`use-hash-route` hook) maps `#/…` to page components — zero server round-trips, deep-linkable, and back-button friendly.

## Accessibility & polish

- Radix-based primitives give focus trapping in dialogs, `aria-*` on tabs/switches, keyboard navigation.
- Sonner toasts for success/error feedback on every mutation.
- Skeleton-free but instant switching (local state) with consistent loading spinners on tables.
- Mobile cards preserve every action via icon buttons and overflow menus — nothing is desktop-only.
