# 11 — Revision Round 10 (Marketing Gudang Alignment, Admin Gudang Customer CRUD, Seed Updates)

This document covers four related changes delivered together:

1. **Marketing partner Gudang affiliation on creation** — when creating a Marketing partner from the Access UI, you can now select their Gudang affiliation. If not selected, the partner is "umum" (general). Also editable from the partner edit form.
2. **Customer Gudang auto-inheritance** — customers created by a Marketing partner aligned to a gudang auto-inherit that gudang. Marketing "umum" partners must pick a gudang manually for each customer they create.
3. **Admin Gudang customer CRUD** — Admin Gudang now has `customer.view/create/update/delete` permissions. Customers they create are auto-attached to their own gudang.
4. **Seed data updates** — all customers now have `email`; shipments now carry an explicit `pengirim*` snapshot (Name/Phone/Email/Address); new DIRECT shipment `MKT-000009` + transport `TRP-2026-000004` demo the DIRECT flow end-to-end; new "umum" marketing partner `adit` demonstrates the manual gudang pick; budi is now aligned to Gudang Medan.

---

## 1. Marketing partner Gudang affiliation on creation

### Background

In revision round 7 we added `Partner.warehouseId` (nullable) and a Partner Alignment column on the Partners page. But the Access UI's "Tambah Partner" form had no way to set the alignment at creation time — the partner was always created "umum" and the owner had to open the Partners page to set the alignment afterwards.

### What's new

- **`ensurePartnerProfile` extended** — `defaults` arg now accepts `warehouseId?: number | null`. When the partner is a Marketing type and `warehouseId` is provided (including `null` = umum), it's set on the Partner row at creation. For existing partners, providing `warehouseId` updates the alignment. Vehicle Owner partners ignore `warehouseId` (alignment is marketing-only).
- **`POST /api/v1/users` forwards `body.warehouseId`** — accepts `number | null | "general" | "none" | ""`. Validates the warehouse exists + is active before creating the partner.
- **`PUT /api/v1/users/{id}` forwards `body.warehouseId`** — works both when `roleIds` is also being updated AND when only `warehouseId` is changed standalone.
- **`GET /api/v1/users` returns `partnerWarehouseId` + `partnerWarehouseName`** — the Access UI uses these to show the alignment in the table.
- **Access UI form updated** — the "Tambah Partner" dialog now has a "Gudang (afiliasi marketing)" `<FormSelect>` that appears only when the partner type is `MARKETING`. The edit dialog has the same selector for marketing partners. The table shows a new "Gudang" column with the warehouse name badge (or "Umum" / "—" for vehicle owners).

### Behavior

| Partner type | Gudang selector shown? | Default warehouseId |
|---|---|---|
| MARKETING | Yes | null (umum) — user must explicitly pick |
| VEHICLE_OWNER | No | n/a (alignment is marketing-only) |

### Files changed

| File | Change |
|---|---|
| `src/lib/partner.ts` | `ensurePartnerProfile` accepts `warehouseId?: number \| null` in `defaults`. Validates the warehouse exists. Updates existing partners' alignment when `warehouseId` is provided. |
| `src/app/api/v1/users/route.ts` | POST forwards `body.warehouseId` to `ensurePartnerProfile`. GET returns `partnerWarehouseId` + `partnerWarehouseName` (via `partner.warehouse` include). |
| `src/app/api/v1/users/[id]/route.ts` | PUT forwards `body.warehouseId` (works both with and without `roleIds`). Returns the same fields as POST. |
| `src/lib/client-api.ts` | `UserAccount` interface gained `partnerWarehouseId?` + `partnerWarehouseName?`. `Options.marketingPartners` items now include `warehouseId?` + `warehouseName?`. |
| `src/components/app/pages/access-page.tsx` | PartnersTab loads `/options` for the warehouse list. Create + edit forms have a gudang selector (visible only when partner type is MARKETING). New "Gudang" column in the table. |

---

## 2. Customer Gudang auto-inheritance

### Background

In revision round 7 we added `Customer.warehouseId` (nullable) + the gudang scope filter. But the customer POST handler required `body.warehouseId` to be explicitly passed — there was no auto-inheritance from the marketing partner's alignment. This meant a Marketing partner aligned to Gudang Medan still had to manually pick "Medan" every time they created a customer.

### What's new

The `POST /api/v1/customers` handler now computes `warehouseId` with this priority:

