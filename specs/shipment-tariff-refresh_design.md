# Shipment and tariff refresh

- Keep Tariff.id as the immutable primary key and preserve historical shipment references.
- Expire tariffs before list/options reads and tariff writes. A date-only end date includes the whole UTC date, matching the existing date storage convention. No background scheduler is required; persisted flags are refreshed on access.
- Only active tariffs reserve name + route + customer scope. Enforce this in create/update validation and a PostgreSQL partial unique index, including nullable legacy scopes. Preserve rows when reconciling pre-existing active duplicates in the migration.
- Default tariff listings to Aktif; offer All and Nonaktif and remove the status column. Keep validity dates visible on mobile.
- Improve shipment summary, wrapping tabs, compact accessible filters, and tablet/mobile presentation without changing shipment operations.
- Keep existing permission guards, tenant-scoped database access, parameterized Prisma writes, and audit logging. Validate date ranges on client and server. Return a useful conflict response for concurrent active duplicates.
- Verify lifecycle/create/update regressions, tariff filter behavior, existing shipment tests, lint, and TypeScript.
