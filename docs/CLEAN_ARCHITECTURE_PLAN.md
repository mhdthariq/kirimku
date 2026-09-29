# Kirimku — Clean Architecture & Modernization Plan

**Written:** 2026-09-26
**Purpose:** a concrete, phased roadmap for the "make the project clean" ask —
real routing, smaller files, a test suite, and less duplication — written so
it can be executed later without breaking the app in the meantime.

> **Progress (updated 2026-09-29):** Phase 1 (§4.1, `src/lib/**` unit tests)
> is done. Phase 2 (§3, routing scaffolding) is in progress — 5 pages are
> now migrated to real routes: Tariffs, Customers, Gudang (2026-09-27), then
> Pickups and Deliveries (2026-09-29, see `docs/CHANGES_2026-09-29-phase2.md`).
> The scaffolding pattern is proven out at this point; the remaining ~24
> pages are the same mechanical steps. Next up per the suggested order:
> Dashboard, Access, then Shipments last (after Phase 3 splits it).

This is a plan document, not a redo of the app. Nothing in this file has been
applied to the code. It's meant to be picked up incrementally, a phase (or
even half a phase) at a time, by whoever is available — including a future
Claude session.

---

## 1. What's here today (baseline, so we know what "done" moves away from)

- **Routing:** one real Next.js route (`/tracking-paket`) plus a single
  catch-all page. Every other "page" is a React component (29 of them in
  `src/components/app/pages/`) toggled by a **custom hash router**
  (`src/hooks/use-hash-route.ts`, `#/gudang`, `#/shipments/12`). All internal
  navigation is `<a href="#/...">`, not `<Link>`. This is why the browser
  back/forward/refresh/share/bookmark experience doesn't work like a normal
  site, and why the ask says "still just using # as link."
- **File size:** 29 page files, 13.5k lines total. `shipments-page.tsx` alone
  is **2,173 lines** — it contains the list view, the create form, the detail
  view, the pricing card, the package/detail editor, and several dialogs, all
  in one component. Several other pages (`access-page.tsx` 1,000 lines,
  `dashboard-page.tsx` 846, `repairs-page.tsx` 747) have the same shape:
  one file doing list + form + detail + dialogs.
- **Tests:** none. No `*.test.ts`, no test runner configured, no CI step that
  would catch a regression before it reaches production.
- **Backend:** actually in reasonable shape — ~1 route file per resource
  under `src/app/api/v1/*`, using Prisma directly, with shared helpers in
  `src/lib/*` (`pricing.ts`, `api-helpers.ts`, `auth.ts`). This layer doesn't
  need a rewrite, just some splitting of the biggest handlers (see §5).
- **Shared UI:** `src/components/app/form-parts.tsx`, `data-table.tsx`,
  `status-badge.tsx` etc. are already reasonably factored and reused — keep
  this pattern, extend it rather than replacing it.

## 2. Target architecture

Recommendation: **feature-folder + thin layers**, not a full hexagonal/clean
rewrite. A textbook clean-architecture (entities/use-cases/adapters/frameworks
in separate packages) is overkill for a Next.js CRUD app of this size and
would slow the team down more than the current mess does. The pragmatic
version that gets you 90% of the benefit:

```
src/
  app/                          # Next.js App Router — real routes, thin
    (dashboard)/                # route group sharing the sidebar layout
      layout.tsx                 # sidebar/shell, replaces the current SPA shell
      dashboard/page.tsx
      shipments/
        page.tsx                 # list — imports from features/shipments
        [id]/page.tsx             # detail
        new/page.tsx              # create form
      pickups/page.tsx
      deliveries/page.tsx
      gudang/page.tsx
      ...one folder per current hash route
    api/v1/...                  # unchanged
  features/
    shipments/
      components/
        shipment-list.tsx
        shipment-create-form.tsx
        shipment-detail.tsx
        pricing-card.tsx
        package-editor-dialog.tsx
      hooks/
        use-shipment-form.ts      # form state + submit logic, extracted
        use-shipment-pricing.ts   # pricing-preview derivation, extracted
      types.ts                    # re-export or narrow client-api types
    pickups/...
    deliveries/...
    tariffs/...
    customers/...
    gudang/...
    ...one folder per domain area (mirrors the current pages list)
  components/
    app/                        # shared, cross-feature UI (data-table, form-parts, status-badge, leaflet-picker, coordinate-paste-field, task-points-map, ...) — stays as-is
    ui/                         # shadcn primitives — stays as-is
  lib/                          # pure, framework-free logic — pricing.ts, coordinates.ts, customer-display.ts, api-helpers.ts — stays as-is, this is already the best-organized part of the codebase
  hooks/                       # cross-feature hooks (use-auth, use-api-data)
```

