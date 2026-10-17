-- NULL ownership represents a company repair, without partner wallet accounting.
-- Existing ownership, foreign keys (including ON DELETE RESTRICT), and history are retained.
ALTER TABLE "VehicleRepair" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "RepairActionLog" ALTER COLUMN "ownerId" DROP NOT NULL;
