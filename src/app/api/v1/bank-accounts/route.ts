import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { hasPermission } from "@/infrastructure/auth/auth";
import { db } from "@/infrastructure/persistence/db";
import { audit } from "@/infrastructure/services/audit";
import { parseBankAccount } from "@/domain/bank-account";

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const canView = hasPermission(user, "bank_account.view");
    if (!canView && !hasPermission(user, "invoice.create") && !hasPermission(user, "invoice.update")) return fail(403, "Anda tidak memiliki izin melihat rekening.");
    return ok(await db.bankAccount.findMany({ where: !canView || req.nextUrl.searchParams.get("active") === "true" ? { isActive: true } : {}, orderBy: [{ isActive: "desc" }, { bankName: "asc" }, { id: "asc" }] }));
  });
}

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req, "bank_account.create");
    const input = parseBankAccount(await req.json().catch(() => null));
    if (typeof input === "string") return fail(422, input);
    const account = await db.bankAccount.create({ data: input });
    await audit({ action: "created", entityType: "bank_account", entityId: account.id, entityLabel: account.bankName, actor: user, after: input });
    return ok(account);
  });
}
