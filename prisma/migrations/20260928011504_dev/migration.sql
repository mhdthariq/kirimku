-- CreateTable
CREATE TABLE "Employee" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "employeeNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "warehouseId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "employeeId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    PRIMARY KEY ("userId", "roleId"),
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    PRIMARY KEY ("roleId", "permissionId"),
    CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionToken" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodeSequence" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "nextValue" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "companyPercent" REAL NOT NULL DEFAULT 80,
    "partnerPercent" REAL NOT NULL DEFAULT 20,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "warehouseId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Partner_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Partner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partnerId" INTEGER NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Wallet_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "walletId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "balanceBefore" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "referenceType" TEXT,
    "referenceId" INTEGER,
    "businessRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "description" TEXT,
    "createdById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopUpRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestCode" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "partnerNote" TEXT,
    "partnerProofUrl" TEXT,
    "proofUrl" TEXT,
    "rejectReason" TEXT,
    "requestedById" INTEGER NOT NULL,
    "submittedForVerificationAt" DATETIME,
    "verifiedById" INTEGER,
    "verifiedAt" DATETIME,
    "walletTransactionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopUpRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopUpRequest_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "requestCode" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "partnerNote" TEXT,
    "transferProofUrl" TEXT,
    "rejectReason" TEXT,
    "requestedById" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" DATETIME,
    "processedById" INTEGER,
    "processedAt" DATETIME,
    "completedAt" DATETIME,
    "walletTransactionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WithdrawalRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WithdrawalRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WithdrawalRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'b2c',
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "marketingPartnerId" INTEGER,
    "warehouseId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_marketingPartnerId_fkey" FOREIGN KEY ("marketingPartnerId") REFERENCES "Partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MasterShipment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "masterCode" TEXT NOT NULL,
    "resi" TEXT,
    "customerId" INTEGER NOT NULL,
    "tariffId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "fulfillmentMode" TEXT NOT NULL DEFAULT 'STANDARD',
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "originWarehouseId" INTEGER,
    "destinationWarehouseId" INTEGER,
    "arrivedWarehouseId" INTEGER,
    "destReceivedAt" DATETIME,
    "penerimaName" TEXT,
    "penerimaAddress" TEXT,
    "penerimaContact" TEXT,
    "pengirimName" TEXT,
    "pengirimPhone" TEXT,
    "pengirimEmail" TEXT,
    "pengirimAddress" TEXT,
    "chargeableWeightKg" REAL,
    "ratePerKg" REAL,
    "pricingMethod" TEXT,
    "chargeableKoli" REAL,
    "chargeableVolumeM3" REAL,
    "priceAmount" REAL,
    "pricedAt" DATETIME,
    "insuranceAmount" REAL NOT NULL DEFAULT 0,
    "discountAmount" REAL NOT NULL DEFAULT 0,
    "discountPercentage" REAL,
    "finalPriceAmount" REAL,
    "discountFundedBy" TEXT NOT NULL DEFAULT 'COMPANY',
    "createdByPartnerId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MasterShipment_createdByPartnerId_fkey" FOREIGN KEY ("createdByPartnerId") REFERENCES "Partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MasterShipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MasterShipment_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DetailShipment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "detailCode" TEXT NOT NULL,
    "masterId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "lengthCm" REAL,
    "widthCm" REAL,
    "heightCm" REAL,
    "volumeM3" REAL,
    "actualWeightKg" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DetailShipment_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "MasterShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "masterId" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "description" TEXT,
    "actorId" INTEGER,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackingEvent_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "MasterShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "customerSupportContact" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vehicleNumber" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "maxWeightKg" REAL NOT NULL,
    "maxVolumeM3" REAL NOT NULL,
    "lengthM" REAL,
    "widthM" REAL,
    "heightM" REAL,
    "notes" TEXT,
    "ownerId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vehicleId" INTEGER NOT NULL,
    "driverId" INTEGER,
    "kenekId" INTEGER,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" DATETIME,
    CONSTRAINT "VehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VehicleAssignment_kenekId_fkey" FOREIGN KEY ("kenekId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Route" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "routeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkpoint_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transportCode" TEXT NOT NULL,
    "routeId" INTEGER,
    "vehicleId" INTEGER NOT NULL,
    "driverId" INTEGER,
    "kenekId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "origin" TEXT,
    "destination" TEXT,
    "plannedDepartureAt" DATETIME,
    "plannedArrivalAt" DATETIME,
    "currentLatitude" REAL,
    "currentLongitude" REAL,
    "lastLocationAt" DATETIME,
    "departedAt" DATETIME,
    "arrivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transport_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transport_kenekId_fkey" FOREIGN KEY ("kenekId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transport_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transport_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransportShipment" (
    "transportId" INTEGER NOT NULL,
    "shipmentId" INTEGER NOT NULL,

    PRIMARY KEY ("transportId", "shipmentId"),
    CONSTRAINT "TransportShipment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "MasterShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransportShipment_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckpointRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transportId" INTEGER NOT NULL,
    "checkpointId" INTEGER NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "withinRadius" BOOLEAN NOT NULL,
    "photoUrl" TEXT,
    "distanceMeters" REAL,
    "recordedById" INTEGER,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckpointRecord_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "Checkpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CheckpointRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CheckpointRecord_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pickup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pickupCode" TEXT NOT NULL,
    "masterId" INTEGER NOT NULL,
    "kurirId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "notes" TEXT,
    "photoUrl" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pickup_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "MasterShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HandoverScan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pickupId" INTEGER,
    "deliveryId" INTEGER,
    "context" TEXT NOT NULL DEFAULT 'pickup',
    "masterId" INTEGER,
    "scanLevel" TEXT NOT NULL,
    "detailId" INTEGER,
    "payload" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'TYPED',
    "scannedById" INTEGER,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HandoverScan_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HandoverScan_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Pickup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HandoverScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "masterId" INTEGER NOT NULL,
    "pickupId" INTEGER,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolvedById" INTEGER,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deliveryCode" TEXT NOT NULL,
    "masterId" INTEGER NOT NULL,
    "kurirId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "proofOfDelivery" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Delivery_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "MasterShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "customerType" TEXT,
    "ratePerKg" REAL NOT NULL,
    "minChargeableKg" REAL NOT NULL DEFAULT 1,
    "volumetricMultiplier" REAL NOT NULL DEFAULT 250,
    "roundingMode" TEXT NOT NULL DEFAULT 'UP',
    "roundingUnitKg" REAL NOT NULL DEFAULT 0.5,
    "pricingMethod" TEXT NOT NULL DEFAULT 'PER_KG',
    "ratePerKoli" REAL,
    "ratePerCubic" REAL,
    "minChargeableKoli" REAL NOT NULL DEFAULT 1,
    "minChargeableM3" REAL NOT NULL DEFAULT 0,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "masterId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "reference" TEXT,
    "recordedById" INTEGER,
    "verifiedById" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    CONSTRAINT "Payment_masterId_fkey" FOREIGN KEY ("masterId") REFERENCES "MasterShipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATETIME,
    "dueDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL,
    "shipmentId" INTEGER,
    CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvoiceLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "MasterShipment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceSettlement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "proofUrl" TEXT,
    "recordedById" INTEGER,
    "settledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceSettlement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER,
    "entityLabel" TEXT,
    "actorId" INTEGER,
    "beforeData" TEXT,
    "afterData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransportSettlement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "settlementCode" TEXT NOT NULL,
    "transportId" INTEGER NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "transportValue" REAL NOT NULL,
    "companyPercent" REAL NOT NULL,
    "ownerPercent" REAL NOT NULL,
    "companyAmount" REAL NOT NULL,
    "ownerAmount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FINALIZED',
    "finalizedById" INTEGER,
    "finalizedAt" DATETIME,
    "walletTransactionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransportSettlement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Partner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportSettlement_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportSettlement_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleRepair" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "repairCode" TEXT NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "repairDate" DATETIME NOT NULL,
    "workshopVendor" TEXT,
    "proofUrl" TEXT,
    "relatedTransportId" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'VERIFIED',
    "deductedAmount" REAL NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "walletTransactionId" INTEGER,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VehicleRepair_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Partner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VehicleRepair_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepairActionLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "repairId" INTEGER NOT NULL,
    "repairCode" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "changes" TEXT,
    "amount" REAL,
    "actorId" INTEGER,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairActionLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketingCommission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commissionCode" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "invoiceAmount" REAL NOT NULL,
    "companyPercent" REAL NOT NULL,
    "partnerPercent" REAL NOT NULL,
    "commissionAmount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "walletTransactionId" INTEGER,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketingCommission_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MarketingCommission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeNumber_key" ON "Employee"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_slug_key" ON "Role"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_slug_key" ON "Permission"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SessionToken_token_key" ON "SessionToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_userId_key" ON "Partner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_partnerId_key" ON "Wallet"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_businessRef_key" ON "WalletTransaction"("businessRef");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpRequest_requestCode_key" ON "TopUpRequest"("requestCode");

-- CreateIndex
CREATE INDEX "TopUpRequest_partnerId_status_idx" ON "TopUpRequest"("partnerId", "status");

-- CreateIndex
CREATE INDEX "TopUpRequest_status_idx" ON "TopUpRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_requestCode_key" ON "WithdrawalRequest"("requestCode");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_partnerId_status_idx" ON "WithdrawalRequest"("partnerId", "status");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_status_idx" ON "WithdrawalRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MasterShipment_masterCode_key" ON "MasterShipment"("masterCode");

-- CreateIndex
CREATE UNIQUE INDEX "MasterShipment_resi_key" ON "MasterShipment"("resi");

-- CreateIndex
CREATE UNIQUE INDEX "DetailShipment_detailCode_key" ON "DetailShipment"("detailCode");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vehicleNumber_key" ON "Vehicle"("vehicleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleAssignment_vehicleId_driverId_kenekId_validFrom_key" ON "VehicleAssignment"("vehicleId", "driverId", "kenekId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Checkpoint_routeId_sequence_key" ON "Checkpoint"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Transport_transportCode_key" ON "Transport"("transportCode");

-- CreateIndex
CREATE INDEX "Transport_driverId_status_idx" ON "Transport"("driverId", "status");

-- CreateIndex
CREATE INDEX "Transport_kenekId_status_idx" ON "Transport"("kenekId", "status");

-- CreateIndex
CREATE INDEX "Transport_status_idx" ON "Transport"("status");

-- CreateIndex
CREATE INDEX "TransportShipment_transportId_idx" ON "TransportShipment"("transportId");

-- CreateIndex
CREATE INDEX "TransportShipment_shipmentId_idx" ON "TransportShipment"("shipmentId");

-- CreateIndex
CREATE INDEX "CheckpointRecord_transportId_recordedAt_idx" ON "CheckpointRecord"("transportId", "recordedAt");

-- CreateIndex
CREATE INDEX "CheckpointRecord_checkpointId_idx" ON "CheckpointRecord"("checkpointId");

-- CreateIndex
CREATE UNIQUE INDEX "Pickup_pickupCode_key" ON "Pickup"("pickupCode");

-- CreateIndex
CREATE INDEX "Pickup_kurirId_status_idx" ON "Pickup"("kurirId", "status");

-- CreateIndex
CREATE INDEX "Pickup_masterId_status_idx" ON "Pickup"("masterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_deliveryCode_key" ON "Delivery"("deliveryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TransportSettlement_settlementCode_key" ON "TransportSettlement"("settlementCode");

-- CreateIndex
CREATE UNIQUE INDEX "TransportSettlement_transportId_key" ON "TransportSettlement"("transportId");

-- CreateIndex
CREATE INDEX "TransportSettlement_ownerId_createdAt_idx" ON "TransportSettlement"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRepair_repairCode_key" ON "VehicleRepair"("repairCode");

-- CreateIndex
CREATE INDEX "VehicleRepair_ownerId_status_idx" ON "VehicleRepair"("ownerId", "status");

-- CreateIndex
CREATE INDEX "VehicleRepair_vehicleId_idx" ON "VehicleRepair"("vehicleId");

-- CreateIndex
CREATE INDEX "RepairActionLog_repairId_idx" ON "RepairActionLog"("repairId");

-- CreateIndex
CREATE INDEX "RepairActionLog_ownerId_createdAt_idx" ON "RepairActionLog"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCommission_commissionCode_key" ON "MarketingCommission"("commissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCommission_invoiceId_key" ON "MarketingCommission"("invoiceId");

-- CreateIndex
CREATE INDEX "MarketingCommission_partnerId_status_idx" ON "MarketingCommission"("partnerId", "status");
