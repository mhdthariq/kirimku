# 09 — Revision Round 8 (Fulfillment Mode + Proof Photo Permission)

This document covers two related changes delivered together:

1. **Shipment Fulfillment Mode** — new `fulfillmentMode` field on `MasterShipment` (`STANDARD` / `DIRECT`), exposed as top-level `Regular` / `Direct` tabs on the Shipments page. The owner's per-gudang tabs are kept separate — they show only STANDARD shipments, so DIRECT shipments never get merged into the per-gudang view.

2. **`proof_photo.view` permission** — new RBAC permission that gates the display of photo evidence for pickups, checkpoints, and deliveries. Default grant is ONLY Admin Gudang (+ Owner, who bypasses permissions). Other roles see a "foto terkunci" placeholder.

---

## 1. Shipment Fulfillment Mode (STANDARD / DIRECT)

### Background

The original system shipped with a single end-to-end flow:

```
Marketing → Pickup Request → Admin Gudang → Assign Kurir →
Kurir Pickup → Company Warehouse → Admin Gudang Scan →
Admin Gudang Creates Transport → Driver →
Destination Warehouse → Admin Gudang Scan → Kurir Delivery → Customer
```

A second business scenario is now needed where the **driver** picks up directly at the origin warehouse (which may be an external warehouse owned by Company A) and delivers directly to the destination warehouse (which may be owned by Company B), without the package ever entering the company's own warehouse scan flow. The customer (Company A) is the payer; the destination warehouse's owner (Company B) is only the receiver — neither needs to be conflated with the Customer entity.

To support this without breaking the existing flow, every `MasterShipment` now carries an explicit `fulfillmentMode`:

| Mode | Meaning | Operational flow |
|---|---|---|
| `STANDARD` | The existing flow (default) | Kurir → Company Warehouse → Transport → Destination Warehouse → Kurir Delivery |
| `DIRECT` | The new flow | Driver picks up directly at origin warehouse → delivers directly to destination warehouse (no Admin Gudang scan) |

### Schema change

```prisma
model MasterShipment {
  // …existing fields…
  /// Revise round 8 — Fulfillment Mode. "STANDARD" = the existing
  /// kurir → company warehouse → transport → destination warehouse →
  /// kurir delivery flow. "DIRECT" = driver picks up directly at the
  /// origin warehouse (external or own) and delivers directly to the
  /// destination warehouse, bypassing the company warehouse scan flow.
  /// Existing rows default to "STANDARD" — no data migration required.
  fulfillmentMode        String              @default("STANDARD")
  // …existing fields…
}
```

Existing rows default to `"STANDARD"` — no data migration is required. Existing deployments continue to behave exactly as before until an operator explicitly creates a `"DIRECT"` shipment.

### API

- **`POST /api/v1/shipments`** — accepts an optional `fulfillmentMode` field (`"STANDARD"` | `"DIRECT"`, case-insensitive). Defaults to `"STANDARD"` when absent.
- **`GET /api/v1/shipments?fulfillmentMode=STANDARD|DIRECT`** — optional filter. Used by the Shipments page Regular / Direct tabs.
- The `fulfillmentMode` field is included on every shipment response (the GET endpoints spread the full row).

### UI — Shipments page tabs

The Shipments page top-level tabs were restructured:

**Before** (single-tier):
```
[ Daftar | Gudang A | Gudang B | … | Log Aktivitas ]   (owner)
[ Daftar | Log Aktivitas ]                              (everyone else)
```

**After** (two fulfillment modes + per-gudang):
```
[ Regular | Direct | Gudang A | Gudang B | … | Log Aktivitas ]   (owner)
[ Regular | Direct | Log Aktivitas ]                              (everyone else)
```

Filtering rules:

| Active tab | Filter applied |
|---|---|
| `Regular` | `fulfillmentMode === "STANDARD"` only |
| `Direct` | `fulfillmentMode === "DIRECT"` only |
| `wh-{id}` (owner per-gudang) | `gudangIds.includes(id)` **AND** `fulfillmentMode === "STANDARD"` — DIRECT shipments are NOT shown in per-gudang tabs |
| `activity` | Audit log (unchanged) |

