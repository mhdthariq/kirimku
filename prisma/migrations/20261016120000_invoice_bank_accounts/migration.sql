-- Additive only: old invoices retain null account fields and remain readable.
CREATE TABLE "BankAccount" (
    "id" SERIAL NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Invoice"
    ADD COLUMN "bankAccountId" INTEGER,
    ADD COLUMN "paymentBankName" TEXT,
    ADD COLUMN "paymentAccountNumber" TEXT,
    ADD COLUMN "paymentAccountName" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
