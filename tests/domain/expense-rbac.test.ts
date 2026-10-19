import { describe, expect, it, vi } from "vitest";
vi.mock("@/infrastructure/persistence/db", () => ({ db: {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
    tenantKey: () => "test",
}));
import { PERMISSIONS, ROLE_TEMPLATES } from "@/infrastructure/auth/rbac";

describe("expense approval default permissions", () => {
    it.each(["transport.expense.delete", "transport.expense.delete-approved"])(
        "defaults %s to Owner and keeps it independently assignable",
        (slug) => {
            expect(
                ROLE_TEMPLATES.filter((role) =>
                    role.permissions.includes(slug),
                ).map((role) => role.slug),
            ).toEqual(["owner"]);
            const permissions = PERMISSIONS.filter(
                (permission) => permission.slug === slug,
            );
            expect(permissions).toHaveLength(1);
            expect(permissions[0].description).toContain("assignable");
        },
    );
    it("describes separate pending and approved/cancelled deletion permissions", () => {
        expect(
            PERMISSIONS.find(
                (permission) => permission.slug === "transport.expense.delete",
            )?.description,
        ).toContain("pending");
        expect(
            PERMISSIONS.find(
                (permission) =>
                    permission.slug === "transport.expense.delete-approved",
            )?.description,
        ).toContain("approved or cancelled");
    });
    it("registers the approval permission", () => {
        expect(
            PERMISSIONS.filter((p) => p.slug === "transport.expense.approve"),
        ).toHaveLength(1);
    });
    it.each(["owner", "admin-kantor", "admin-finance"])(
        "grants %s expense view and approval",
        (slug) => {
            const role = ROLE_TEMPLATES.find((r) => r.slug === slug);
            expect(role?.permissions).toContain("transport.view");
            expect(role?.permissions).toContain("transport.expense.view");
            expect(role?.permissions).toContain("transport.expense.approve");
        },
    );
    it("grants Admin Kantor expense creation by default", () => {
        expect(
            ROLE_TEMPLATES.find((role) => role.slug === "admin-kantor")
                ?.permissions,
        ).toContain("transport.expense.create");
    });
    it("keeps Admin Finance approval-only", () => {
        expect(
            ROLE_TEMPLATES.find((role) => role.slug === "admin-finance")
                ?.permissions,
        ).not.toContain("transport.expense.create");
    });
    it.each(["driver", "kenek", "admin-gudang", "marketing", "vehicle-owner"])(
        "does not grant %s approval by default",
        (slug) => {
            expect(
                ROLE_TEMPLATES.find((r) => r.slug === slug)?.permissions,
            ).not.toContain("transport.expense.approve");
        },
    );
});
