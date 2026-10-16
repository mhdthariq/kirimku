-- One-time restoration of Admin Kantor expense creation; leave all other grants intact.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."slug" = 'admin-kantor' AND p."slug" = 'transport.expense.create'
ON CONFLICT DO NOTHING;
