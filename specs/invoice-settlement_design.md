# Invoice settlement correction

PPh is informational and included in the entered transfer/cash amount. A payment of 500,000 with PPh 5,000 credits 500,000 to the invoice. Existing invoice rounding remains part of the invoice total. No schema migration or historical payment rewrite is needed.

Show cumulative PPh on invoice lists, detail, and print. Reuse the settlement form for history edits and confirm history deletion. Preserve proof unless explicitly replaced/removed. Add separate invoice.settlement.update/delete permissions to Owner and Admin Kantor.

Validate positive amounts, nonnegative PPh no greater than payment, date, method, and receipt on the server and client. Scope settlement IDs to their invoice and retain audit records. Run payment mutation, balance calculation, invoice status, and commission changes atomically at serializable isolation. Reopening an invoice reverses a released commission using an append-only adjustment; reject if funds are spent/reserved. Re-settlement releases commission once again without rewriting old wallet transactions.

Verify full/partial payments with PPh, overpayment, edit/delete status recalculation, permissions, receipt preservation, commission reversal/re-release and rollback on unavailable wallet funds. Tests use mocks; do not connect to or reset business databases.