1. **Explicit body override** — if `body.warehouseId` is sent (number / null / "general" / "none"), validate it and use it. This is the existing behavior — admins/owners can still attach a customer to any gudang.
2. **Marketing partner alignment (auto-inherit)** — if no explicit warehouseId and the caller is a Marketing partner, look up `Partner.warehouseId`. If aligned (not null), the customer inherits that gudang. If "umum" (null), the customer stays "umum" — the UI is expected to require a manual gudang pick in this case.
3. **Admin Gudang's own gudang** — if no explicit warehouseId, no marketing link, and the caller is an Admin Gudang / Staff Gudang (i.e. has an `employeeId` with a `warehouseId`), the customer auto-attaches to that gudang. Owner / Admin Kantor callers skip this branch and the customer stays "umum" unless explicitly set.

The audit log entry now includes `autoInheritedWarehouse: boolean` so it's traceable whether the gudang was auto-inherited or explicitly chosen.

### UI changes

The Customers page create/edit dialog was updated:

- **Admin / Owner** — sees the existing Gudang selector (unchanged).
- **Marketing aligned** — sees a green info banner: "Gudang otomatis: {warehouse name} — customer akan terikat ke gudang afiliasi marketing Anda." No selector shown (the server auto-inherits).
- **Marketing umum** — sees a Gudang selector labeled "Gudang (wajib — marketing umum)" with hint: "Marketing Anda berstatus 'Umum'. Pilih gudang untuk customer ini — bila tidak dipilih, customer akan terlihat oleh semua gudang."

The form payload logic:
- Marketing aligned → omits `warehouseId` (server auto-inherits).
- Marketing umum → sends `warehouseId` only if the user picked one (otherwise omitted → server defaults to umum).
- Admin / Owner → sends `warehouseId` as before.

### Files changed

