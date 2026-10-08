# ADR 001 — Incremental layered migration with a pricing port/use-case slice

- Status: Accepted
- Date: 2026-10-08

## Context

The former `src/lib/` mixed pure rules, database-backed helpers, browser utilities, and framework wiring. Reorganizing those responsibilities improves dependency visibility without rewriting all operational routes at once.

## Decision

Remove `src/lib/` and rewrite imports into explicit layers:

- `src/domain/`: pure capacity, pricing, shipment-flow, and transport-ops rules.
- `src/application/pricing/`: repository port and pricing service/use case.
- `src/infrastructure/`: persistence (`db`, tenant context), auth/RBAC, HTTP integrations, the Prisma pricing adapter, and legacy DB-dependent services.
- `src/composition/`: API helpers and pricing-server dependency wiring.
- `src/presentation/`: display, form, and browser helpers.
- `src/shared/`: shared utilities.

Keep Next.js `src/app/`, components, and hooks in place. Pricing is the completed port/use-case slice; other API routes still access Prisma directly. This is **incremental migration, not full Clean Architecture**. Domain/application dependency constraints are tested under `tests/architecture/`.

Keep existing helper tests in `tests/lib/` temporarily. Pricing application tests already have a layer-specific location; domain, presentation, shared, and further application test folders are planned as tests move to mirror the source layers.

## Tradeoffs and consequences

- Pure rules and pricing orchestration can be tested without Prisma, Next.js, or a live database.
- Explicit ports add adapter and composition code, but keep concrete persistence out of the pricing use case.
- Incremental delivery reduces rewrite risk, at the cost of mixed architectural styles and direct-Prisma routes during the transition.
- Moving DB-dependent helpers into infrastructure documents their coupling; it does not remove that coupling or complete their migration.
- Historical test paths temporarily differ from source paths. Coverage configuration and test selectors must be updated when tests/layers move.
- Historical revision documents may remain archival rather than being rewritten as current specifications.

## Database and tooling

The schema targets PostgreSQL and Prisma/Prisma Client are pinned to 6.11.1. The client has been regenerated. **No database migrations were run for this restructuring**, and generation is not evidence of a live database upgrade.

The local `.env` `DATABASE_URL` is incompatible with PostgreSQL and must be corrected before database-backed validation. Prisma 7 editor URL diagnostics reflect a tooling-version mismatch: use a matching Prisma 6 language server, not deletion of the required schema URL.

## Validation and follow-up

Run the architecture constraints, pricing service tests, full Vitest suite, strict lint, and TypeScript check. The previous TypeScript error baseline has been fixed; final test/coverage totals should come from the latest run rather than fixed documentation counts. Mocked tests do not prove PostgreSQL connectivity or real transaction behavior.

Extract additional application slices behind ports as needed, and move tests to layer-mirroring folders separately. See [architecture](01-architecture.md) and [testing](testing.md).
