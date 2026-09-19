# 08 — Revision Round 7 (Preview Mode, Partner Alignment, Customer Gudang, Pickup Address)

This document covers five changes delivered together:

1. **Preview mode** — a new third runtime mode between Development and Production.
2. **"Lacak Paket" link** — visible inside the authenticated app in Dev + Preview only.
3. **Partner Alignment** — Marketing partners can be aligned to a specific Gudang (or "Umum" / general).
4. **Customer Gudang attachment** — Customers can be attached to a specific Gudang (or "Umum") for gudang-scoped data separation.
5. **Customer marker on shipment creation** — visual indicator showing the difference between the Customer's DB record and the per-shipment typed Pengirim data.
6. **Pickup address** — kurir sees the pickup address (sourced from `MasterShipment.pengirimAddress`) on the Pickups list, Kurir Dashboard, and the QR scan dialog.

---

## 1. Preview mode

### Background

Previously the app had two runtime modes selected purely by `NODE_ENV`:

| Old mode | Trigger | Demo panel | Corporate ID field |
|---|---|---|---|
| Development | `NODE_ENV !== "production"` | Visible | Hidden |
| Production | `NODE_ENV === "production"` | Hidden | Visible (required) |

This binary split made staging/UAT builds awkward: a compiled build behaved exactly like production (no demo accounts, Corporate ID required), but testers needed demo accounts to log in quickly without setting up real tenants.

### New three-tier model

The app now ships with **three** runtime modes. The new middle tier is **Preview** — a compiled build that still shows the Demo Account quick-fill panel AND routes every request through the license server (just like production). The Corporate ID is pre-filled with the constant `PREVIEW_CORP_ID` (default `"TRIAL"`) so testers can log in with one click, but the value is editable so they can switch tenants.

| Mode | Trigger | Demo panel | Corporate ID field | License server contacted? |
|---|---|---|---|---|
| Development | `NODE_ENV !== "production"` | Visible | Hidden | No |
| **Preview** | `NODE_ENV === "production"` **AND** `PREVIEW_MODE === "true"` | **Visible** | **Visible (pre-filled `"TRIAL"`)** | **Yes** |
| Production | `NODE_ENV === "production"` otherwise | Hidden | Visible (required) | Yes |

### How to run in Preview mode

The app needs **both** the server-side flag and the client-side flag set so that the SSR-rendered HTML and the hydrated client agree on which variant to render. The package.json includes two new scripts:

```bash
bun run build:preview   # next build with PREVIEW_MODE=true inlined into the bundle
bun run start:preview    # bun .next/standalone/server.js with PREVIEW_MODE=true at runtime
```

Or set the env vars manually:

```bash
# Build time
PREVIEW_MODE=true NEXT_PUBLIC_PREVIEW_MODE=true NEXT_PUBLIC_RUNTIME_MODE=preview bunx next build

# Run time
NODE_ENV=production PREVIEW_MODE=true bun .next/standalone/server.js
```

### Override the trial Corporate ID

By default, Preview pre-fills the Corporate ID with `"TRIAL"`. Override with the `PREVIEW_CORP_ID` env var if your license server has a different trial account per staging environment:

```bash
PREVIEW_CORP_ID=STAGING-ACME         # server-side
NEXT_PUBLIC_PREVIEW_CORP_ID=STAGING-ACME   # client-side (must match)
```

### What changed in code

