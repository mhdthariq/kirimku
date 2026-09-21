# 13 — Revision Round 12 (Accounts-Only Seeder, Checkpoint Coordinate Inputs)

This document covers two related changes delivered together:

1. **Accounts-only seeder** — new `bun run db:seed:accounts` script that seeds ONLY the demo accounts (owner + 21 staff/partner), the 3 demo gudang, partner wallets, and the RBAC catalog. No transactional demo data (vehicles, routes, tariffs, customers, shipments, invoices, audit logs) is created. Useful when you want a clean database with working logins but no clutter.
2. **Editable checkpoint coordinates** — the route checkpoint editor now has editable Latitude and Longitude text inputs plus a paste-coordinates helper that accepts `lat, lng` / `lat lng` / `lat;lng` / `(lat, lng)` formats. You can finally type or paste precise coordinates directly instead of fighting the Leaflet drag interface for sub-meter precision.

---

## 1. Accounts-only seeder

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

## 2. Editable checkpoint coordinates

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
