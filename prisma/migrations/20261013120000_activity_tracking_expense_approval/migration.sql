ALTER TABLE "Transport" ADD COLUMN IF NOT EXISTS "trackingMode" TEXT NOT NULL DEFAULT 'CHECKPOINT';
ALTER TABLE "TransportExpense"
  ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "locationAccuracy" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "approvedByUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedByRole" TEXT;
-- Preserve existing financial totals without inventing a historical approver.
ALTER TABLE "TransportExpense" ALTER COLUMN "status" SET DEFAULT 'PENDING';
CREATE TABLE IF NOT EXISTS "TransportActivity" (
  "id" SERIAL NOT NULL,
  "transportId" INTEGER NOT NULL,
  "photoUrl" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "locationAccuracy" DOUBLE PRECISION,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById" INTEGER,
  "recordedByUsername" TEXT,
  CONSTRAINT "TransportActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransportActivity_transportId_fkey" FOREIGN KEY ("transportId") REFERENCES "Transport"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TransportActivity_transportId_capturedAt_idx" ON "TransportActivity"("transportId", "capturedAt");
INSERT INTO "Permission" ("slug", "module", "description") VALUES
 ('transport.expense.approve', 'Transports', 'Approve pending transport operational expenses')
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "Role" ("slug", "name", "description", "isSystem") VALUES
 ('admin-finance', 'Admin Finance', 'Review and approve transport operational expenses', true)
ON CONFLICT ("slug") DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
 SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
 WHERE r."slug" IN ('owner', 'admin-kantor', 'admin-finance')
 AND p."slug" IN ('transport.view', 'transport.expense.view', 'transport.expense.approve')
ON CONFLICT DO NOTHING;
