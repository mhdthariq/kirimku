import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail } from "@/composition/api-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    await guard(req, "return-task.view");
    const { id } = await params;
    const task = await db.returnTask.findUnique({
      where: { id: Number(id) },
      include: {
        originalTransport: { include: { vehicle: true, driver: true, route: { include: { checkpoints: { orderBy: { sequence: "asc" } } } } } },
        returnTransport: { select: { id: true, transportCode: true, status: true } },
      },
    });
    if (!task) return fail(404, "Resi tugas balik tidak ditemukan.");
    const outbound = task.originalTransport.route?.checkpoints ?? [];
    return ok({
      ...task,
      // preview of the return leg: outbound checkpoints reversed
      returnCheckpoints: [...outbound].reverse().map((c, i) => ({ sequence: i + 1, name: c.name })),
    });
  });
}
