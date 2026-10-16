# Transport costs, responsive transport detail and Master Rekening

## Scope and acceptance
- Keep transport lifecycle, crew restrictions, photo permissions and per-expense approval unchanged while redesigning transport detail and expense layouts for 320px through desktop screens.
- Add ANGKUT / Biaya Angkut to the shared expense catalog; existing string-based expense records require no conversion.
- Show itemized shared transport expenses on shipment detail only to users with expense-view permission who can access the shipment and linked transport. Never allocate the full transport cost to a shipment's profit. Count expense IDs once in Finance.
- Finance includes approved operational costs by category, pending amounts separately, a recent expense list, and a responsive operational cost register. Rename sidebar Finance Partner to Finance.
- Master Rekening supports permission-gated create, edit and deactivate/reactivate. Store account numbers as strings. Invoice selection is optional and restricted to active accounts. Snapshot bank name, number and account name when selected; changing/deactivating a master cannot change existing invoices. Print only those three bank fields on A4 invoices.

## Storage and safety
Add BankAccount and nullable invoice account/snapshot columns using an additive migration, without rewriting existing invoices or deleting existing business records. Generate Prisma types locally; do not connect tests to business databases. Preserve company tenancy through the existing db proxy and request wrapper.

## Security
Use server-side guards and existing shipment/transport scope checks. Give Master Rekening permissions to Owner and Admin Kantor; invoice editors may read active choices. Validate bank fields, IDs, account numbers and booleans on the server and forms. Soft-delete bank masters, audit mutations, and omit photo payloads and GPS from shared cost summaries. Approved expenses alone count toward approved spend; pending amounts are labelled separately.

## Verification
Exercise category validation/approval, shared-cost access and deduplication, financial aggregates, bank permission/validation/deactivation, immutable invoice snapshots and printing. Preserve existing lifecycle/finance/invoice tests. Run TypeScript, focused lint and regression tests, plus real-browser viewport checks on detail, expenses, finance and bank-account views. Verify shipment labels remain 100x100mm and invoices/manifests remain A4.

## Rollout
The migration is prepared but has not been applied to a business database during development. Before running this application version against existing data:

1. Back up the target database and verify the intended connection and migration history.
2. Run `npx prisma migrate deploy` using the deployment's target database connection. Repeat for each company database that runs this version; the application routes companies to separate databases. Do not use the repository's `db:push` script (`--accept-data-loss`), reset, or demo seeding for this rollout.
3. Generate Prisma Client (`npx prisma generate`) during the build, deploy and restart the application. Existing invoices keep null bank fields until a bank is selected on an editable draft. Existing expenses need no conversion.
4. On the first authenticated request, the existing RBAC bootstrap registers the new permissions and grants the new defaults to Owner and Admin Kantor. Assign `bank_account.*` permissions explicitly for any custom roles that should manage accounts.
5. Create an active account in Master Rekening; select it on a draft invoice and verify the three payment fields in preview/print. Editing or deactivating the account must leave that saved invoice unchanged.

Validation completed: TypeScript and changed-file ESLint, 273 tests across 23 relevant suites, browser overflow checks at 320/375/768/1024/1280/1440/1920px with dark-mode screenshots, and generated-PDF verification. Invoices (including bank details) and manifests use A4; shipment labels use 100x100mm. Tests use mocked persistence and HTML/PDF fixtures, never the remote business database.
