# 01 — Architecture

## Overview

Kirimku is a single Next.js 16 project serving the React UI and REST API under `/api/v1/`. The Next.js layout, routes, components, and hooks remain in their framework-oriented locations.

The codebase is undergoing an **incremental migration**, not a completed Clean Architecture implementation. Pricing is the completed port/use-case slice: its application service depends on a repository port and pure domain rules, with a Prisma adapter wired at the composition boundary. Other API routes still query Prisma directly, and DB-dependent business helpers remain in infrastructure.

## Current structure

```text
src/
├── app/                       # Next.js layout, pages, API route handlers
├── components/                # Application UI and reusable UI primitives
├── hooks/                     # React hooks
├── domain/                    # Pure capacity, pricing, shipment-flow, transport-ops rules
├── application/pricing/       # Repository port and pricing service/use case
├── infrastructure/
│   ├── persistence/           # db and tenant-context
│   ├── auth/                  # auth and rbac
│   ├── http/                  # client-api and license integration
│   ├── pricing/               # Prisma pricing repository adapter
│   └── services/              # Legacy DB-dependent business helpers
├── composition/               # api-helpers and pricing-server wiring
├── presentation/              # Display, form, and browser helpers
└── shared/                    # Shared utilities
prisma/                        # PostgreSQL schema and seed entry points
tests/                         # Tests outside production source
```

`src/lib/` has been removed and imports rewritten to the appropriate layers. Relocating a helper does not itself make it a pure domain rule: database-backed payment, cancellation, scan, audit, and other operational helpers remain under `src/infrastructure/services/`.

## Pricing boundary and dependency direction

```text
API route → composition/pricing-server
                ├── application/pricing/pricing-service
                │       ├── application/pricing/pricing-repository (port)
                │       └── domain/pricing (pure rules)
                └── infrastructure/pricing/prisma-pricing-repository (adapter)
                            └── infrastructure/persistence
```

- Domain code must remain independent of application, infrastructure, composition, presentation, and framework/DB dependencies.
- Application code may depend on domain rules and its own ports, not concrete infrastructure or Next.js/React/Prisma implementations.
- Composition constructs concrete dependencies; infrastructure implements external concerns.
- Dependency constraints are tested under `tests/architecture/`. These checks protect the extracted layers, not a claim that every route already follows the new boundary.

Pricing extraction does not mean the full shipment workflow has been migrated. Remaining routes still combine HTTP handling, authorization, orchestration, and direct persistence access. Future slices should move orchestration behind ports incrementally rather than require a big-bang rewrite.

## Runtime and technology

| Concern | Current implementation |
|---|---|
| Framework | Next.js 16 App Router; React 19 |
| UI | Tailwind CSS 4, shadcn/ui, hash-routed application shell |
| Persistence | PostgreSQL schema; Prisma and Prisma Client pinned to 6.11.1 |
| Authorization | Custom bearer-token authentication and permission-based RBAC |
| Validation | Zod at API boundaries |
| Browser integrations | Leaflet and browser helpers outside the pure domain |

The Prisma 6.11.1 client has been regenerated for the PostgreSQL schema. The current local `.env` has a `DATABASE_URL` incompatible with PostgreSQL; configure a valid PostgreSQL URL before database-backed execution. A Prisma 7 editor language server may flag the schema's `url = env("DATABASE_URL")`; use a language server matching Prisma 6.11.1 rather than deleting the required URL field.

**No database migrations were run as part of this restructuring.** Client generation does not migrate or initialize a database.

## Tests and documentation

Tests remain outside `src/` and mirror the new domain, application, infrastructure, presentation, and shared layers. UI and API suites retain their `tests/components/`, `tests/hooks/`, and `tests/app/api/` locations. `tests/lib/` has been removed. See [testing](testing.md).

See [ADR 001](adr-001-incremental-layered-migration.md) for the decision and tradeoffs. Earlier revision documents and migration plans may remain archival; they are not authoritative descriptions of the current layout.
