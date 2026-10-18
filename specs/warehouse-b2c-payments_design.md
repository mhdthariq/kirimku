# Admin Gudang B2C payments

## Scope and acceptance
- New B2C shipments created by an authenticated `admin-gudang` user (not a Marketing partner) have a server-owned `paymentTrackingEnabled` snapshot. Client input cannot enable/disable it. B2B always remains invoice-based.
- The shipment detail exposes a Pembayaran panel with cash/transfer recording, optional reference, history, and verified paid/outstanding totals. Admin Gudang may record only for tracked B2C shipments within existing warehouse scope; existing payment.record/verify permissions retain their roles. No new broad role grants.
- Recording creates RECORDED (pending), never automatically paid. Only VERIFIED counts as paid. Existing payment.verify holders verify/reject from the panel. UNPRICED / UNPAID / DP / PAID are displayed as Belum dihitung / Belum Lunas / Sebagian / Lunas.
- Master resi shows payment status, verified paid, and outstanding for tracked B2C only. B2B invoice rendering and Marketing B2C behavior stay unchanged. Print/preview wrappers and transport manifest are out of scope.

## Storage and compatibility
Add `MasterShipment.paymentTrackingEnabled Boolean @default(false)` via additive migration. This captures eligibility at creation, independent of later creator role changes. Existing rows remain false: there is no reliable immutable creator-role history to backfill; `createdByPartnerId = null` does NOT prove Admin Gudang creation. No inference from customer.marketingPartnerId, which identifies customer ownership rather than shipment creator. CREATED tracking events and audit continue to capture actor identity.

## Backend/security
Authenticate through tenant-aware guard; enforce shipment warehouse scope before reads/writes. Server determines tracking from customer type and authenticated creator role, excluding Marketing partner flow. Admin Gudang exception is constrained by this snapshot + B2C, not a global payment.record grant. B2B per-shipment recording/verification is rejected in favor of invoices. Validate positive finite amounts, exact CASH/TRANSFER methods, priced/non-cancelled shipments. Record and verify inside serializable transactions, re-read price/status and verified sum, reject overpayment and concurrent-write conflicts (409, retry). Verification/rejection use conditional RECORDED updates to prevent double decisions. Audit successful writes. Return only names for recorder/verifier, not full User records.

Payment totals in scan-flow, Gudang arrival/held balances, and the Gudang dashboard counted RECORDED as paid despite the existing business-rule invariant. Correct these to VERIFIED-only so UI/resi and operations agree. This does not restore removed pickup DP gates (`dpOk` remains true). Pending records do not reserve balance: each record must fit the verified outstanding amount at recording time, and verification rechecks that balance transactionally. Multiple pending records can therefore exist, but they cannot be verified into an overpayment.

## UI and validation
Reuse typed client, runAction, form controls and existing ledger. No new dependencies. Client constraints improve feedback but server remains authoritative; React escapes references and names. Test creator stamp, auth/scope, B2B exclusion, validation, pending/verified semantics, overpayment/concurrency, panel actions and actual resi payment rendering. Apply migration and regenerate Prisma before deployment.

## Validation results
- `bun run db:generate`: passed.
- `bunx tsc --noEmit`: passed.
- Focused ESLint on new payment domain/UI, record/verify/reject routes, and payment tests: passed.
- `bun run test --maxWorkers=2`: 71 files / 894 tests passed, including 52 new payment tests (34 API/summary and 18 component/resi).
- The initial unrestricted suite run had two unrelated timing failures (dashboard timeout and transport camera cleanup assertion); both passed in the bounded-worker rerun without changes to those tests.
- `bunx prisma validate` is blocked by the existing local DATABASE_URL using a non-PostgreSQL protocol. The schema requires PostgreSQL. No database migration or live-database concurrency test was performed; API tests mock persistence and exercise serializable options, conditional transitions, and conflict handling.
