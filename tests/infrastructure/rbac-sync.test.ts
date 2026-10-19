import { beforeEach, describe, expect, it, vi } from "vitest";

type Permission = { id: number; slug: string; module: string; description: string };
type Role = { id: number; slug: string; name: string; description: string; isSystem: boolean };
type Grant = { roleId: number; permissionId: number };
const state = vi.hoisted(() => ({
  permissions: [] as Permission[], roles: [] as Role[], grants: [] as Grant[],
  tenant: "rbac-sync", nextPermissionId: 1000,
  permissionUpsert: vi.fn(), roleUpsert: vi.fn(), deleteGrants: vi.fn(), createGrants: vi.fn(),
}));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({ tenantKey: () => state.tenant }));
vi.mock("@/infrastructure/persistence/db", () => ({ db: {
  permission: {
    findMany: async () => state.permissions.map((permission) => ({ ...permission })),
    upsert: state.permissionUpsert,
    deleteMany: async ({ where }: { where: { slug: { notIn: string[] } } }) => {
      state.permissions = state.permissions.filter((permission) => where.slug.notIn.includes(permission.slug));
    },
  },
  role: {
    findMany: async () => state.roles.map((role) => ({ ...role })),
    upsert: state.roleUpsert,
  },
  rolePermission: { deleteMany: state.deleteGrants, createMany: state.createGrants },
} }));

let rbac: typeof import("@/infrastructure/auth/rbac");
function role(slug: string) {
  return state.roles.find((candidate) => candidate.slug === slug)!;
}
function grant(slug: string, permission: string) {
  state.grants.push({ roleId: role(slug).id, permissionId: state.permissions.find((p) => p.slug === permission)!.id });
}
function revoke(slug: string, permission: string) {
  const permissionId = state.permissions.find((p) => p.slug === permission)!.id;
  state.grants = state.grants.filter((entry) => entry.roleId !== role(slug).id || entry.permissionId !== permissionId);
}
function permissionsFor(slug: string) {
  return state.grants.filter((entry) => entry.roleId === role(slug).id)
    .map((entry) => state.permissions.find((p) => p.id === entry.permissionId)!.slug).sort();
}
async function restart() {
  vi.resetModules();
  rbac = await import("@/infrastructure/auth/rbac");
  await rbac.ensureRbac();
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  state.tenant = "rbac-sync";
  state.nextPermissionId = 1000;
  rbac = await import("@/infrastructure/auth/rbac");
  state.permissions = rbac.PERMISSIONS.map((permission, index) => ({ ...permission, id: index + 1 }));
  state.roles = rbac.ROLE_TEMPLATES.map((template, index) => ({
    id: index + 1, slug: template.slug, name: template.name, description: template.description, isSystem: true,
  }));
  state.grants = [];
  for (const template of rbac.ROLE_TEMPLATES) {
    for (const permission of template.permissions) grant(template.slug, permission);
  }
  state.permissionUpsert.mockImplementation(async ({ where, create, update }) => {
    const existing = state.permissions.find((permission) => permission.slug === where.slug);
    if (existing) { Object.assign(existing, update); return existing; }
    const permission = { ...create, id: state.nextPermissionId++ };
    state.permissions.push(permission);
    return permission;
  });
  state.roleUpsert.mockImplementation(async ({ where, create, update }) => {
    const existing = state.roles.find((candidate) => candidate.slug === where.slug);
    if (existing) { Object.assign(existing, update); return existing; }
    const created = { ...create, id: Math.max(0, ...state.roles.map((candidate) => candidate.id)) + 1 };
    state.roles.push(created);
    return created;
  });
  state.deleteGrants.mockImplementation(async ({ where }) => {
    if (where.roleId !== undefined) {
      state.grants = state.grants.filter((entry) => entry.roleId !== where.roleId);
    } else {
      const keep = where.permission.slug.notIn as string[];
      state.grants = state.grants.filter((entry) => keep.includes(state.permissions.find((p) => p.id === entry.permissionId)!.slug));
    }
  });
  state.createGrants.mockImplementation(async ({ data, skipDuplicates }: { data: Grant[]; skipDuplicates?: boolean }) => {
    for (const entry of data) {
      const exists = state.grants.some((grant) => grant.roleId === entry.roleId && grant.permissionId === entry.permissionId);
      if (exists && !skipDuplicates) throw new Error("duplicate role permission");
      if (!exists) state.grants.push({ ...entry });
    }
  });
});