- **New module `src/lib/runtime-mode.ts`** — single source of truth for the runtime mode. Exports both server-side constants (`RUNTIME_MODE`, `IS_DEV`, `IS_PREVIEW`, `IS_PROD`, `PREVIEW_CORP_ID`, `SHOW_DEMO_ACCOUNTS`, `SHOW_CORP_ID`, `SHOW_TRACKING_LINK`, `MODE_LABEL`) and browser-safe mirrors (`NEXT_PUBLIC_*`).
- **`src/lib/tenant-context.ts`** — re-exports `IS_DEV` / `IS_PREVIEW` / `IS_PROD` / `RUNTIME_MODE` / `PREVIEW_CORP_ID` from `runtime-mode.ts` (backward-compatible re-export). The dev-bypass branch in `resolveTenantContext()` uses `IS_DEV` (correctly false for Preview), so both Preview and Production route through the license server.
- **`src/components/app/login-screen.tsx`** — rewritten to read the new `NEXT_PUBLIC_*` constants. Shows the Corporate ID field when `SHOW_CORP_ID` (Preview + Production), shows the Demo Account panel when `SHOW_DEMO_ACCOUNTS` (Dev + Preview), shows the runtime-mode banner (`DEV Mode` / `PREVIEW Mode`) in Dev + Preview, pre-fills the Corporate ID with `PREVIEW_CORP_ID` in Preview.
- **`package.json`** — added `build:preview` and `start:preview` scripts.
- **`.env.example`** — documented the three modes and the new env vars.

### Backward compatibility

Existing deployments that don't set `PREVIEW_MODE` keep the exact same behavior as before — they run in Production mode. No env var changes are required for existing deployments.

---

## 2. "Lacak Paket" link

The customer-facing tracking page at `/tracking-paket` is reachable directly via URL in all modes. Inside the authenticated app, a redirect link is shown only in **Dev + Preview** so internal staff can quickly check a tracking page without leaving the app.

### Where the link appears

- **Login screen** — a full-width button below the Demo Account panel.
- **Top-right account dropdown menu** — labeled "Lacak Paket" with a `Search` icon, opens `/tracking-paket` in a new tab.

In **Production** the in-app link is hidden — customers reach the public tracking page only via the standalone `/tracking-paket` URL, so end customers don't see the link when the app is in production mode.

### What changed in code

- **`src/components/app/login-screen.tsx`** — added the bottom link section gated by `NEXT_PUBLIC_SHOW_TRACKING_LINK`.
- **`src/components/app/app-shell.tsx`** — added a `DropdownMenuItem` linking to `/tracking-paket` (target `_blank`) gated by `NEXT_PUBLIC_SHOW_TRACKING_LINK`.

---

## 3. Partner Alignment (Marketing ↔ Gudang)

### Background

Before this revision, a Marketing partner had no explicit Gudang affiliation. The Partners page listed every Marketing partner in one flat list and the owner had no way to answer "which Gudang is Budi affiliated with?".

### What's new

Each Partner (Marketing only — Vehicle Owner partners are excluded because their vehicles move freely between gudangs) can now be aligned to a specific Gudang via `Partner.warehouseId` (nullable). Null means **"Umum" / general** — the partner serves every gudang.

### Schema

```prisma
model Partner {
  // …existing fields…
  /// Revise round 7 — Partner Alignment: optional gudang this marketing
  /// partner is aligned to. Null = "umum" (general — serves every gudang).
  warehouseId          Int?
  warehouse            Warehouse?            @relation("PartnerAlignmentWarehouse", fields: [warehouseId], references: [id])
}

model Warehouse {
  // …existing fields…
  /// Revise round 7 — marketing partners aligned to this gudang.
  alignedPartners        Partner[]  @relation("PartnerAlignmentWarehouse")
}
```

### API

- `GET /api/v1/partners` — now includes `warehouseId` and `warehouseName` on each row.
- `PUT /api/v1/partners/{id}` — accepts an optional `warehouseId` field (Int | null | `"general"` | `"none"`). Validated against the Warehouse table. The change is audit-logged with both `before.warehouseId` and `after.warehouseId`.
- `GET /api/v1/options` — the `marketingPartners` dropdown now includes `warehouseId` and `warehouseName` so the Customers page can show the alignment next to each option ("Budi · Gudang Medan").

### UI

- **Partners page** (`src/components/app/pages/partners-page.tsx`) — new "Gudang" column showing either a colored chip with the warehouse name + city icon (when aligned) or an "Umum" badge (when general). The edit dialog now combines Profit Share configuration AND Gudang alignment in a single "Atur Partner" form. Marketing-only — Vehicle Owner rows show "—" in this column.

---

## 4. Customer Gudang attachment (gudang-scoped customer lists)

### Background

Customers were previously visible to every Admin Gudang / Staff Gudang regardless of which gudang they belonged to. There was no way to scope a customer to a specific gudang — every customer was effectively "umum".