> **Important:** the owner's per-gudang tabs deliberately exclude DIRECT shipments. The user's requirement was: *"in owner this is perfectly dont combine the tab to show shipment in Our Gudang to Direct because thats the Regular."* — i.e. the per-gudang tabs are for the Regular (STANDARD) flow only. DIRECT shipments live exclusively in the Direct tab.

### UI — Shipment create form

A new `Mode Fulfillment` dropdown was added to the create-shipment dialog, between the Gudang Asal / Gudang Tujuan selectors and the Discount field:

```
Mode Fulfillment
[ STANDARD — Lewat gudang (kurir pickup → gudang → transport → gudang tujuan) ]
[ DIRECT — Driver langsung (pickup di gudang asal → delivery ke gudang tujuan) ]
```

A hint label below the dropdown explains the selected mode in plain Indonesian.

### UI — Shipment list badge

Each shipment row in the list now shows a small `DIRECT` badge (violet color) next to the customer name when `fulfillmentMode === "DIRECT"`. STANDARD shipments show no badge (they are the default).

### Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `fulfillmentMode String @default("STANDARD")` on `MasterShipment`. |
| `src/app/api/v1/shipments/route.ts` | GET supports `?fulfillmentMode=STANDARD\|DIRECT` filter. POST accepts `fulfillmentMode` on the body. |
| `src/lib/client-api.ts` | `Shipment` interface gained `fulfillmentMode?: "STANDARD" \| "DIRECT"`. |
| `src/components/app/pages/shipments-page.tsx` | `ShipmentForm` got `fulfillmentMode` field. `EMPTY_SHIPMENT` defaults to `"STANDARD"`. Create-shipment dialog has the new dropdown. Top-level tabs are now `Regular \| Direct \| (per-gudang, owner only) \| Log Aktivitas`. Per-gudang tabs filter to STANDARD only. New `DIRECT` badge on each row. |

---

## 2. `proof_photo.view` permission

### Background

Photo evidence is captured at three operational points in the system:

| Operational point | Schema column | Captured by |
|---|---|---|
| **Checkpoint check-in** (linehaul transport) | `CheckpointRecord.photoUrl` | Driver / Kenek (during transport) |
| **Pickup** (kurir pickup at customer) | `Pickup.photoUrl` *(new in this revision)* | Kurir |
| **Delivery** (kurir handover to receiver) | `Delivery.photoUrl` *(new in this revision)* | Kurir |

These photos are sensitive (proof of pickup / delivery / checkpoint arrival). They should not be visible to every user who can see the row that owns the photo.

### What's new

A new permission `proof_photo.view` has been added to the RBAC catalog. Default grant is **Admin Gudang** only — the Owner bypasses permissions anyway. Other roles (Marketing, Kurir, Driver, Kenek, Staff Gudang, Admin Kantor, Vehicle Owner) do NOT see the photos by default. They still see the text metadata (timestamp, recorded-by name) — only the image itself is hidden behind a "foto terkunci" placeholder.

> The owner of the RBAC system can grant `proof_photo.view` to additional roles from the Access Control → Roles UI without code changes.

### Schema changes

```prisma
model Pickup {
  // …existing fields…
  /// Revise round 8 — optional pickup photo (proof of pickup). Display is
  /// gated by proof_photo.view (Admin Gudang + Owner by default).
  photoUrl    String?
  // …existing fields…
}

model Delivery {
  // …existing fields…
  proofOfDelivery String?   // existing — free text (receiver name)
  /// Revise round 8 — optional delivery photo (proof of delivery image).
  /// Display is gated by proof_photo.view (Admin Gudang + Owner default).
  photoUrl        String?
  // …existing fields…
}
```

`CheckpointRecord.photoUrl` already existed — no schema change needed for checkpoints.

Both new columns are nullable and default to NULL. No data migration is required — existing rows simply have no photo. Future photo uploads (e.g. from the QR scan dialog when the kurir completes a pickup / delivery) will populate these columns.

