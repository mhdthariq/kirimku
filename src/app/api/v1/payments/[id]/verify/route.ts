import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, fail, HttpError } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
    return handle(req, async () => {
        const user = await guard(req, "payment.verify");
        const { id } = await params;
        try {
            const updated = await db.$transaction(
                async (tx) => {
                    const payment = await tx.payment.findUnique({
                        where: { id: Number(id) },
                        include: {
                            master: {
                                include: {
                                    customer: { select: { type: true } },
                                },
                            },
                        },
                    });
                    if (!payment)
                        throw new HttpError(404, "Payment tidak ditemukan.");
                    await assertShipmentScope(user, payment.master);
                    if (payment.status !== "RECORDED")
                        throw new HttpError(
                            422,
                            `Payment berstatus ${payment.status}, hanya RECORDED yang bisa diverifikasi.`,
                        );
                    if (payment.master.customer.type === "b2b")
                        throw new HttpError(
                            422,
                            "Pembayaran B2B melalui invoice, bukan per shipment.",
                        );
                    if (payment.master.status === "CANCELLED")
                        throw new HttpError(
                            422,
                            "Shipment dibatalkan; pembayaran tidak dapat diverifikasi.",
                        );
                    const total =
                        payment.master.finalPriceAmount ??
                        payment.master.priceAmount;
                    const verified = await tx.payment.findMany({
                        where: {
                            masterId: payment.masterId,
                            status: "VERIFIED",
                        },
                        select: { amount: true },
                    });
                    const paid = verified.reduce((sum, p) => sum + p.amount, 0);
                    if (
                        total == null ||
                        !Number.isFinite(payment.amount) ||
                        payment.amount <= 0 ||
                        payment.amount > total - paid
                    )
                        throw new HttpError(
                            422,
                            "Pembayaran melebihi sisa tagihan atau harga belum dihitung.",
                        );
                    const result = await tx.payment.updateMany({
                        where: { id: payment.id, status: "RECORDED" },
                        data: {
                            status: "VERIFIED",
                            verifiedById: user.id,
                            verifiedAt: new Date(),
                        },
                    });
                    if (result.count !== 1)
                        throw new HttpError(
                            409,
                            "Status pembayaran sudah berubah. Muat ulang.",
                        );
                    return tx.payment.findUniqueOrThrow({
                        where: { id: payment.id },
                        include: { master: { select: { masterCode: true } } },
                    });
                },
                {
                    isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                },
            );
            await audit({
                action: "status_change",
                entityType: "payment",
                entityId: updated.id,
                entityLabel: `${updated.master.masterCode} → VERIFIED`,
                actor: user,
            });
            const { master: _master, ...payment } = updated;
            return ok(payment);
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2034"
            )
                return fail(
                    409,
                    "Pembayaran berubah bersamaan. Muat ulang lalu coba lagi.",
                );
            throw error;
        }
    });
}
