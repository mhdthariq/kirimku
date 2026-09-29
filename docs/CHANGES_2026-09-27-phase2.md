# Changes 2026-09-27 (part 2) — Phase 2 of the clean-architecture plan

Continuing `docs/CLEAN_ARCHITECTURE_PLAN.md` §3. This pass builds the
routing-migration scaffolding and migrates the first 3 pages as a proof of
concept, using the strangler-fig approach the plan describes: **the hash
router and real routes coexist**, nothing was done as a big-bang cutover,
and the app works identically for every page whether it's migrated yet or
not.

## Added
- **`src/app/(dashboard)/layout.tsx`** — layout for real routes: `AuthGate`
  then `AppShell`, fed the real pathname via `usePathname()`.
- **`src/app/(dashboard)/tariffs/page.tsx`**, **`.../customers/page.tsx`**,
  **`.../gudang/page.tsx`** — thin real routes. Each just renders the
  existing page component (`TariffsPage`, `CustomersPage`, `GudangPage`)
  unchanged — no logic was moved or rewritten, only how it's reached.
- **`src/components/app/auth-gate.tsx`** — the loading/login-screen guard,
  extracted out of `src/app/page.tsx` so both the legacy hash shell and the
  new real-route layout show it identically instead of duplicating the JSX.

## Changed
- **`src/app/layout.tsx`** — `AuthProvider` now mounts once, here, at the
  true root — shared by both the old hash-routed shell and the new real
  routes. A session started on one carries over to the other with no extra
  `/auth/me` fetch. (Previously `AuthProvider` only wrapped the old SPA at
  `src/app/page.tsx`, which would have meant a second, disconnected auth
  context for anything under the new route group.)
- **`src/app/page.tsx`** — the legacy hash-router shell:
  - Removed the (now redundant) local `AuthProvider` and inline
    loading/login JSX — uses the shared `AuthGate` instead.
  - Added a redirect effect: landing on `#/tariffs`, `#/customers`, or
    `#/gudang` now does `router.replace("/tariffs")` etc. (a real Next.js
    navigation) instead of rendering the old copy of that page. Old
    bookmarks/links to the hash routes keep working, just via one redirect.
  - Removed the now-dead imports/cases for `TariffsPage`, `CustomersPage`,
    `GudangPage` (they're rendered exclusively from the new real routes
    now — no duplicate copies of the logic anywhere).
- **`src/components/app/app-shell.tsx`** — the sidebar/topbar nav:
  - Added a `MIGRATED_ROUTES` set (`/tariffs`, `/customers`, `/gudang` so
    far). A nav item whose `href` is in this set renders as a real
    `next/link` `<Link>`; everything else still renders as a hash `<a>`, but
    now with an **absolute** hash href (`/#/x` instead of `#/x`) — see the
    pitfall note below for why that fix was necessary.
  - Applied the same Link-vs-hash-anchor logic to the mobile bottom nav bar
    (a separate inline render, not the shared `NavLink` component).
- **`src/components/app/pages/gudang-page.tsx`** — fixed an internal
  `href="#/shipments/${id}"` link to be absolute (`/#/shipments/${id}`).
- **`src/components/app/pages/dashboard-page.tsx`** — two links that pointed
  at Gudang/Customers now point at their real routes (`/gudang`,
  `/customers`) directly instead of via the hash-redirect detour, since
  those pages are migrated now.

## Pitfall found (documented in the plan for the next pages)
A page can contain its own internal hash links (Gudang linking out to a
shipment, for example). Those are harmless while the page only ever renders
at `/`, but once the page has a **real route**, a bare `href="#/x"` resolves
relative to *that* route (`/gudang#/x`) instead of the app root (`/#/x`) —
silently broken navigation, no error. Checked all 3 migrated pages for this
before calling them done; found and fixed one instance (Gudang → shipment
detail link). Documented in the plan (§3) so whoever migrates the next page
checks for this too.

## Not touched
- `shipments-page.tsx` and the other ~26 pages — still hash-routed,
  unaffected, work exactly as before.
- No page's internal logic, styling, or data-fetching changed — only how
  each of the 3 migrated pages is *reached*.

## Verification
- All touched files pass an esbuild syntax check (this sandbox still can't
  reach `binaries.prisma.sh` to generate the Prisma client — a real
  `tsc --noEmit` / `next build` still needs to run on your end before
  deploying).
- The 38 unit tests from Phase 1 still pass unchanged (routing changes
  don't touch `src/lib/**`).
- **Please manually smoke-test** after pulling this: log in, click each of
  Tariffs/Customers/Gudang from the sidebar (desktop and mobile), confirm
  the URL bar shows a real `/tariffs` etc. (not `/#/tariffs`), refresh the
  page on `/gudang` directly and confirm it still loads (this is the exact
  behavior the hash router couldn't do before), and click a shipment code
  from inside Gudang to confirm it still lands on the right shipment.

## Next
Per the plan's suggested order: `pickups`, `deliveries` next (Phase 2
continues), then Phase 3 (splitting `shipments-page.tsx`) before that page
gets its own real route in Phase 4.
