-- CreateTable
CREATE TABLE "ShipmentDocument" (
    "id" SERIAL NOT NULL,
    "masterId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentDocument_masterId_createdAt_idx" ON "ShipmentDocument"("masterId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShipmentDocument" ADD CONSTRAINT "ShipmentDocument_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "MasterShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;