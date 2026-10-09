-- Allow permissions to be granted directly to one user without changing their roles.
CREATE TABLE "UserPermission" (
    "userId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("userId", "permissionId"),
    CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UserPermission_permissionId_idx" ON "UserPermission"("permissionId");
