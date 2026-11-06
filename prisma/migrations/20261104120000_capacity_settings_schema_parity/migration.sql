-- These fields already exist in schema.prisma and are used by the legacy API.
-- IF NOT EXISTS also supports databases previously synchronized with db push.
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "maxKoli" INTEGER;

CREATE TABLE IF NOT EXISTS "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,
    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
