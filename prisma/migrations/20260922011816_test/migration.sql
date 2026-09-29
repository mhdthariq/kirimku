-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "warehouseId" INTEGER;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "warehouseId" INTEGER;

-- AlterTable
ALTER TABLE "Pickup" ADD COLUMN     "photoUrl" TEXT;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
