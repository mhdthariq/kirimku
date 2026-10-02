import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { nextCode } from "@/lib/code-generator";
import { summarizeExpenses, validateExpense } from "@/lib/transport-ops";
import { assertTransportAccess, parseOptionalPhoto } from "@/lib/transport-ops-server";

type Params = { params: Promise<{ id: string }> };

async function loadTransport(id: string) {
  return db.transport.findUnique({
    where: { id: Number(id) },
    include: { route: true, shipments: { include: { master: true } } },
  });
}

/** GET /transports/:id/expenses — every expense of the transport + totals per type. */
export async function GET(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.view");
    const { id } = await params;
    const transport = await loadTransport(id);
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);

    const rows = await db.transportExpense.findMany({ where: { transportId: transport.id }, orderBy: [{ createdAt: "desc" }] });
    // The photo itself is a large data URL: list responses only say whether one exists.
    return ok(
      rows.map(({ photoUrl, ...r }) => ({ ...r, hasPhoto: photoUrl != null })),
      { summary: summarizeExpenses(rows) },
    );
  });
}

/** POST /transports/:id/expenses — { type, amount, description?, photo? } (photo optional). */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(req, async () => {
    const user = await guard(req, "transport.expense.create");
    const { id } = await params;
    const transport = await loadTransport(id);
    if (!transport) return fail(404, "Transport tidak ditemukan.");
    await assertTransportAccess(user, transport);

    const body = await req.json().catch(() => ({}));
    const problem = validateExpense({ type: body.type, amount: body.amount });
    if (problem) return fail(422, problem, { type: [problem] });
    const photo = parseOptionalPhoto(body.photo);
    if (photo.error) return fail(422, photo.error, { photo: [photo.error] });

    const expenseCode = await nextCode("transportExpense", "EXP-2026-", "expenseCode");
    const created = await db.transportExpense.create({
      data: {
        expenseCode,
        transportId: transport.id,
        type: String(body.type),
        amount: Number(body.amount),
        description: str(body.description),
        photoUrl: photo.photoUrl,
        createdById: user.id,
      },
    });
    await audit({
      action: "create",
      entityType: "transport_expense",
      entityId: created.id,
      entityLabel: `${transport.transportCode} · ${created.type} Rp${created.amount.toLocaleString("id-ID")}`,
      actor: user,
      after: { type: created.type, amount: created.amount, hasPhoto: photo.photoUrl != null },
    });
    const { photoUrl, ...rest } = created;
    return ok({ ...rest, hasPhoto: photoUrl != null });
  });
}
