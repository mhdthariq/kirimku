# 13 — Revision Round 12 (Owner-Only Seeder, Accounts-Only Seeder, Checkpoint Coordinate Inputs)

This document covers three related changes delivered together:

1. **Owner-only seeder** — new `bun run db:seed:owner` script that seeds ONLY the single Owner login (employee + user) plus the RBAC catalog. No gudang, no staff, no partners, no wallets, no transactional data. Use this when you want a truly empty database where only the owner can log in — the owner then builds everything from scratch via the UI.
2. **Accounts-only seeder** — new `bun run db:seed:accounts` script that seeds the demo accounts (owner + 21 staff/partner), the 3 demo gudang, partner wallets, and the RBAC catalog. No transactional demo data (vehicles, routes, tariffs, customers, shipments, invoices, audit logs) is created. Useful when you want a clean database with all demo logins working but no clutter.
3. **Editable checkpoint coordinates** — the route checkpoint editor now has editable Latitude and Longitude text inputs plus a paste-coordinates helper that accepts `lat, lng` / `lat lng` / `lat;lng` / `(lat, lng)` formats. You can finally type or paste precise coordinates directly instead of fighting the Leaflet drag interface for sub-meter precision.

---

## 1. Owner-only seeder

### Background

The original `bun run db:seed` script is a one-shot demo setup: it creates the demo accounts AND the full transactional dataset (3 gudang, 10 vehicles, 2 routes + 7 checkpoints, 4 tariffs, 5 customers, 9 shipments across the whole lifecycle, 6 pickups, 4 transports, 3 invoices, 13 audit logs). This is great for first-time demos, but it pollutes every operational page — Shipments, Pickups, Deliveries, Transports, Invoices, Audit Log — with mock data that gets in the way when you want to test a fresh workflow end-to-end with your own data.

The accounts-only seeder (section 2 below) was added first — it creates 22 demo logins + 3 gudang + 7 partners + 7 wallets but skips operational data. But that still leaves the Users / Gudang / Partners list pages populated with demo rows. The other 21 accounts also pull in related rows (employees → warehouses, partners → wallets, role assignments) that aren't strictly "operational data" but aren't empty either.

The user wanted an even more minimal option: seed ONLY the owner, so when they log in as owner, every page is genuinely empty. The owner then builds gudang, staff, partners, vehicles, routes, customers, and shipments in that order via the UI.

### What's new

A new `bun run db:seed:owner` script that creates:

- **RBAC catalog** — 8 system roles + 122 role-permission links (same as the other seeders). Needed so the owner can later assign roles to staff they create via the UI. Also self-heals on every API boot.
- **1 Employee + 1 User** — the owner account. `username: owner`, `password: ChangeMeOwner#2026`, `isOwner: true`.
- The owner's employee row has `warehouseId = null` — the owner sees ALL gudang regardless of assignment (the `isOwner` flag bypasses per-gudang data isolation).

Skipped: gudang, staff, partners, wallets, vehicles, routes, tariffs, customers, shipments, pickups, deliveries, transports, invoices, payments, audit logs.

### Architecture

`src/lib/seed.ts` now has THREE exported seeder functions, each calling a different scope of work:

- `seedOwnerOnly()` — calls `ensureRbac()` + upserts the owner employee + owner user. Stops there. Used by `prisma/seed-owner.ts` (the `db:seed:owner` script).
- `seedAccountsOnly()` — calls `seedAccountsAndGudang()` (which upserts RBAC + 3 gudang + owner + 21 staff + 7 partners + 7 wallets). Used by `prisma/seed-accounts.ts` (the `db:seed:accounts` script).
- `runSeed()` (via `ensureSeed()`) — calls `seedAccountsAndGudang()` first, then adds vehicles / routes / tariffs / customers / shipments / invoices / audit logs. Used by `prisma/seed.ts` (the full `db:seed` script).

Note: `seedOwnerOnly()` and `seedAccountsAndGudang()` both define the same owner upsert (keyed by `employeeNumber: "EMP-000001"` and `username: "owner"`). They're kept in sync — if you change the owner's name / password / phone in one, change it in the other too. The doc table in `docs/06-seeding-and-demo-accounts.md` calls this out.

