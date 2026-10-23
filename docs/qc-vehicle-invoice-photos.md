# Vehicle, invoice, and photo upload QC — 23 October 2026

## Results

- Full Vitest suite: 1,024 passed, 6 failed, 1,030 total.
- All six failures reproduced in a separate checkout of committed HEAD before these changes.
- TypeScript: passed (`tsc --noEmit`).
- ESLint: passed for all changed application files and new tests.
- Prisma schema validation: passed.
- Git whitespace check: passed.

## Added regression coverage

- Creating an invoice and opening another without reloading excludes the already billed shipment.
- Invoice creation, draft editing, and line insertion reject shipments without an arrived transport, cancelled shipments, and shipments already invoiced.
- ARRIVED and COMPLETED transports qualify for invoice linking.
- Pasted images use the existing upload change handler; disabled and unsupported uploads stay unchanged.
- Clicking the paste area inside an upload label focuses it without opening the file picker.
- Vehicle uploads show a preview and submit their image; editing preserves existing images and supports removal.
- Oversized images preserve the existing preview; server validation accepts exactly 4 MB and rejects larger images, unsupported types, and malformed data URLs.

## Existing failures reproduced on HEAD

- architecture dependency boundaries application\pricing\pricing-repository.ts only depends inward
- architecture dependency boundaries application\pricing\pricing-service.ts only depends inward
- shipment invoice and deletion controls filters invoice membership using existing lines, including cancelled invoice lines
- shared transport expenses on shipments deduplicates transport IDs and separates approved from pending
- shared transport expenses on shipments excludes inaccessible linked transports
- COMPLETED transport consumers counts both arrived and completed partner trips awaiting financial settlement

## Verification limits and deployment

- Production build could not be completed. Google Fonts requests for Geist and Geist Mono timed out even with network permission. Turbopack additionally failed to launch its CSS worker; the Webpack fallback reached the same font-download blocker.
- Responsive layout changes were checked in component tests and TypeScript; live browser viewport and real system clipboard checks were not completed.
- The vehicle photo migration is included at `prisma/migrations/20261023000000_vehicle_photo/migration.sql`. It was applied to rajawalilogistik on 23 October 2026, together with the undo-arrival migration. Prisma confirmed all 21 migrations applied.
- Graphify AST update completed. SQL extraction remains unavailable because the optional tree_sitter_sql dependency is missing.