| File | Change |
|---|---|
| `src/app/api/v1/customers/route.ts` | POST computes `warehouseId` with the 3-tier priority (explicit → marketing partner alignment → admin gudang's own gudang). Audit log entry includes `autoInheritedWarehouse`. |
| `src/components/app/pages/customers-page.tsx` | Create/edit form payload omits `warehouseId` for marketing users when they didn't pick one. New `CustomerMarketingGudangHint` component shows the appropriate banner / selector. |

---

## 3. Admin Gudang customer CRUD

### Background

Before this revision, Admin Gudang had **zero** `customer.*` permissions — they couldn't view, create, update, or delete customers. This was a gap: Admin Gudang needs to manage customers (e.g. walk-in customers at the gudang counter) without going through Marketing or Admin Kantor.

### What's new

The `admin-gudang` role template in `src/lib/rbac.ts` now includes:

```ts
"customer.view", "customer.create", "customer.update", "customer.delete"
```

This is auto-applied by `ensureRbac()` on the next API request after deployment — no manual SQL needed.

### Behavior matrix

| Caller role | Can view customers? | Can create? | Auto-attach gudang? | Can update/delete? |
|---|---|---|---|---|
| Owner | All customers | Yes | No (explicit only) | Yes |
| Admin Kantor | All customers | Yes | No (explicit only) | Yes (no delete) |
| **Admin Gudang** | Gudang-scoped (own gudang + umum) | **Yes** | **Yes — auto to their gudang** | **Yes** |
| Staff Gudang | Gudang-scoped | No | n/a | No |
| Marketing | Own customers only | Yes | Auto-inherit partner's gudang | Yes (own only) |

Admin Gudang's customer visibility is scoped by the existing `customerGudangClause` (added in revision round 7): they see customers where `warehouseId IS NULL OR warehouseId = <their gudang>`. They never see another gudang's customers.

When Admin Gudang creates a customer, the `POST /api/v1/customers` handler auto-attaches the customer to the admin's own gudang (via the new "Admin Gudang's own gudang" branch in the warehouseId priority — see section 2 above).

### Files changed

| File | Change |
|---|---|
| `src/lib/rbac.ts` | `admin-gudang` role template gained `customer.view`, `customer.create`, `customer.update`, `customer.delete`. |

No other files needed changes — the existing customer API endpoints already use `guard(req, "customer.view")` etc., so the permission check just starts allowing Admin Gudang once the role template is updated.

---

## 4. Seed data updates

### Background

The seed had several gaps:
- Customers were missing `email` (the resi sender block relies on the customer's email fallback).
- Shipments didn't set `pengirimName/Phone/Email/Address` explicitly — they relied on the runtime customer fallback (which worked but meant the snapshot wasn't truly "frozen at creation time").
- No DIRECT shipment or transport demoed the DIRECT flow.
- Budi (the demo Marketing partner) had no gudang alignment, so the auto-inheritance feature couldn't be demoed.

### What's new

#### Customer defs — email + gudang attachment

All 5 demo customers now have:
- `email` (was missing — now `rina.amelia@example.com`, `admin@ptmajubersama.co.id`, etc.)
- `warehouseId` — attached to the gudang matching their city:
  - CUS-000001 Rina Amelia → Gudang Banda Aceh
  - CUS-000002 PT Maju Bersama → Gudang Medan
  - CUS-000003 CV Sinar Jaya → Gudang Lhokseumawe
  - CUS-000004 Tono Susilo → Gudang Banda Aceh
  - CUS-000005 Sari Indah → Gudang Banda Aceh

This means Admin Gudang Medan only sees PT Maju Bersama; Admin Gudang Banda Aceh sees the other three; Admin Gudang Lhokseumawe sees CV Sinar Jaya. Owner sees all five.

#### Shipment defs — explicit pengirim snapshot

All 7 shipmentDefs (MKT-000001 through MKT-000006 + the new MKT-000009) now include an explicit `pengirim: { name, phone, email, address }` block. The seed writes these to `pengirimName/Phone/Email/Address` on the `MasterShipment` row, so the resi prints the snapshot exactly as the staff entered it at creation time (no runtime customer fallback needed).

#### DIRECT shipment + transport

New entries:

| Code | Type | Status | Notes |
|---|---|---|---|
| **MKT-000009** | Shipment (DIRECT) | `IN_TRANSPORT` | Created by `adit` (Marketing, umum). Customer: Rina Amelia. 1 detail (Dokumen penting, 0.5 kg). No `originWarehouseId` / `destinationWarehouseId` (DIRECT skips the warehouse flow). |
| **TRP-2026-000004** | Transport (PLANNED) | `PLANNED` | Carries MKT-000009. Route: MDN → BNA Aceh Timur. Vehicle: BK 8800 KTH (company-owned, no profit share). Driver: joko. No kenek. |

The seed also writes a tracking event: `"Shipment DIRECT dimuat ke transport TRP-2026-000004 (driver langsung, tanpa gudang)"`.

This demonstrates the full DIRECT flow end-to-end:
1. DIRECT shipment created (no gudang fields, no `RECEIVED_AT_GUDANG` gate).
2. DIRECT shipment loaded onto a transport (eligible from `CREATED` status — see revision round 9 transport API change).
3. Transport shows the DIRECT shipment in its shipment list.
4. Shipment moves to `IN_TRANSPORT` status.

#### New demo partner — adit (Marketing, umum)

A new marketing partner `adit` (Adit Nugroho) was added to demo the "umum" path:
- `username: adit`, `password: Demo#Pass2026`
- `role: marketing`, `position: Marketing`
- `Partner.warehouseId: null` (umum — no gudang alignment)
- Customers adit creates need a manual gudang pick (the UI shows the Gudang selector with a "wajib" hint).
- Created the DIRECT shipment MKT-000009 to demo the umum → DIRECT path.

#### Budi aligned to Gudang Medan

The existing demo partner `budi` is now aligned to Gudang Medan (`Partner.warehouseId = gudang.Medan`). Customers budi creates auto-inherit Gudang Medan — the UI shows a green banner "Gudang otomatis: Gudang Medan".

#### Seed summary printout

The seed runner (`prisma/seed.ts`) prints the new accounts + demo data:

```
Akun demo:
  ...
  adit   / Demo#Pass2026        (marketing, Gudang Medan — UMUM, no gudang alignment)

Demo DIRECT shipment + transport (Revise round 10):
  MKT-000009 (Rina Amelia, DIRECT, IN_TRANSPORT) — shipment created by adit (umum marketing)
    pickup langsung di lokasi pengirim, kirim langsung ke penerima, tanpa lewat gudang
  TRP-2026-000004 (PLANNED, Medan→Banda Aceh) — transport carrying MKT-000009
    driver: joko, vehicle: BK 8800 KTH (company-owned, no profit share)

Demo Marketing alignment (Revise round 10):
  budi  — Marketing aligned to Gudang Medan (customers they create auto-inherit Medan gudang)
  adit  — Marketing 'Umum' (no gudang alignment — customers they create need a manual gudang pick)
```

### Files changed

| File | Change |
|---|---|
| `src/lib/seed.ts` | Customer defs gained `email` + `warehouseId`. Shipment defs gained `pengirim` snapshot + `fulfillmentMode`. New MKT-000009 (DIRECT) entry. New `adit` marketing partner (umum). Budi aligned to Gudang Medan. New TRP-2026-000004 transport carrying MKT-000009. Customer upsert `update` block now backfills `email` + `warehouseId` on re-seed. Partner upsert `update` block now re-syncs `warehouseId` on re-seed. Shipment create writes `fulfillmentMode` + `pengirim*` + skips warehouseId for DIRECT. |
| `prisma/seed.ts` | Summary printout includes the new adit account, DIRECT shipment + transport, and marketing alignment demo. |

---

## Migration / upgrade notes

### Schema changes

**None.** This revision does not add any new columns. All the features reuse existing schema:
- `Partner.warehouseId` (added in revision round 7)
- `Customer.warehouseId` (added in revision round 7)
- `MasterShipment.fulfillmentMode` (added in revision round 8)
- `MasterShipment.pengirimName/Phone/Email/Address` (already existed — seed now populates them)

Run `bun run db:push` to be safe (no-op if the schema is already in sync), then `bun run db:seed` to get the new demo data.

### RBAC catalog change

The `admin-gudang` role template gained 4 new permissions: `customer.view`, `customer.create`, `customer.update`, `customer.delete`. The `ensureRbac()` function automatically re-syncs the role on the next API request after deployment (it detects the permission catalog size changed because no new permissions were added — but `rolesNeedSync` detects the role-template mismatch and re-applies the template).

To verify after deployment:

```sql
SELECT r.slug, r.name, p.slug AS permission
FROM RolePermission rp
JOIN Role r ON rp.roleId = r.id
JOIN Permission p ON rp.permissionId = p.id
WHERE r.slug = 'admin-gudang' AND p.slug LIKE 'customer.%'
ORDER BY p.slug;
```

Expected: 4 rows (`customer.create`, `customer.delete`, `customer.update`, `customer.view`).

### Existing deployments

- Existing production deployments are **unaffected** by the schema (no new columns).
- Admin Gudang users will gain customer CRUD permissions automatically on the next API request — this is the intended behavior change.
- Existing customers keep their `warehouseId` as-is (no data migration).
- Existing partners keep their `warehouseId` as-is (no data migration).
- The seed changes only apply when you run `bun run db:seed` on a fresh database. Existing seeded databases won't be touched (the seed is idempotent — it only inserts when tables are empty, except for the customer/partner upsert `update` blocks which re-sync `email` + `warehouseId` on existing rows).

---

## File-by-file change list

### Backend

| File | Change |
|---|---|
| `src/lib/partner.ts` | `ensurePartnerProfile` accepts `warehouseId?: number \| null`. Validates warehouse. Updates existing partner alignment. |
| `src/lib/rbac.ts` | `admin-gudang` role template gained `customer.view/create/update/delete`. |
| `src/app/api/v1/users/route.ts` | POST forwards `body.warehouseId`. GET returns `partnerWarehouseId` + `partnerWarehouseName`. |
| `src/app/api/v1/users/[id]/route.ts` | PUT forwards `body.warehouseId` (with or without `roleIds`). Returns same fields as POST. |
| `src/app/api/v1/customers/route.ts` | POST computes `warehouseId` with 3-tier priority (explicit → marketing partner → admin gudang's own). Audit includes `autoInheritedWarehouse`. |
| `src/app/api/v1/options/route.ts` | (no change in this revision — `marketingPartners` already includes `warehouseId` + `warehouseName` from revision round 7) |

### Frontend

| File | Change |
|---|---|
| `src/lib/client-api.ts` | `UserAccount` gained `partnerWarehouseId?` + `partnerWarehouseName?`. `Options.marketingPartners` items include `warehouseId?` + `warehouseName?`. |
| `src/components/app/pages/access-page.tsx` | PartnersTab loads `/options`. Create + edit forms have a gudang selector (marketing only). New "Gudang" column in the table. |
| `src/components/app/pages/customers-page.tsx` | Form payload omits `warehouseId` for marketing-aligned users. New `CustomerMarketingGudangHint` component shows banner (aligned) or selector (umum). |

### Seed

| File | Change |
|---|---|
| `src/lib/seed.ts` | Customer defs: + `email`, + `warehouseId`. Shipment defs: + `pengirim` snapshot, + `fulfillmentMode`. New MKT-000009 (DIRECT). New `adit` marketing partner (umum). Budi aligned to Medan. New TRP-2026-000004 transport. Customer + partner upsert `update` blocks backfill new fields. |
| `prisma/seed.ts` | Summary printout includes new adit account, DIRECT shipment + transport, marketing alignment demo. |

### Docs

| File | Change |
|---|---|
| `docs/11-revision-round-10.md` | This document. |
| `docs/README.md` | Revision round 10 summary added to the revision history + document index. |