All three seeders are idempotent and converge on the same owner row, so you can run them in any order or combine them (e.g. `db:seed:owner` first to get a login, then later `db:seed` to backfill the full demo dataset).

### Files changed

| File | Change |
|---|---|
| `src/lib/seed.ts` | Added new exported `seedOwnerOnly()` function — upserts RBAC + owner employee + owner user. Stays independent of `seedAccountsAndGudang()` (doesn't create gudang, doesn't backfill unbound employees). |
| `prisma/seed-owner.ts` | NEW — standalone owner-only seeder script. Imports `seedOwnerOnly` from `src/lib/seed.ts` and prints a summary of what was created (and what to do next via the UI). |
| `package.json` | Added `db:seed:owner` script: `bun run prisma/seed-owner.ts`. |
| `docs/06-seeding-and-demo-accounts.md` | Documented the new `db:seed:owner` option, the "truly empty" reset path, and the three-seeder architecture. |
| `prisma/seed-accounts.ts` | Updated header comment to cross-reference the new `db:seed:owner` option. |

### Usage

```bash
# Option A — Full demo dataset (accounts + shipments + invoices + etc.)
rm db/custom.db
bun run db:push
bun run db:seed           # full
bun run dev

# Option B — All demo accounts, no operational data
rm db/custom.db
bun run db:push
bun run db:seed:accounts  # 22 logins + 3 gudang + 7 partners + 7 wallets
bun run dev

# Option C — Only the owner, truly empty database
rm db/custom.db
bun run db:push
bun run db:seed:owner     # owner login ONLY — nothing else
bun run dev

# Option D — Owner first, then backfill the full demo later
rm db/custom.db
bun run db:push
bun run db:seed:owner     # minimal — owner can log in immediately
bun run dev               # build some operational data via UI...
# ...later, if you want the full demo dataset:
bun run db:seed           # adds gudang, staff, partners, vehicles, routes, shipments, etc. on top
```

### Demo account created

| Username | Password | Role | Notes |
|---|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner (full access) | The only user in the system. `warehouseId = null` (owner sees ALL gudang). |

### Suggested UI workflow after `db:seed:owner`

Once you log in as owner, build the dataset in this order (each step unlocks the next):

1. **Gudang** → Tambah Gudang — create Medan, Banda Aceh, Lhokseumawe (or your own cities).
2. **Access Control → Users → Tambah Staff** — create siti (admin kantor), agus (admin gudang), etc. Assign each to a gudang.
3. **Partners → Tambah Partner** — create budi (marketing), hendra (vehicle owner), etc.
4. **Vehicles → Tambah Kendaraan** — create vehicles, optionally assign to vehicle owners.
5. **Routes → Tambah Rute** — create routes, then add checkpoints via the map editor.
6. **Tariffs → Tambah Tarif** — define per-route pricing.
7. **Customers → Tambah Pelanggan** — create B2B / B2C customers.
8. **Shipments → Buat Shipment** — create shipments, assign pickups, transports, deliveries.

---

## 2. Accounts-only seeder

### Background

The original `bun run db:seed` script is a one-shot demo setup: it creates the demo accounts AND the full transactional dataset (3 gudang, 10 vehicles, 2 routes + 7 checkpoints, 4 tariffs, 5 customers, 9 shipments across the whole lifecycle, 6 pickups, 4 transports, 3 invoices, 13 audit logs). This is great for first-time demos, but it pollutes every operational page — Shipments, Pickups, Deliveries, Transports, Invoices, Audit Log — with mock data that gets in the way when you want to test a fresh workflow end-to-end with your own data.

The user wanted to be able to seed the accounts in isolation, leaving the operational data empty.

### What's new

A new `bun run db:seed:accounts` script that creates:

- **RBAC catalog** — 8 system roles + 122 role-permission links (same as the full seed).
- **3 Gudang** — Medan, Banda Aceh, Lhokseumawe (so per-gudang data isolation works).
- **22 Employees + 22 Users** — owner + 21 staff/partner accounts with the same usernames / passwords as the full seed.
- **7 Partners + 7 Wallets** — budi/adit (Marketing), hendra/sari/doni/maya/yusuf (Vehicle Owners).

