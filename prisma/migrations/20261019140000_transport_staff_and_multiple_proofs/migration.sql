ALTER TABLE "Transport" ADD COLUMN "warehouseStaffId" INTEGER;
ALTER TABLE "Transport" ADD CONSTRAINT "Transport_warehouseStaffId_fkey" FOREIGN KEY ("warehouseStaffId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TransportExpense" ADD COLUMN "photoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
