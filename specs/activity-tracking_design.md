# Activity Tracking and operational expense approval

## Acceptance criteria
- Transport creation selects Checkpoint tracking (existing default) or Activity Tracking (Tanpa Checkpoint), separately from DIRECT/MULTI_DROP. Activity mode supports both DIRECT and MULTI_DROP and does not require checkpoints. ACTIVITY MultiDrop permits per-resi unloading while DEPARTED; checkpoint assignment/check-in remains exclusive to CHECKPOINT tracking.
- Assigned crew can submit multiple live-camera photos, each with fresh GPS, accuracy and capture time. No activity file/gallery upload UI exists. Location/camera denial blocks submission.
- Expenses require fresh GPS on entry/edit and start Pending. Authorized reviewers approve atomically; approved entries display the authenticated approver username and role and are immutable.
- Approval defaults to Owner, Admin Kantor and Admin Finance. Existing records retain approved accounting treatment without fabricated approver identities.
- Driver dashboard redirects to the active or next planned assignment while preserving the existing bottom navigation.

## Implementation
Frontend: a getUserMedia video/canvas camera captures photos, requests uncached GPS, and supplies capture metadata. Activity and expense tabs concentrate driver actions. Expense receipts remain optional and may use files.
Backend: permission guards plus assigned-crew/warehouse scopes enforce transport access. Activity POST validates image encoding/format/size, finite GPS ranges, accuracy and capture freshness. Mutations recheck lifecycle/approval status to prevent races. Approval identity comes from the authenticated session, never the request.
Database: additive PostgreSQL migration adds tracking mode, TransportActivity, expense GPS/status/approval snapshots, and default role grants. Old expenses are APPROVED with no invented approver; new defaults are PENDING.

## Security and limitations
- Camera and GPS require HTTPS or localhost and user consent. Missing permissions block capture.
- Browser camera-only workflow prevents normal gallery uploads, not a malicious client forging an HTTP payload. Device GPS can be spoofed; there is no cryptographic location or camera attestation.
- Approval and submission are audited; API responses retain established scope boundaries.
- Pending expenses do not count toward approved expense totals.

## Rollout
Run `bunx prisma migrate deploy` against the intended database, then regenerate Prisma Client and rebuild. Database changes must precede serving the new application. Smoke-test physical mobile camera/GPS and role permissions on HTTPS.