Rationale:
- `app/**/page.tsx` becomes a thin route file that renders a feature
  component and reads route params/search params — no business logic lives
  in the route file itself.
- `features/<name>/` is where a 2,000-line page gets split: list, create
  form, detail view, and the dialogs each become their own file, with shared
  state pulled into `hooks/use-*.ts`. This is the direct fix for "reduce the
  file and remove unnecessary things."
- `lib/` stays exactly as it is today — it's already framework-free,
  side-effect-free, and the most testable part of the app. This plan doesn't
  touch it structurally, just adds tests to it (§4).

## 3. Routing migration (the "not using route like regular web" fix)

This is the highest-risk, highest-value piece, so it's designed to be done
**incrementally, one route at a time, with the app working after every
step** — never a big-bang cutover.

**Step 0 — scaffolding (do once, ~1 day):**
1. Add a `(dashboard)` route group with a `layout.tsx` that renders the
   existing sidebar/topbar shell (extract it from wherever the current SPA
   shell lives) and an `<Outlet>`-equivalent `{children}`.
2. Keep `useHashRoute()` mounted **alongside** real routes during the
   migration: add a tiny redirect layer — a route accessed at
   `#/shipments` should 301-equivalent (client-side `redirect()`) to
   `/shipments`, so old bookmarks/links don't break while both systems
   coexist.
3. Replace every `<a href="#/...">` with `<Link href="/...">` **only on the
   pages that have already been migrated** — don't touch the ones that
   haven't yet, or you'll break their navigation before their real route
   exists.

