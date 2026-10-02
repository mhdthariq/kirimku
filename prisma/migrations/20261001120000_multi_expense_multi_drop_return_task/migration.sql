-- Multi expense, multi drop, delivery approval and return task. Additive only.

-- Transport
ALTER TABLE "Transport" ADD COLUMN "transportMode" TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "Transport" ADD COLUMN "deliveryApprovedAt" TIMESTAMP(3);
ALTER TABLE "Transport" ADD COLUMN "deliveryApprovedById" INTEGER;

-- TransportShipment
ALTER TABLE "TransportShipment" ADD COLUMN "dropCheckpointId" INTEGER;
ALTER TABLE "TransportShipment" ADD COLUMN "dropStatus" TEXT NOT NULL DEFAULT 'LOADED';
ALTER TABLE "TransportShipment" ADD COLUMN "droppedAt" TIMESTAMP(3);
ALTER TABLE "TransportShipment" ADD COLUMN "droppedById" INTEGER;
ALTER TABLE "TransportShipment" ADD COLUMN "deliveryApprovedAt" TIMESTAMP(3);
ALTER TABLE "TransportShipment" ADD COLUMN "deliveryApprovedById" INTEGER;
CREATE INDEX "TransportShipment_transportId_dropStatus_idx" ON "TransportShipment"("transportId", "dropStatus");

-- TransportExpense
CREATE TABLE "TransportExpense" (
    "id" SERIAL NOT NULL,
    "expenseCode" TEXT NOT NULL,
    "transportId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "photoUrl" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransportExpense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TransportExpense_expenseCode_key" ON "TransportExpense"("expenseCode");
CREATE INDEX "TransportExpense_transportId_idx" ON "TransportExpense"("transportId");
CREATE INDEX "TransportExpense_transportId_type_idx" ON "TransportExpense"("transportId", "type");
ALTER TABLE "TransportExpense" ADD CONSTRAINT "TransportExpense_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReturnTask
CREATE TABLE "ReturnTask" (
    "id" SERIAL NOT NULL,
    "returnTaskCode" TEXT NOT NULL,
    "originalTransportId" INTEGER NOT NULL,
    "returnTransportId" INTEGER,
    "vehicleId" INTEGER NOT NULL,
    "driverId" INTEGER,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdById" INTEGER,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReturnTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReturnTask_returnTaskCode_key" ON "ReturnTask"("returnTaskCode");
CREATE INDEX "ReturnTask_originalTransportId_idx" ON "ReturnTask"("originalTransportId");
CREATE INDEX "ReturnTask_status_idx" ON "ReturnTask"("status");
ALTER TABLE "ReturnTask" ADD CONSTRAINT "ReturnTask_originalTransportId_fkey" FOREIGN KEY ("originalTransportId") REFERENCES "Transport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReturnTask" ADD CONSTRAINT "ReturnTask_returnTransportId_fkey" FOREIGN KEY ("returnTransportId") REFERENCES "Transport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