### What's new

Each Customer can now be attached to a specific Gudang via `Customer.warehouseId` (nullable). Null means **"Umum" / general** — visible to every gudang. When set, only that gudang's admins/staff (plus the owner / marketing owner) see this customer in their lists and dropdowns.

### Schema

```prisma
model Customer {
  // …existing fields…
  /// Revise round 7 — Gudang attachment for customers. Null = "umum"
  /// (general — visible to every gudang). When set, the customer is
  /// attached to a specific gudang and only that gudang's admin/staff
  /// see it in their customer list (gudang data separation).
  warehouseId        Int?
  warehouse          Warehouse?       @relation("CustomerWarehouse", fields: [warehouseId], references: [id])
}

model Warehouse {
  // …existing fields…
  /// Revise round 7 — customers attached to this gudang.
  customers              Customer[]  @relation("CustomerWarehouse")
}
```

### API

- `GET /api/v1/customers` — now scopes by gudang: scoped users (Admin Gudang, Staff Gudang) only receive customers where `warehouseId IS NULL OR warehouseId = <their gudang>`. Owners / `*` permissions see all customers. The response includes `warehouseId` and `warehouseName`.
- `POST /api/v1/customers` — accepts an optional `warehouseId` field (Int | null | `"general"` | `"none"`). Validated against the Warehouse table.
- `GET /api/v1/customers/{id}` — includes `warehouseId` and `warehouseName`. Gudang scope is enforced the same way as the list endpoint.
- `PUT /api/v1/customers/{id}` — accepts `warehouseId` (admin/owner only — Marketing users cannot reassign the gudang of their customers).
- `GET /api/v1/options` — the `customers` dropdown uses the same gudang-scoped filter so that shipment creation, invoice line creation, etc. only offer customers the current user is allowed to see. Each option also includes `warehouseId` and `warehouseName`.

### UI

- **Customers page** (`src/components/app/pages/customers-page.tsx`) — new "Gudang" column showing the warehouse name as a colored chip (when attached) or an "umum" badge (when general). The create/edit dialog now has a "Gudang" dropdown (admin/owner only) listing every active gudang plus an "Umum (terlihat oleh semua gudang)" sentinel. The Marketing (PIC) dropdown now also shows each partner's alignment ("Budi · Gudang Medan" / "Budi · Umum").

### Behavior matrix

| Logged-in user | Sees customers attached to my gudang | Sees general ("umum") customers | Sees customers attached to OTHER gudangs |
|---|---|---|---|
| Owner / `*` permissions | Yes | Yes | Yes |
| Admin Gudang / Staff Gudang | Yes | Yes | **No** |
| Marketing | Yes (only their own customers) | Yes (only their own) | No |

---

## 5. Customer marker on shipment creation

### Background

When creating a Shipment, the Pengirim (sender) fields are auto-filled from the selected Customer's master record (Name / Phone / Email / Address). However, every field is editable so the user can override per-shipment (e.g. a different drop-off person). Previously there was no visual indicator showing which values were overrides and which still matched the customer's DB record.

### What's new

- **"Customer terpilih (dari database)" panel** — appears immediately below the Customer dropdown whenever a customer is selected. Lists the customer's master record: Code, Type, Name (DB), Phone (DB), Email (DB), Address (DB).
- **Override highlighting on Pengirim fields** — each of the four Pengirim inputs (Name / Phone / Email / Address) is highlighted with an amber border + light amber background when its value diverges from the customer's DB record. The hint label below each field also changes to "Diubah dari data customer — override per-shipment."

### Important — NOT on the resi

This marker is a **UI-only** aid during shipment creation. Nothing about the customer's master record or the override status is stored on the shipment beyond what was already stored. The resi still prints exactly the Pengirim values that the user typed into the form. The customer marker exists purely so the staff can see at a glance "I changed the phone number for this shipment" or "I'm using a different address for this drop-off."

### What changed in code

