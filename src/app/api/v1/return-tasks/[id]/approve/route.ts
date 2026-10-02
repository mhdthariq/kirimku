import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canApproveReturnTask } from "@/lib/transport-ops";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "return-task.approve");
    const { id } = await params;
    const task = await db.returnTask.findUnique({ where: { id: Number(id) } });
    if (!task) return fail(404, "Resi tugas balik tidak ditemukan.");
    const problem = canApproveReturnTask(task.status);
    if (problem) return fail(422, problem);
    const updated = await db.returnTask.update({ where: { id: task.id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() } });
    await audit({ action: "approve", entityType: "return_task", entityId: task.id, entityLabel: `${task.returnTaskCode} → APPROVED`, actor: user });
    return ok(updated);
  });
}
