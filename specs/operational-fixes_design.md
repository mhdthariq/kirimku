# Operational fixes

- Reject shipment cancellation while a non-cancelled invoice references it. Keep existing permission, warehouse scope, transport, delivery and refund rules. Cancelled invoice history remains intact.
- Add TOL (Biaya Tol) to the shared expense category registry; existing API validation, approvals and reports consume that registry.
- Allow MultiDrop with activity tracking and fix transaction-local code allocation for transport-created pickup/delivery tasks (see transport-creation-activity-multidrop_design.md).
- Route dashboard payment verification to Partner Settlements / transport, and marketing commission to Partner Settlements / commission. Persist the selected tab in the existing hash-router query so deep links and browser navigation select the correct tab.

## Security and validation

Retain server-side permission and scope checks; UI navigation grants no additional privileges. Tab input is allowlisted to transport/commission. No new dependencies, secrets, external calls or schema migration. Add API/domain/component regressions and run the test suite; report pre-existing type-check failures separately.
