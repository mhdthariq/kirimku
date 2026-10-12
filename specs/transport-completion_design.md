# Transport audit completion

## Acceptance criteria
- Arrival remains ARRIVED and never automatically marks a transport COMPLETED.
- A reviewer with transport.complete (Audit and complete transport) may explicitly confirm ARRIVED -> COMPLETED after reviewing existing photos, shipment information and expenses.
- Permission defaults to Owner only, is assignable through existing role/user settings, and uses established transport scope enforcement.
- Persist authenticated reviewer ID, username, role snapshot and completed timestamp; audit the transition. Client-supplied identity is ignored.
- Reject completion before arrival and duplicate/concurrent confirmations. Preserve existing shipment statuses and delivery approval as separate workflows.
- Completed transports cannot be reopened through editing or arrival/departure. Lists, history, settlement and return-task mapping understand the terminal status.

## Design and security
Add optional completion snapshot fields to Transport, with no historical backfill. POST /transports/:id/complete uses permission guard and assertTransportAccess before a conditional ARRIVED-only update. The reviewer confirms the audit in a UI dialog; this is a manual sign-off, not an automatic claim that shipment delivery scans completed. Existing database-driven permission management exposes the new permission. No driver default grant.

Migration is additive and inserts the permission plus Owner role grant. Existing permission/warehouse scopes stay intact. Do not modify arrival timestamp, package statuses, expense approvals or delivery approval on completion.

## Validation
Test permission denial, scope denial, state transitions, concurrency and authenticated snapshot metadata. Validate UI gating and completed status display. Run typecheck, tests and production build; migration needs deployment against PostgreSQL.
