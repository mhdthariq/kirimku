# Responsive expense controls and exceptional deletion

## Acceptance criteria
- Expense descriptions, approval metadata and GPS links use the available mobile width instead of competing with action buttons. Actions wrap below details on small screens and sit alongside them on large screens.
- `transport.expense.delete` permits deletion of PENDING expenses only.
- Independent `transport.expense.delete-approved` permits removal of APPROVED and CANCELLED expenses, including previously approved entries; Owner receives it by default. Existing regular delete and approval grants do not imply it.
- Both shipment and transport controls follow the same status-sensitive permissions. Removal of approved/cancelled entries retains confirmation, mandatory reason and transactional audit.

## Implementation and security
Use a mobile-first two-column grid (icon and minmax(0, 1fr) details) with a separate wrapping action group. Allow long identifiers and metadata to wrap. Register the permission in the existing RBAC catalog and rely on its tenant-aware synchronization rather than altering existing role grants. Enforce the special permission in the shared server reversal service, not only the UI. Preserve authentication, resource scope checks, bounded reason validation, conditional mutations and audit logs. Test permission separation and reason confirmation in service/API and component suites; layout class assertions cover structure but do not replace browser viewport verification.