**Step N — migrate one page at a time (~0.5–1.5 days each depending on size):**
For each entry in the current pages list:
1. Create `app/(dashboard)/<route>/page.tsx`.
2. Move the page component's JSX/logic into `features/<name>/components/...`
   largely as-is first (don't refactor and reroute in the same step — that
   doubles the risk of a change you can't easily bisect).
3. Wire params: anything currently read from the hash (`segments[1]` for an
   id, `query.get("tab")`) becomes a real route param / `useSearchParams()`.
4. Update in-app links that point at this page to `<Link href="/...">`.
5. Smoke-test that page manually (or via the Playwright suite once §4 exists).
6. Ship it. The app is fully working with N migrated + (29−N) hash routes
   at every point in this process.

**Suggested order** (cheapest/lowest-traffic first, to build confidence
before tackling the big ones): `tariffs`, `customers`, `gudang` → `pickups`,
`deliveries` → `dashboard`, `access` → `shipments` (last, because it's the
biggest and most central).

**Do not** attempt this as one PR. At 29 pages and ~13.5k lines, a single
big-bang migration is exactly the kind of change that's unreviewable and
unbisectable if something breaks in production.

> **Pitfall found while migrating the first 3 pages (2026-09-27):** a page
> can contain its own internal `href="#/shipments/123"`-style links (e.g.
> Gudang linking to a shipment). These work fine while the page only ever
> renders at `/` (the fragment is relative to whatever path you're on), but
> break the moment the page gets a real route — `href="#/x"` from `/gudang`
> resolves to `/gudang#/x`, not `/#/x`. Before migrating a page, grep it
> (and anything it renders) for `href="#` / `` href={`#... `` and change
> any hit to an **absolute** hash link (`/#/x`) or, better, a real path if
> the target is already migrated too. `docs/CHANGES_2026-09-27-phase2.md`
> has the exact fix applied to Gudang as a reference.

## 4. Test suite (currently zero coverage)

Recommended stack: **Vitest** (fast, native ESM/TS, works well with Next.js)
+ **React Testing Library** for components + **Playwright** for a handful of
end-to-end smoke tests. Add in this order, since each layer catches
different classes of bugs and the first layer is by far the highest
value-per-hour:

1. **`src/lib/*` unit tests first** (~2–3 days for meaningful coverage).
   This is pure logic, already framework-free, and is exactly where a silent
   bug is most expensive (wrong price on an invoice, wrong coordinate parse).
   Start with:
   - `pricing.test.ts` — the three pricing methods (kg/koli/cubic), rounding
     modes, minimum-chargeable floors, and the B2C-forced-to-kg rule.
   - `coordinates.test.ts` — decimal and DMS parsing, invalid input, N/S/E/W
     hemisphere handling.
   - `customer-display.test.ts` — B2B-with-company, B2B-without-company
     (fallback), B2C.
2. **API route tests** (~1 week) — Vitest + a test Postgres (or SQLite via
   Prisma's `sqlite` provider in a separate test schema) hitting the route
   handlers directly. Prioritize `shipments`, `tariffs`, `pickups`,
   `deliveries`, `[id]/price` — anything that touches money or a status
   transition.
3. **Component tests** (~1 week, ongoing) — React Testing Library for the
   trickiest interactive pieces (the shipment create form, the tariff
   pricing-method switcher, the coordinate paste field) rather than every
   component — a snapshot test of a static list view has low value.
4. **E2E smoke tests** (~2–3 days) — Playwright, 5–10 critical paths only:
   log in, create a B2C shipment end-to-end, create a B2B shipment with each
   pricing method, assign + complete a pickup, assign + complete a delivery.
   These are what actually catch a routing-migration regression, so stand
   these up *before* migrating the biggest pages in §3.
5. **CI gate** — run `vitest` + `tsc --noEmit` on every PR; add Playwright
   as a required check once it's stable (flaky e2e gates block more than
   they help, so let it run "informational" for a couple of weeks first).

## 5. File-size / duplication cleanup

> **Worked example (done 2026-09-27):** `src/lib/pricing.ts` imported `db`
> at module scope purely so two DB-touching functions (`resolveTariff`,
> `pricingPreview`) could live next to the pure formula. That one import
> made the *entire file* untestable without a live database. Split into
> `pricing.ts` (pure — `computePricing`, `normalizePricingMethod`, etc., now
> covered by `pricing.test.ts`) and `pricing-server.ts` (the two DB-touching
> functions, importing the pure ones from `./pricing`). Same pattern applies
> anywhere else a `lib/*` file mixes pure logic with a `db` import — check
> for this before writing tests against it, not after.

Concrete, low-risk wins that don't require the routing migration to land
first:

- **`shipments-page.tsx` (2,173 lines)** → split into `shipment-list.tsx`,
  `shipment-create-form.tsx`, `shipment-detail.tsx`, `pricing-card.tsx`
  (the block this session made method-aware), `package-editor-dialog.tsx`.
  Pull the pricing-preview derivation and the create-form state into
  `use-shipment-pricing.ts` / `use-shipment-form.ts` hooks — this alone
  makes the pricing logic testable in isolation (§4.3).
- **`access-page.tsx` (1,000 lines)** → split by tab (Users / Roles /
  Permissions are almost certainly three separate concerns living in one
  file).
- **Repeated list-column patterns** (customer name cell, status badge cell,
  address cell) appear near-identically across `pickups-page.tsx`,
  `deliveries-page.tsx`, `gudang-page.tsx`, `shipments-page.tsx` — worth a
  small shared `<CustomerCell customer={...} />` component now that
  `customer-display.ts` centralizes the display logic; would have made this
  session's B2B-name fix a one-file change instead of an eight-file one.
- **`src/app/api/v1/dashboard/route.ts` and `dashboard/kurir/route.ts`** are
  large single-file handlers doing several unrelated aggregations — worth
  splitting into one function per widget/section once tests exist to cover
  the split (§4.2), so the split itself is verifiably behavior-preserving.

## 6. Responsiveness / "too much text"

Not addressed in this pass — flagged for a follow-up design/content review,
since it's a different kind of work (visual density, copy length, mobile
breakpoints) from the structural items above. Two concrete starting points
once someone picks this up:
- Audit `hideOnMobile` usage in `data-table.tsx` columns — several pages
  don't use it yet, which is likely the biggest "too much text on mobile"
  contributor.
- The dialogs across pickups/deliveries/gudang/tariffs are close to
  identical in structure — a shared `<EntityFormDialog>` wrapper would cut
  a lot of repeated (and inconsistently-responsive) markup at once.

## 7. Suggested sequencing

If tackled in order, each phase leaves the app fully working:

| Phase | Work | Est. | Status |
|---|---|---|---|
| 1 | Test scaffolding + `lib/*` unit tests (§4.1) | ~1 week | **Done** (2026-09-27) |
| 2 | Routing scaffolding + migrate 3–4 low-traffic pages (§3) | ~1 week | **In progress** — Tariffs/Customers/Gudang (2026-09-27), Pickups/Deliveries (2026-09-29) done; ~24 pages left |
| 3 | Split `shipments-page.tsx` (§5) *before* migrating its route — smaller pieces are safer to move | ~1 week | Not started |
| 4 | Migrate remaining pages, `shipments` last (§3) | ~2–3 weeks | Not started |
| 5 | API route tests + Playwright smoke suite (§4.2, §4.4) | ~1.5 weeks | Not started |
| 6 | Component tests, ongoing | ongoing | Not started |
| 7 | Responsiveness/content pass (§6) | separate track, can run in parallel | Not started |

Total for phases 1–5: roughly **6–8 weeks** for one engineer, less with two
people splitting the page migrations in phase 4 (they're independent of each
other once phases 1–3 land).
