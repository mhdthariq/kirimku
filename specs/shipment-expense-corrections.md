# Shipment expenses and arrival corrections

Keep B2C customer pricing/payment status separate from operational expenses. Do not show shared transport costs in B2C. B2B shipments not created by Marketing may have their own expenses entered by Admin Gudang after confirmed warehouse receipt. Store these in the expense ledger with exactly one parent (shipment or transport), so finance counts each cost once.

Expense approval remains per entry. Show active submitted costs, approved costs, and approved percentage; cancelled expenses contribute to neither amount. Approvers can cancel approved entries, retaining the entry and approval history, or remove them with a required reason preserved in the audit log. Use conditional updates to reject concurrent status changes.

Add shipment.undo_arrival, granted only to Owner by default. Undo confirmed destination receipt with no downstream delivery to AT_DEST_GUDANG. Origin receipt can return to its saved previous status when it has no downstream transport. Clear receipt timestamps and corresponding arrival scans, restore completed pickup to PICKED_UP if needed, and record actor/reason. Active shipment expenses must be cancelled or removed first. Authenticate and scope all endpoints, validate payloads server-side, and audit mutations. UI uses wrapping controls, bounded dialogs and mobile-first grids.
