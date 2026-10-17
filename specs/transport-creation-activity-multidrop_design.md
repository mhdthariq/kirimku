# Transport creation and Activity MultiDrop fix

## Scope and acceptance criteria
- Creating a transport containing multiple DIRECT-fulfillment shipments creates distinct pickup codes in the same transaction, instead of a duplicate-key 500.
- DIRECT/MULTI_DROP transport mode is independent of CHECKPOINT/ACTIVITY tracking mode in creation, editing and evidence submission.
- ACTIVITY MultiDrop supports per-shipment unloading while DEPARTED without checkpoint assignment/check-in. CHECKPOINT MultiDrop retains both requirements. Remaining onboard shipments retain the existing arrival behavior.
- Preserve permissions, assigned-crew/warehouse scope, lifecycle guards, tracking-mode evidence lock, image validation and fresh GPS/capture validation. Delivery approval remains a separate operation.
- Do not modify expense, dashboard or shipment-cancellation code.

## Design / implementation plan
1. Reproduce repeated pickup code allocation using the real code generator with isolated global versus transaction DB test doubles.
2. Allow nextCode to read via an optional transaction client; use it for pickup allocation during transport creation and delivery allocation in related arrival/drop transactions.
3. Remove explicit ACTIVITY+MULTI_DROP bans and form coercion. Preserve the transaction-time activity mode/crew/status recheck.
4. Make canDrop tracking-aware (legacy callers default CHECKPOINT). ACTIVITY drops do not assign or require checkpoints; board hides checkpoint assignment and exposes unload actions for loaded shipments while departed.
5. Add route, domain, form and drop-board regressions; run focused Vitest tests and TypeScript checking.

## Security checkpoint
- Existing guard permissions and assertTransportAccess/scope remain in place.
- Only assigned crew or existing transport.arrive administrators can unload; evidence writes still require assigned crew even for owners.
- Server remains authoritative for lifecycle, tracking mode, checkpoint requirements and capture/image validation.
- Prisma query APIs remain parameterized; no new raw SQL or user-generated HTML.
- No schema changes, secrets, new dependencies, external services or sensitive response fields.

## Risks / validation limits
- No production stack trace or database reproduction is available: duplicate codes explain the multi-DIRECT-shipment path, not necessarily every reported creation 500.
- Transaction-local visibility fixes duplicate codes within one request; nextCode's existing cross-request race is not solved by this scoped change.
- Unit/API tests use DB doubles, not production data. No database migration is needed.

## Findings and validation
- Reproduced the creation failure before fixing: the real nextCode helper plus separate committed/transaction test doubles returned the same PICK code twice, causing the simulated unique pickupCode constraint to reject creation with 500. Passing tx lets the second lookup see the first pickup.
- MultiDrop Activity was explicitly rejected in create/edit/evidence routes and reset/disabled in the form. Drop rules and the board additionally required checkpoint check-in; activity-focused drivers had the entire board hidden.
- Focused transport/API/domain/UI run: 150 tests passed in 10 files.
- Full suite: 754 tests passed in 62 files using `npx vitest run --maxWorkers 2`. An initial unrestricted run hit the unrelated dashboard test's 5-second timeout; limited workers avoid resource contention in the full run.
- TypeScript checking is blocked by existing Prisma-related diagnostics; baseline verification overlays original files in memory without touching the working tree.
- No expense, dashboard or shipment cancellation source/tests changed. Physical camera/GPS and a live database were not exercised.