### RBAC catalog entry

```ts
// src/lib/rbac.ts — PERMISSIONS array
{
  slug: "proof_photo.view",
  module: "Proof Photos",
  description: "Lihat foto bukti (pickup, checkpoint, delivery PoD) — Admin Gudang & Owner"
}
```

Granted to:

| Role | Granted? | Why |
|---|---|---|
| Admin Gudang | ✅ Yes | Default per user's request — warehouse operations need to verify proof. |
| Owner | ✅ Yes (bypasses permissions) | Owner always sees everything. |
| Staff Gudang | ❌ No | Floor staff — they scan but don't verify proof. |
| Kurir | ❌ No | They take the photo, but don't need to review it later. |
| Driver | ❌ No | They take the checkpoint selfie, but don't need to review it later. |
| Kenek | ❌ No | Same as Driver. |
| Admin Kantor | ❌ No | Office admin — finance / invoices, not operations. |
| Marketing | ❌ No | Sales — never needs to see proof photos. |
| Vehicle Owner | ❌ No | Partner — sees their own settlements, not proof photos. |

### Behavior

| User role | Sees checkpoint photo? | Sees pickup photo? | Sees delivery photo? |
|---|---|---|---|
| Admin Gudang | ✅ Image | ✅ Image | ✅ Image |
| Owner | ✅ Image | ✅ Image | ✅ Image |
| Everyone else | ❌ "foto terkunci" placeholder | ❌ Camera icon placeholder | ❌ "Foto bukti tersedia — terkunci" placeholder |

The text metadata (timestamp, recorded-by name, receiver name on `proofOfDelivery`) is always visible — only the image is gated.

### Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `photoUrl String?` on `Pickup` and `Delivery`. |
| `src/lib/rbac.ts` | Added `proof_photo.view` permission to `PERMISSIONS` array. Granted to `admin-gudang` role in `ROLE_TEMPLATES`. |
| `src/lib/client-api.ts` | `PickupTask` got `photoUrl?: string \| null`. `DeliveryTask` got `photoUrl?: string \| null`. |
| `src/app/api/v1/pickups/route.ts` | GET returns `photoUrl` on each row. |
| `src/app/api/v1/deliveries/route.ts` | GET returns `photoUrl` on each row. |
| `src/components/app/pages/transport-detail-page.tsx` | Checkpoint photo thumbnails gated by `proof_photo.view`. Non-permitted users see a "foto terkunci" placeholder with a Camera icon. |
| `src/components/app/pages/pickups-page.tsx` | New "Foto Bukti" column on the pickups list. Gated by `proof_photo.view`. |
| `src/components/app/pages/deliveries-page.tsx` | Delivery detail dialog shows the photo (when present) below the text PoD. Gated by `proof_photo.view`. |

---

## Migration / upgrade notes

### Schema changes (run `bun run db:push` after pulling this code)

Three new nullable columns are added:

| Table | Column | Type | Notes |
|---|---|---|---|
| `MasterShipment` | `fulfillmentMode` | `String @default("STANDARD")` | Existing rows default to `"STANDARD"` — no data migration. |
| `Pickup` | `photoUrl` | `String?` | Existing rows default to `NULL` — no data migration. |
| `Delivery` | `photoUrl` | `String?` | Existing rows default to `NULL` — no data migration. |

### RBAC catalog change

The new `proof_photo.view` permission is automatically registered by `ensureRbac()` on the next API request. The Admin Gudang system role is automatically granted the permission by the role-template sync logic (the sync runs whenever the permission catalog size changes, which it does because we added one permission).

To verify after deployment:

```sql
-- Check the permission exists
SELECT * FROM Permission WHERE slug = 'proof_photo.view';

-- Check which roles have it
SELECT r.slug, r.name
FROM RolePermission rp
JOIN Role r ON rp.roleId = r.id
JOIN Permission p ON rp.permissionId = p.id
WHERE p.slug = 'proof_photo.view';
```

