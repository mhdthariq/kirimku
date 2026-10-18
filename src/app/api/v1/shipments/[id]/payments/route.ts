import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/persistence/db";
import {
    guard,
    ok,
    handle,
    fail,
    requireNum,
    str,
    HttpError,
} from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";
import { hasPermission } from "@/infrastructure/auth/auth";
import { tracksShipmentPayments } from "@/domain/shipment-payment";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
    return handle(req, async () => {
        const user = await guard(req, "payment.view");
        const { id } = await params;
        const master = await db.masterShipment.findUnique({
            where: { id: Number(id) },
        });
        if (!master) return fail(404, "Shipment tidak ditemukan.");
        await assertShipmentScope(user, master);
        const payments = await db.payment.findMany({
            where: { masterId: Number(id) },
            orderBy: { createdAt: "desc" },
            include: {
                recordedBy: { select: { name: true } },
                verifiedBy: { select: { name: true } },
            },
        });
        return ok(payments);
    });
}

export async function POST(req: NextRequest, { params }: Params) {
    return handle(req, async () => {
        const user = await guard(req);
        const canRecord = hasPermission(user, "payment.record");
        const isAdminGudang =
            user.partnerType !== "MARKETING" &&
            user.roles.some((role) => role.slug === "admin-gudang");
        if (!canRecord && !isAdminGudang)
            return fail(403, "Missing permission: payment.record");
        const { id } = await params;
        const masterId = Number(id);
        if (!Number.isSafeInteger(masterId) || masterId <= 0)
            return fail(422, "ID shipment tidak valid.");
        const body = await req.json().catch(() => ({}));
        if (!["CASH", "TRANSFER"].includes(body.method))
            return fail(422, "Metode pembayaran harus CASH atau TRANSFER.");
        const amount = requireNum(body.amount, "amount", 1);
        const reference = str(body.reference);
        try {
            const { payment, master } = await db.$transaction(
                async (tx) => {
                    const master = await tx.masterShipment.findUnique({
                        where: { id: masterId },
                        include: { customer: { select: { type: true } } },
                    });
                    if (!master)
                        throw new HttpError(404, "Shipment tidak ditemukan.");
                    await assertShipmentScope(user, master);
                    if (!canRecord && !tracksShipmentPayments(master))
                        throw new HttpError(
                            403,
                            "Admin Gudang hanya dapat mencatat pembayaran B2C yang dibuat Admin Gudang.",
                        );
                    if (master.customer.type === "b2b")
                        throw new HttpError(
                            422,
                            "Pembayaran B2B melalui invoice, bukan per shipment.",
                        );
                    if (master.status === "CANCELLED")
                        throw new HttpError(
                            422,
                            "Shipment dibatalkan; pembayaran tidak dapat dicatat.",
                        );
                    const total = master.finalPriceAmount ?? master.priceAmount;
                    if (
                        master.priceAmount == null ||
                        total == null ||
                        total <= 0
                    )
                        throw new HttpError(
                            422,
                            "Hitung harga shipment terlebih dahulu sebelum mencatat pembayaran.",
                        );
                    const payments = await tx.payment.findMany({
                        where: { masterId, status: "VERIFIED" },
                        select: { amount: true },
                    });
                    const remaining = Math.max(
                        0,
                        total - payments.reduce((sum, p) => sum + p.amount, 0),
                    );
                    if (amount > remaining)
                        throw new HttpError(
                            422,
                            "Pembayaran melebihi sisa tagihan.",
                        );
                    const payment = await tx.payment.create({
                        data: {
                            masterId,
                            method: body.method,
                            amount,
                            status: "RECORDED",
                            reference,
                            recordedById: user.id,
                        },
                    });
                    return { payment, master };
                },
                {
                    isolationLevel:
                        Prisma.TransactionIsolationLevel.Serializable,
                },
            );
            await audit({
                action: "created",
                entityType: "payment",
                entityId: payment.id,
                entityLabel: `${master.masterCode} · Rp${amount.toLocaleString("id-ID")}`,
                actor: user,
                after: payment,
            });
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