- **`src/components/app/pages/shipments-page.tsx`** — added the customer-marker panel + per-field amber highlighting in the create-shipment dialog. The Pengirim Field components now compare `form.pengirim*` to `selectedCustomer.*` and conditionally apply the `border-amber-400/60 bg-amber-50` className and the "Diubah dari data customer — override per-shipment." hint.

---

## 6. Pickup address shown to kurir

### Background

The Pickups list and the kurir's QR scan dialog previously showed only the customer name, origin/destination cities, and the package count. The kurir had no way to see WHERE to pick up the package — they had to call the office to ask for the address.

### What's new

The pickup's address is now shown in three places:

1. **Pickups page list** (`/pickups`) — a colored "Alamat Pickup" panel under the customer name + route line, with `MapPin` icon. Includes the sender name (User icon) and a `tel:` link for the sender phone.
2. **Kurir Dashboard** (`#/dashboard-kurir`) — same address panel under each pickup task in the "Pickup Saya" list.
3. **QR Scan Dialog** (opens when the kurir clicks "Proses" or "Scan QR") — a dedicated "Alamat Pickup" panel between the dialog header and the scan console. If no address is set, a warning banner is shown instead: "Alamat pickup belum diisi — hubungi admin gudang / staff untuk alamat penjemputan sebelum berangkat."

### Source of the address

The address comes from `MasterShipment.pengirimAddress` — the per-shipment sender address the staff typed into the Pengirim section of the shipment form. This is **NOT** the customer's master DB record address, because the staff may have overridden it for this specific shipment (see change #5 above).

The kurir also sees the sender name (`pengirimName`) and a `tel:` link to the sender phone (`pengirimPhone`), so they can call the customer on arrival.

### What changed in code

- **Prisma** — no schema change. `MasterShipment.pengirimAddress` / `pengirimPhone` / `pengirimName` already existed.
- **`src/lib/client-api.ts`** — `PickupTask` interface gained optional `pickupAddress`, `pickupContact`, `pickupSenderName` fields.
- **`src/app/api/v1/pickups/route.ts`** — GET now returns those three fields by reading from `p.master.pengirimAddress` etc.
- **`src/app/api/v1/dashboard/kurir/route.ts`** — GET now selects `pengirimName / pengirimPhone / pengirimAddress` on the master and includes them on each pickup row.
- **`src/components/app/pages/pickups-page.tsx`** — table column renamed from "Customer & Rute" to "Customer & Alamat Pickup" and now renders the address panel.
- **`src/components/app/pages/kurir-dashboard-page.tsx`** — pickup list item now includes the address panel + tel: link.
- **`src/components/app/qr-scan-dialog.tsx`** — `ScanTaskInfo` interface gained optional `pickupAddress / pickupContact / pickupSenderName`. When `isPickup` is true, the dialog renders an "Alamat Pickup" panel after the header. If absent, an amber warning banner is shown.

---

## Migration / upgrade notes

### Schema changes (run `bun run db:push` after pulling this code)

Two new nullable columns are added:

| Table | Column | Type | Notes |
|---|---|---|---|
| `Partner` | `warehouseId` | `Int?` | FK to `Warehouse.id` via the `PartnerAlignmentWarehouse` relation. Null = Umum. |
| `Customer` | `warehouseId` | `Int?` | FK to `Warehouse.id` via the `CustomerWarehouse` relation. Null = Umum. |

Existing rows default to `NULL` for both, which means existing customers and marketing partners remain visible to every gudang until an admin explicitly attaches them. **No data migration is required** — the upgrade is opt-in per row.

### New env vars (all optional)

| Env var | Default | Purpose |
|---|---|---|
| `PREVIEW_MODE` | unset (= Production) | Server-side flag that enables Preview mode. Must be `"true"` (string). |
| `NEXT_PUBLIC_PREVIEW_MODE` | unset (= Production) | Client-side mirror of `PREVIEW_MODE`. **Must match the server-side flag** so SSR + hydration agree. |
| `NEXT_PUBLIC_RUNTIME_MODE` | unset (auto-detected) | Optional explicit override. Set to `"development"` / `"preview"` / `"production"` to skip auto-detection on the client. |
| `PREVIEW_CORP_ID` | `"TRIAL"` | Server-side default Corporate ID pre-filled on the login screen in Preview mode. |
| `NEXT_PUBLIC_PREVIEW_CORP_ID` | `"TRIAL"` | Client-side mirror of `PREVIEW_CORP_ID`. |