Skipped: vehicles, routes, tariffs, customers, shipments, pickups, deliveries, transports, invoices, payments, audit logs.

### Architecture

`src/lib/seed.ts` was refactored to extract a shared `seedAccountsAndGudang()` helper that creates RBAC + gudang + owner + staff + partners + wallets. This helper is called by BOTH:

- `seedAccountsOnly()` — the new exported function used by `prisma/seed-accounts.ts` (the `db:seed:accounts` script). It just calls `seedAccountsAndGudang()` and stops.
- `runSeed()` — the existing full-seed function. It calls `seedAccountsAndGudang()` first, then continues to create the transactional demo data (vehicles, routes, tariffs, customers, shipments, invoices, audit logs).

Both seeders share the same upsert keys (warehouse.code, employee.employeeNumber, user.username, partner.userId), so they converge on the same account set. You can run them in any order, multiple times — they're fully idempotent.

### Files changed

| File | Change |
|---|---|
| `src/lib/seed.ts` | Extracted `seedAccountsAndGudang()` helper from `runSeed()`. Added new exported `seedAccountsOnly()` function. `runSeed()` now calls `seedAccountsAndGudang()` first, then proceeds with transactional data. |
| `prisma/seed-accounts.ts` | NEW — standalone accounts-only seeder script. Imports `seedAccountsOnly` from `src/lib/seed.ts` and prints a summary of what was created. |
| `package.json` | Added `db:seed:accounts` script: `bun run prisma/seed-accounts.ts`. |
| `docs/06-seeding-and-demo-accounts.md` | Documented the new `db:seed:accounts` option, the "accounts-only" reset path, and the shared `seedAccountsAndGudang()` helper. |

### Usage

```bash
# Option A — Full demo dataset (accounts + shipments + invoices + etc.)
rm db/custom.db
bun run db:push
bun run db:seed           # full
bun run dev

# Option B — Accounts only (logins work, operational pages empty)
rm db/custom.db
bun run db:push
bun run db:seed:accounts  # minimal
bun run dev

# Option C — Accounts first, then backfill the full demo later
rm db/custom.db
bun run db:push
bun run db:seed:accounts  # minimal — logins work immediately
bun run dev               # build some operational data via UI...
# ...later, if you want the full demo dataset:
bun run db:seed           # adds vehicles, routes, shipments, etc. on top
```

### Demo accounts created (same for both seeders)

| Username | Password | Role | Position |
|---|---|---|---|
| `owner` | `ChangeMeOwner#2026` | Owner (full access) | Owner |
| `siti` | `Demo#Pass2026` | Admin Kantor | Admin Kantor (Gudang Medan) |
| `budi` | `Demo#Pass2026` | Marketing | Marketing (Gudang Medan) |
| `agus` | `Demo#Pass2026` | Admin Gudang | Admin Gudang (Gudang Medan) |
| `ratna` | `Demo#Pass2026` | Admin Gudang | Admin Gudang (Gudang Lhokseumawe — data isolation demo) |
| `dewi` | `Demo#Pass2026` | Kurir | Kurir (Gudang Medan) |
| `rizky` | `Demo#Pass2026` | Kurir | Kurir (Gudang Medan) |
| `joko` | `Demo#Pass2026` | Driver | Driver (Gudang Medan) |
| `andi` | `Demo#Pass2026` | Kenek | Kenek (Gudang Medan) |
| `farhan` | `Demo#Pass2026` | Kurir | Kurir (Gudang Medan) |
| `lina` | `Demo#Pass2026` | Kurir | Kurir (Gudang Banda Aceh) |
| `bayu` | `Demo#Pass2026` | Driver | Driver (Gudang Medan) |
| `rudi` | `Demo#Pass2026` | Driver | Driver (Gudang Banda Aceh) |
| `fajar` | `Demo#Pass2026` | Kenek | Kenek (Gudang Medan) |
| `yudi` | `Demo#Pass2026` | Kenek | Kenek (Gudang Banda Aceh) |
| `wawan` | `Demo#Pass2026` | Staff Gudang | Staff Gudang (Gudang Medan) |
| `adit` | `Demo#Pass2026` | Marketing | Marketing (Gudang Medan — UMUM, no gudang alignment) |
| `hendra` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner |
| `sari` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner |
| `doni` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner |
| `maya` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner |
| `yusuf` | `Demo#Pass2026` | Vehicle Owner | Vehicle Owner |

