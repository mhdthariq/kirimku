ALTER TABLE "Transport"
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "completedByUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "completedByRole" TEXT;

INSERT INTO "Permission" ("slug", "module", "description")
VALUES ('transport.complete', 'Transports', 'Audit and complete an arrived transport')
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."slug" = 'owner' AND p."slug" = 'transport.complete'
ON CONFLICT DO NOTHING;
