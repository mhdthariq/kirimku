ALTER TABLE "Transport"
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completedById" INTEGER,
  ADD COLUMN "completedByUsername" TEXT,
  ADD COLUMN "completedByRole" TEXT;

INSERT INTO "Permission" ("slug", "module", "description")
VALUES ('transport.complete', 'Transports', 'Audit and complete an arrived transport')
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."slug" = 'owner' AND p."slug" = 'transport.complete'
ON CONFLICT DO NOTHING;