---

## 3. Editable checkpoint coordinates

### Background

The route checkpoint editor (`CheckpointMapEditor`) used to require dragging markers on the Leaflet map to set precise coordinates. This was fiddly for sub-meter precision — you'd drag, release, see the lat/lng in a read-only display, drag again to nudge, etc. The user wanted to be able to type or paste coordinates directly, since they often have them in text form (copied from Google Maps, OpenStreetMap, a spreadsheet, etc.).

### What's new

The selected-checkpoint editor form (the card that opens when you click a checkpoint) now has:

1. **Editable Latitude input** — type a latitude value directly. The marker on the map auto-syncs to whatever you type.
2. **Editable Longitude input** — same as above, for longitude.
3. **Paste-coordinates helper** — a single text input that accepts `lat, lng` (or `lat lng`, `lat;lng`, `(lat, lng)`, `[lat, lng]`) and splits the pair into the two coordinate inputs above. Press **Enter** or click **Terapkan** to apply. Invalid formats trigger a toast error.

The previous read-only `Latitude: 3.5952000` / `Longitude: 98.6722000` display row was removed — the editable inputs replace it. The Radius and "Buka di Google Maps" link remain.

### UX details

- **Local text buffer** — each `CoordinateInput` maintains its own local text buffer so the user can type partial values like `3.` or `-` without the parent state forcing a reformat mid-keystroke.
- **Commit on blur or Enter** — the buffer is committed to the parent state on blur or when the user presses Enter. The value is parsed with `Number(...)`, clamped to the valid range (`[-90, 90]` for latitude, `[-180, 180]` for longitude), and the clamped value is written back to the buffer so the user always sees the canonical value.
- **External sync** — when the parent value changes externally (marker drag, paste-coords helper, selecting a different checkpoint), the buffer is re-synced from the parent via `useEffect`.
- **Paste formats accepted** — `3.5952, 98.6722`, `3.5952 98.6722`, `3.5952;98.6722`, `(3.5952, 98.6722)`, `[3.5952, 98.6722]`. Negative values work (`-6.5, 107.5`). Wrapping whitespace is tolerated.
- **Error feedback** — invalid paste formats trigger a `toast.error("Format koordinat tidak valid. Gunakan format: lat, lng (mis. 3.5952, 98.6722).")`. Successful applies trigger a `toast.success("Koordinat diterapkan: 3.5952, 98.6722")`.
- **Marker auto-sync** — the existing `useEffect` on `points` already re-renders markers when the checkpoints array changes, so typing a new latitude moves the marker on the map automatically. No new sync logic was needed.

### Files changed

| File | Change |
|---|---|
| `src/components/app/checkpoint-map-editor.tsx` | Added `toast` import. Added `CoordinateInput` helper component (local-text-buffer pattern). Added `parsePastedCoords` helper function (regex-based parser). Modified the selected-checkpoint editor section: replaced the read-only lat/lng display with two `CoordinateInput` components, added a paste-coordinates helper input + "Terapkan" button. |

### Usage

1. Navigate to **Rute & Checkpoint** → pick a route.
2. Click a checkpoint on the map (or in the list below) to open the editor form.
3. To type coordinates directly: edit the **Latitude** and **Longitude** inputs. Press Tab or Enter (or click outside) to commit. The marker moves to the new position.
4. To paste coordinates: paste a `lat, lng` pair into the **Tempel koordinat (lat, lng)** field. Press Enter or click **Terapkan**. Both coordinate inputs update and the marker moves.
5. Click **Simpan Semua Checkpoint** at the top to persist the changes server-side.
