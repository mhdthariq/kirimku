# Changes 2026-09-29 (part 2) — Pickups & Deliveries migrated to real routes

Continuing Phase 2 of `docs/CLEAN_ARCHITECTURE_PLAN.md` §3, same
strangler-fig approach as the Tariffs/Customers/Gudang migration: hash
router and real routes coexist, nothing is a big-bang cutover.

## Added
- **`src/app/(dashboard)/pickups/page.tsx`**, **`.../deliveries/page.tsx`** —
  thin real routes, each rendering the existing `PickupsPage` /
  `DeliveriesPage` component unchanged.

## Changed
- **`src/components/app/app-shell.tsx`** — `MIGRATED_ROUTES` now includes
  `/pickups` and `/deliveries`, so their sidebar/mobile-nav links render as
  real `next/link` links.
- **`src/app/page.tsx`** (legacy hash shell) — `MIGRATED_SECTIONS` extended
  the same way; `#/pickups` and `#/deliveries` now redirect to the real
  routes via `router.replace(...)`. Removed the now-dead `PickupsPage` /
  `DeliveriesPage` imports and switch cases.
- **`src/components/app/pages/kurir-dashboard-page.tsx`**,
  **`dashboard-page.tsx`** — the stat-card links and "lihat semua" links
  that pointed at `#/pickups` / `#/deliveries` now point at the real
  `/pickups` / `/deliveries` paths directly (both files are rendered
  exclusively from `/`, so this is a no-behavior-change cleanup, same as
  the equivalent fix made for Gudang/Customers in the first migration
  batch — no extra redirect hop needed once the target is a real route).

## Checked (per the pitfall documented from the first 3-page migration)
Searched both pages and everything that links to them for internal
`href="#/..."`-style links that would break once the page has a real route
(a bare `#/x` resolves relative to the *current* path, not the app root).
**Neither `pickups-page.tsx` nor `deliveries-page.tsx` had any** — no fix
needed there, unlike Gudang last time.

## Not touched
- Every other still-hash-routed page — unaffected, works exactly as before.
- No logic, styling, or data-fetching changed in either page — only how
  they're reached.

## Verification
- All touched files pass an esbuild syntax check.
- The 63 unit tests still pass unchanged (routing doesn't touch `src/lib/**`).
- **Please manually smoke-test**: click Pickups and Deliveries from the
  sidebar (desktop + mobile), confirm the URL bar shows `/pickups` /
  `/deliveries` (not `/#/...`), refresh directly on each to confirm it still
  loads, and click through from the Dashboard and Kurir Dashboard stat cards
  to confirm those links land correctly too.

## Next
5 of 29 pages migrated. Per the plan's suggested order, next is Dashboard
and Access — or Phase 3 (splitting the 2,173-line `shipments-page.tsx`)
first, since that's recommended to happen *before* Shipments itself gets a
real route.
