# Tests and quality checks

## Commands

```sh
bun install --frozen-lockfile
bun run lint --max-warnings 0
bun run test
bun run test:ui
bun run test:api
bun run test:regression
bun run test:coverage
```

`test` runs every Vitest suite. `test:ui` selects components and hooks; `test:api` selects API route suites. `test:regression` selects the UI/API suites plus coordinate parsing and transport-operation rules. Regression tests live alongside unit tests rather than duplicating fixtures in a separate suite. `test:watch` is available for development.

## Structure and isolation

- Colocate tests with source as `*.test.ts` or `*.test.tsx`.
- Library and route tests run in Node. React tests opt into jsdom with `// @vitest-environment jsdom`.
- `tests/setup.ts` installs jest-dom assertions and cleans up mounted components after each test.
- Route suites call the real handlers with NextRequest objects, inspecting response status/body and persisted data passed to mocked database methods. Authentication, database, tenant, and external-service boundaries are mocked. No database schema push, seeded accounts, real camera, or live API is needed.
- UI suites exercise real components with Testing Library and user-event. Dialog tests use real Radix primitives. Camera tests use deferred promises and fake media tracks to reproduce dismissal races.
- Reset mocks and globals between tests. Test happy paths, denied access, malformed inputs, dependency failures, and lifecycle cleanup, not just whether a component renders.

## Current coverage

The verified baseline contains 209 tests across 19 suites, including 85 newly added tests:

- Login: missing/malformed credentials, invalid/inactive users, username normalization, sanitized responses, permissions, seeding gates, and dependency errors.
- Customer detail/update/delete: authentication, method permissions, marketing scope, missing records, validation, restricted assignments, and deletion behavior.
- Delivery completion: courier/scope authorization, terminal statuses, prerequisite scans, proof requirements, transactional writes, and errors.
- UI: valid/invalid/cleared/disabled coordinate input, external map selection, pristine and dirty dialog dismissal, cancel/discard, controlled close/reopen, and audit-panel permission/retry/filter behavior.
- Lifecycle regressions: stale API responses, refresh behavior, viewport subscriptions, and camera promises resolving after dismissal/reopen, including StrictMode.

The coverage configuration includes all library, hook, component, and API route source files so untested areas remain visible. The initial overall statement coverage is approximately **6.9%**; these suites are a focused baseline, not comprehensive application coverage. Reports are written to `coverage/` (gitignored).

## Known gaps and follow-up

- Most API routes, pages, printing, payment/settlement flows, and map interactions still lack tests.
- Mocked route tests do not prove Prisma schema compatibility, transaction rollback in a real database, or HTTP middleware/cookie integration. Add database integration and browser E2E suites separately.
- jsdom does not verify layout, mobile rendering, browser permission prompts, or physical camera/GPS behavior.
- `bunx tsc --noEmit --incremental false` currently reports existing application/schema typing errors (223 diagnostics during this work), including SQLite-incompatible `mode` filters and missing generated-model fields. Lint/test success does not imply a production build succeeds.
- API inspection identified additional validation gaps: customer `isActive` string coercion, empty base64 delivery-photo payloads, and JSON `null` bodies. These were not changed as part of the lint/test work; add failing regression cases when fixing their request validation.

Before merging changes, run strict lint and the full test suite. Coverage is informational until meaningful per-module targets and broader coverage are established; do not enforce a misleading global threshold against this baseline.
