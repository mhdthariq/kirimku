import { NextRequest } from "next/server";
import { guard, handle, ok, fail } from "@/composition/api-helpers";
import { db } from "@/infrastructure/persistence/db";
import { audit } from "@/infrastructure/services/audit";
import { parseBankAccount } from "@/domain/bank-account";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "bank_account.update");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return fail(422, "Rekening tidak valid.");
    const before = await db.bankAccount.findUnique({ where: { id } });
    if (!before) return fail(404, "Rekening tidak ditemukan.");
    const input = parseBankAccount(await req.json().catch(() => null));
    if (typeof input === "string") return fail(422, input);
    const account = await db.bankAccount.update({ where: { id }, data: input });
    await audit({ action: "updated", entityType: "bank_account", entityId: id, entityLabel: account.bankName, actor: user, before, after: input });
    return ok(account);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "bank_account.delete");
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return fail(422, "Rekening tidak valid.");
    const before = await db.bankAccount.findUnique({ where: { id } });
    if (!before) return fail(404, "Rekening tidak ditemukan.");
    const account = await db.bankAccount.update({ where: { id }, data: { isActive: false } });
    await audit({ action: "deactivated", entityType: "bank_account", entityId: id, entityLabel: account.bankName, actor: user, before, after: { isActive: false } });
    return ok(account);
  });
}