### New npm scripts

| Script | What it does |
|---|---|
| `bun run build:preview` | `next build` with `PREVIEW_MODE=true NEXT_PUBLIC_PREVIEW_MODE=true NEXT_PUBLIC_RUNTIME_MODE=preview` baked into the bundle. |
| `bun run start:preview` | `bun .next/standalone/server.js` with `NODE_ENV=production PREVIEW_MODE=true` at runtime. |

### Existing deployments

Existing production deployments are **completely unaffected** by this revision. They don't set `PREVIEW_MODE`, so they continue running in Production mode exactly as before. The Partner / Customer `warehouseId` columns default to NULL, so existing rows remain visible to every gudang until an admin explicitly attaches them.

---

## File-by-file change list

### New files

| File | Purpose |
|---|---|
| `src/lib/runtime-mode.ts` | Single source of truth for the three runtime modes. |
| `docs/08-revision-round-7.md` | This document. |

### Modified files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `warehouseId Int?` + warehouse relation on `Partner` and `Customer`; added back-relations on `Warehouse`. |
| `package.json` | Added `build:preview` and `start:preview` scripts. |
| `.env.example` | Documented the three runtime modes + the new env vars. |
| `src/lib/tenant-context.ts` | Re-exports `IS_DEV` / `IS_PREVIEW` / `IS_PROD` / `RUNTIME_MODE` / `PREVIEW_CORP_ID` from `runtime-mode.ts`. Dev-bypass branch uses `IS_DEV`. |
| `src/lib/client-api.ts` | `PartnerRow` got `warehouseId` + `warehouseName`. `Customer` got `warehouseId` + `warehouseName`. `Options.customers` got `warehouseId` + `warehouseName`. `Options.marketingPartners` got `warehouseId` + `warehouseName`. `PickupTask` got `pickupAddress` + `pickupContact` + `pickupSenderName`. |
| `src/components/app/login-screen.tsx` | Rewritten to read `NEXT_PUBLIC_*` constants. Corporate ID pre-filled with `PREVIEW_CORP_ID` in Preview. Mode banner + tracking link. |
| `src/components/app/app-shell.tsx` | Added "Lacak Paket" item in the account dropdown menu (Dev + Preview only). |
| `src/components/app/pages/partners-page.tsx` | New "Gudang" column + alignment dropdown in the edit dialog. |
| `src/components/app/pages/customers-page.tsx` | New "Gudang" column + Gudang dropdown in the create/edit dialog. |
| `src/components/app/pages/shipments-page.tsx` | Customer marker panel + per-field override highlighting. |
| `src/components/app/pages/pickups-page.tsx` | "Customer & Alamat Pickup" column with address panel + tel: link. |
| `src/components/app/pages/kurir-dashboard-page.tsx` | Pickup list item shows address panel + tel: link. |
| `src/components/app/qr-scan-dialog.tsx` | `ScanTaskInfo` extended; pickup dialog renders "Alamat Pickup" panel. |
| `src/app/api/v1/options/route.ts` | Customers query now scoped by gudang; includes `warehouseId` + `warehouseName`. Marketing partners query includes `warehouseId` + `warehouseName`. |
| `src/app/api/v1/customers/route.ts` | GET scoped by gudang + includes warehouse info. POST accepts `warehouseId`. |
| `src/app/api/v1/customers/[id]/route.ts` | GET includes warehouse info. PUT accepts `warehouseId` (admin/owner only). |
| `src/app/api/v1/partners/route.ts` | GET includes `warehouseId` + `warehouseName`. |
| `src/app/api/v1/partners/[id]/route.ts` | PUT accepts `warehouseId`. Audit-logged. |
| `src/app/api/v1/pickups/route.ts` | GET returns `pickupAddress` + `pickupContact` + `pickupSenderName`. |
| `src/app/api/v1/dashboard/kurir/route.ts` | Selects `pengirim*` on master; returns them on each pickup row. |
