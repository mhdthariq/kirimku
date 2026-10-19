ALTER TABLE "MasterShipment" ADD COLUMN "arrivalPreviousStatus" TEXT;
ALTER TABLE "TransportExpense" ALTER COLUMN "transportId" DROP NOT NULL;
ALTER TABLE "TransportExpense" ADD COLUMN "shipmentId" INTEGER,
  ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancelledById" INTEGER,
  ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "MasterShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_one_parent_check"
  CHECK (("transportId" IS NOT NULL) <> ("shipmentId" IS NOT NULL));
CREATE INDEX "TransportExpense_shipmentId_idx" ON "TransportExpense"("shipmentId");