Expected: only `admin-gudang` should appear in the second query (the Owner bypasses permissions via the `isOwner` flag and is not in the `RolePermission` table).

### Existing deployments

- Existing production deployments are **completely unaffected** by this revision.
- All existing shipments continue to behave as `STANDARD` (the default).
- All existing pickup / delivery rows have `photoUrl = NULL` (no photo), so the new "Foto Bukti" column shows "—" for them.
- The new `proof_photo.view` permission is auto-registered on the next API request — no manual SQL needed.

---

## File-by-file change list

### Schema

| File | Change |
|---|---|
| `prisma/schema.prisma` | `MasterShipment.fulfillmentMode String @default("STANDARD")`. `Pickup.photoUrl String?`. `Delivery.photoUrl String?`. |

### Backend

| File | Change |
|---|---|
| `src/lib/rbac.ts` | Added `proof_photo.view` permission. Granted to `admin-gudang` role template. |
| `src/lib/client-api.ts` | `Shipment.fulfillmentMode`, `PickupTask.photoUrl`, `DeliveryTask.photoUrl` added. |
| `src/app/api/v1/shipments/route.ts` | GET supports `?fulfillmentMode=STANDARD\|DIRECT` filter. POST accepts `fulfillmentMode` on the body. |
| `src/app/api/v1/pickups/route.ts` | GET returns `photoUrl` on each row. |
| `src/app/api/v1/deliveries/route.ts` | GET returns `photoUrl` on each row. |

### Frontend

| File | Change |
|---|---|
| `src/components/app/pages/shipments-page.tsx` | Top-level tabs `Regular \| Direct \| (per-gudang, owner only) \| Log Aktivitas`. Per-gudang tabs filter to STANDARD only. Create-shipment dialog has `fulfillmentMode` dropdown. `DIRECT` badge on each row. |
| `src/components/app/pages/pickups-page.tsx` | New "Foto Bukti" column gated by `proof_photo.view`. |
| `src/components/app/pages/deliveries-page.tsx` | Delivery detail dialog shows photo (when present) gated by `proof_photo.view`. |
| `src/components/app/pages/transport-detail-page.tsx` | Checkpoint photo thumbnails gated by `proof_photo.view`. |

### Docs

| File | Change |
|---|---|
| `docs/09-revision-round-8.md` | This document. |
| `docs/README.md` | Revision round 8 summary added to the revision history + document index. |

---

## Future work (out of scope for this revision)

This revision intentionally does **not** implement:

1. **The full DIRECT workflow** from the original revision plan (`Shipment App — Pickup, Warehouse, Route & Transport Revision Plan.md`). Specifically:
   - Warehouse ownership classification (`OWN` / `EXTERNAL`) — section 3.2 of the plan.
   - Geofence radius on Warehouse — section 3.3.
   - Driver-side direct pickup / direct delivery with GPS validation — sections 13–16, 24.
   - Transport-level `transport_type` (`STANDARD` / `DIRECT`) — section 17.
   - Package state machine split for DIRECT (skipping `ARRIVED_AT_ORIGIN_WAREHOUSE`, etc.) — section 22.
   - Driver app UI for direct transport checkpoints — section 33.

   These are larger changes that require the fullfilment-mode field (which this revision adds) plus a separate driver-facing workflow. They are deliberately deferred.

2. **Photo upload UI** for pickups / deliveries. The schema columns (`Pickup.photoUrl`, `Delivery.photoUrl`) and the permission gate (`proof_photo.view`) are in place, but the QR scan dialog (`src/components/app/qr-scan-dialog.tsx`) still only captures a text `proofOfDelivery` (the receiver name) and does NOT yet capture a photo. A future revision will extend the QR scan dialog to optionally capture a photo at the moment of pickup confirmation / delivery completion, store it on the new `photoUrl` column, and immediately benefit from the existing permission gate.

   Once that future revision lands, no further changes will be needed in `transport-detail-page.tsx` / `pickups-page.tsx` / `deliveries-page.tsx` — the photo will automatically render (or be hidden) based on the `proof_photo.view` permission that this revision already adds.