describe("RBAC catalog sync", () => {
  it("preserves Owner-custom expense create grants and revocations across restarts", async () => {
    grant("admin-finance", "transport.expense.create");
    revoke("admin-kantor", "transport.expense.create");
    revoke("admin-kantor", "transport.expense.approve");
    revoke("owner", "customer.delete");
    const before = structuredClone(state.grants);
    await rbac.ensureRbac();
    await restart();
    expect(state.grants).toEqual(before);
    expect(state.deleteGrants).not.toHaveBeenCalled();
    expect(state.createGrants).not.toHaveBeenCalled();
  });

  it("seeds missing roles even when custom roles keep the total role count unchanged", async () => {
    const missingId = role("admin-kantor").id;
    state.roles = state.roles.filter((candidate) => candidate.id !== missingId);
    state.grants = state.grants.filter((entry) => entry.roleId !== missingId);
    state.roles.push({ id: 500, slug: "custom", name: "Custom", description: "Owner-defined", isSystem: false });
    grant("custom", "transport.expense.create");
    revoke("driver", "transport.expense.update");
    const before = structuredClone(state.grants);
    await rbac.ensureRbac();
    expect(permissionsFor("admin-kantor")).toEqual(rbac.ROLE_TEMPLATES.find((template) => template.slug === "admin-kantor")!.permissions.slice().sort());
    expect(state.grants.filter((entry) => entry.roleId !== role("admin-kantor").id)).toEqual(before);
    expect(state.deleteGrants).not.toHaveBeenCalled();
  });

  it.each([false, true])("adds only new catalog defaults, including equal-count replacement: %s", async (replaceObsolete) => {
    grant("admin-finance", "transport.expense.create");
    revoke("admin-kantor", "transport.expense.create");
    revoke("owner", "customer.delete");
    const introduced = state.permissions.find((permission) => permission.slug === "transport.expense.approve")!;
    state.permissions = state.permissions.filter((permission) => permission.id !== introduced.id);
    state.grants = state.grants.filter((entry) => entry.permissionId !== introduced.id);
    if (replaceObsolete) {
      state.permissions.push({ id: 999, slug: "obsolete.permission", module: "Old", description: "Removed" });
      grant("driver", "obsolete.permission");
    }
    const before = state.grants.filter((entry) => entry.permissionId !== 999);
    await rbac.ensureRbac();
    const newPermissionId = state.permissions.find((permission) => permission.slug === introduced.slug)!.id;
    expect(state.grants.filter((entry) => entry.permissionId !== newPermissionId)).toEqual(before);
    expect(state.grants.filter((entry) => entry.permissionId === newPermissionId).map((entry) => entry.roleId).sort()).toEqual(
      ["owner", "admin-kantor", "admin-finance"].map((slug) => role(slug).id).sort(),
    );
    expect(state.deleteGrants.mock.calls.every(([args]) => args.where.roleId === undefined)).toBe(true);
    expect(state.permissions.some((permission) => permission.slug === "obsolete.permission")).toBe(false);
    revoke("admin-kantor", introduced.slug);
    const afterRevocation = structuredClone(state.grants);
    await restart();
    expect(state.grants).toEqual(afterRevocation);
  });

  it("introduces approved expense deletion only for Owner and preserves explicit grants and revocations", async () => {
        const slug = "transport.expense.delete-approved";
        const introduced = state.permissions.find(
            (permission) => permission.slug === slug,
        )!;
        state.permissions = state.permissions.filter(
            (permission) => permission.id !== introduced.id,
        );
        state.grants = state.grants.filter(
            (entry) => entry.permissionId !== introduced.id,
        );
        grant("admin-finance", "transport.expense.delete");
        revoke("admin-kantor", "transport.expense.approve");
        const before = structuredClone(state.grants);

        await rbac.ensureRbac();

        const permissionId = state.permissions.find(
            (permission) => permission.slug === slug,
        )!.id;
        expect(
            state.grants.filter((entry) => entry.permissionId === permissionId),
        ).toEqual([{ roleId: role("owner").id, permissionId }]);
        expect(
            state.grants.filter((entry) => entry.permissionId !== permissionId),
        ).toEqual(before);

        grant("driver", slug);
        revoke("owner", slug);
        const customized = structuredClone(state.grants);
        await restart();
        expect(state.grants).toEqual(customized);
        expect(permissionsFor("driver")).toContain(slug);
        expect(permissionsFor("driver")).not.toContain(
            "transport.expense.delete",
        );
        expect(permissionsFor("driver")).not.toContain(
            "transport.expense.approve",
        );
    });

    it("bootstraps an empty database and remains idempotent", async () => {
    state.permissions = [];
    state.roles = [];
    state.grants = [];
    await rbac.ensureRbac();
    expect(state.permissions).toHaveLength(rbac.PERMISSIONS.length);
    for (const template of rbac.ROLE_TEMPLATES) {
      expect(permissionsFor(template.slug)).toEqual(template.permissions.slice().sort());
    }
    const before = structuredClone(state.grants);
    await restart();
    expect(state.grants).toEqual(before);
  });

  it("bootstraps each tenant separately", async () => {
    await rbac.ensureRbac();
    state.tenant = "another-tenant";
    state.permissions = [];
    state.roles = [];
    state.grants = [];
    await rbac.ensureRbac();
    expect(state.roles).toHaveLength(rbac.ROLE_TEMPLATES.length);
    expect(permissionsFor("admin-kantor")).toContain("transport.expense.create");
  });
});
