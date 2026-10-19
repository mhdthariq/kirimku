ALTER TABLE "Payment" ADD COLUMN "proofUrl" TEXT;
-- Delete permission defaults to Owner. Explicit grants on other roles are preserved.
DELETE FROM "RolePermission" rp USING "Role" r, "Permission" p
WHERE rp."roleId" = r.id AND rp."permissionId" = p.id
  AND r.slug = 'admin-gudang' AND p.slug = 'transport.expense.delete';
