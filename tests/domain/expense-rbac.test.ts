import { describe, expect, it, vi } from "vitest";
vi.mock("@/infrastructure/persistence/db", () => ({ db: {} }));
vi.mock("@/infrastructure/persistence/tenant-context", () => ({
    tenantKey: () => "test",
}));
import { PERMISSIONS, ROLE_TEMPLATES } from "@/infrastructure/auth/rbac";

describe("expense approval default permissions", () => {
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
    it.each(["driver", "kenek", "admin-gudang", "marketing", "vehicle-owner"])(
        "does not grant %s approval by default",
        (slug) => {
            expect(
                ROLE_TEMPLATES.find((r) => r.slug === slug)?.permissions,
            ).not.toContain("transport.expense.approve");
        },
    );
});
