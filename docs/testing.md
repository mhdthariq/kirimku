# Tests and quality checks

## Commands

```sh
bun install --frozen-lockfile
bun run lint --max-warnings 0
bunx tsc --noEmit --incremental false
bun run test
bun run test:ui
bun run test:api
bun run test:regression
bun run test:coverage
```

`test` runs every Vitest suite. `test:ui` selects components and hooks; `test:api` selects API route suites. `test:regression` selects the UI/API suites plus coordinate parsing and transport-operation rules. Regression tests live alongside unit tests rather than duplicating fixtures in a separate suite. `test:watch` is available for development.

## Structure and isolation

- Keep all tests under `tests/` as `*.test.ts` or `*.test.tsx`, mirroring their source layers. `src/lib/` and `tests/lib/` have been removed.
- `tests/components/` and `tests/hooks/` contain UI suites; `tests/app/api/` contains route suites. Runtime smoke-test scripts also stay under `tests/`.
- `tests/architecture/` tests domain/application dependency constraints. `tests/application/pricing/` contains pricing service tests using the repository port; pricing is the completed port/use-case slice, not evidence that all API routes have migrated away from direct Prisma access.
- Pure rules live in `tests/domain/`; display/form helpers in `tests/presentation/`; utilities in `tests/shared/`; database-dependent service rules in `tests/infrastructure/`. Script selectors follow the new locations.
- Library and route tests run in Node. React tests opt into jsdom with `// @vitest-environment jsdom`.
- `tests/setup.ts` installs jest-dom assertions and cleans up mounted components after each test.
- Route suites call the real handlers with NextRequest objects, inspecting response status/body and persisted data passed to mocked database methods. Authentication, database, tenant, and external-service boundaries are mocked. No database schema push, seeded accounts, real camera, or live API is needed.
- UI suites exercise real components with Testing Library and user-event. Dialog tests use real Radix primitives. Camera tests use deferred promises and fake media tracks to reproduce dismissal races.
- Reset mocks and globals between tests. Test happy paths, denied access, malformed inputs, dependency failures, and lifecycle cleanup, not just whether a component renders.

## Current coverage

The suites cover the following areas. Test counts and coverage totals should come from the final/latest run, not a fixed historical baseline:

- Login: missing/malformed credentials, invalid/inactive users, username normalization, sanitized responses, permissions, seeding gates, and dependency errors.
- Customer detail/update/delete: authentication, method permissions, marketing scope, missing records, validation, restricted assignments, and deletion behavior.
- Delivery completion: courier/scope authorization, terminal statuses, prerequisite scans, proof requirements, transactional writes, and errors.
- UI: valid/invalid/cleared/disabled coordinate input, external map selection, pristine and dirty dialog dismissal, cancel/discard, controlled close/reopen, and audit-panel permission/retry/filter behavior.
- Lifecycle regressions: stale API responses, refresh behavior, viewport subscriptions, and camera promises resolving after dismissal/reopen, including StrictMode.

Coverage reports are written to `coverage/` (gitignored). `vitest.config.mts` includes the new source layers, hooks, components, and API routes. Coverage remains informational rather than comprehensive application coverage.

## Known gaps and follow-up

- Most API routes, pages, printing, payment/settlement flows, and map interactions still lack tests.
- Mocked route tests do not prove Prisma schema compatibility, transaction rollback in a real database, or HTTP middleware/cookie integration. Add database integration and browser E2E suites separately.
- jsdom does not verify layout, mobile rendering, browser permission prompts, or physical camera/GPS behavior.
- The previous application/schema TypeScript error baseline has been fixed; the old 223-diagnostic claim is no longer current. Run `bunx tsc --noEmit --incremental false` again for final validation. Lint/test/typecheck success does not by itself prove a production build succeeds.
- The schema now targets PostgreSQL and the pinned Prisma 6.11.1 client has been regenerated. The local `.env` `DATABASE_URL` is incompatible with PostgreSQL; correct it before database-backed tests. No DB migrations were run during the restructuring.
- Prisma 7 editor diagnostics about the datasource URL are a language-server version mismatch. Use a Prisma 6.11.1-compatible language server rather than deleting the required schema URL.
- API inspection identified additional validation gaps: customer `isActive` string coercion, empty base64 delivery-photo payloads, and JSON `null` bodies. These were not changed as part of the lint/test work; add failing regression cases when fixing their request validation.

Before merging changes, run strict lint, TypeScript checking, and the full test suite (including architecture constraints). Coverage is informational until meaningful per-module targets and broader coverage are established; do not enforce a misleading global threshold against this baseline.
