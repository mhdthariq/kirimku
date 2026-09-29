-- Tariff name (multiple tariffs per corridor) + B2B tariff tied to a customer.
-- Additive and safe on existing data: both columns are nullable.
ALTER TABLE "Tariff" ADD COLUMN     "name" TEXT;
ALTER TABLE "Tariff" ADD COLUMN     "customerId" INTEGER;

CREATE INDEX "Tariff_customerId_idx" ON "Tariff"("customerId");

ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
