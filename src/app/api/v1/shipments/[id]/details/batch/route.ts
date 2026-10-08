import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle, HttpError } from "@/composition/api-helpers";
import { audit } from "@/infrastructure/services/audit";
import { assertShipmentScope } from "@/infrastructure/services/gudang-scope";

type Params = { params: Promise<{ id: string }> };

function invalid(field: string, message: string): never {
  throw new HttpError(422, message, { [field]: [message] });
}

async function mutate(req: NextRequest, { params }: Params, deleting: boolean) {
  return handle(req, async () => {
    const user = await guard(req, deleting ? "shipment_detail.delete" : "shipment_detail.update");
    const { id } = await params;
    const masterId = Number(id);
    if (!Number.isSafeInteger(masterId) || masterId <= 0) invalid("id", "Shipment ID tidak valid.");
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) invalid("body", "Body harus berupa object JSON.");
    const input = body as Record<string, unknown>;
    const detailIds = input.detailIds;
    if (!Array.isArray(detailIds) || detailIds.length === 0 ||
      detailIds.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
      new Set(detailIds).size !== detailIds.length) {
      invalid("detailIds", "detailIds harus berisi ID integer positif yang unik dan tidak kosong.");
    }
    const data: Prisma.DetailShipmentUpdateManyMutationInput = {};
    if (!deleting) {
      if (input.description !== undefined) {
        if (typeof input.description !== "string" || !input.description.trim()) invalid("description", "Description wajib diisi.");
        data.description = input.description.trim();
      }
      for (const field of ["lengthCm", "widthCm", "heightCm", "volumeM3", "actualWeightKg"] as const) {
        const value = input[field];
        if (value === undefined) continue;
        if (value === null && field !== "actualWeightKg") {
          data[field] = null;
        } else {
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid(field, `${field} harus berupa angka finite nonnegatif.`);
          data[field] = value;
        }
      }
      if (Object.keys(data).length === 0) invalid("body", "Tidak ada field detail untuk diubah.");
    }

    const result = await db.$transaction(async (tx) => {
      const master = await tx.masterShipment.findUnique({ where: { id: masterId } });
      if (!master) throw new HttpError(404, "Shipment tidak ditemukan.");
      await assertShipmentScope(user, master);
      if (!["CREATED", "READY_FOR_PICKUP"].includes(master.status)) {
        throw new HttpError(422, "Detail hanya bisa diubah atau dihapus saat master masih CREATED atau READY_FOR_PICKUP.");
      }
      const where = { masterId, id: { in: detailIds as number[] } };
      const before = await tx.detailShipment.findMany({ where, orderBy: { id: "asc" } });
      if (before.length !== detailIds.length) invalid("detailIds", "Semua detailIds harus milik shipment ini dan masih tersedia.");
      const mutation = deleting
        ? await tx.detailShipment.deleteMany({ where })
        : await tx.detailShipment.updateMany({ where, data });
      // Throw rather than return an error response: a short write must roll back.
      if (mutation.count !== detailIds.length) throw new HttpError(409, "Detail berubah bersamaan. Silakan coba lagi.");
      const after = deleting ? [] : await tx.detailShipment.findMany({ where, orderBy: { id: "asc" } });
      return { before, after, count: mutation.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new HttpError(409, "Shipment berubah bersamaan. Silakan coba lagi.");
      }
      throw error;
    });

    for (const before of result.before) {
      await audit({
        action: deleting ? "deleted" : "updated", entityType: "shipment_detail",
        entityId: before.id, entityLabel: before.detailCode, actor: user, before,
        ...(deleting ? {} : { after: result.after.find((detail) => detail.id === before.id) }),
      });
    }
    return deleting ? ok({ deleted: result.count }) : ok({ updated: result.count, details: result.after });
  });
}

export async function PUT(req: NextRequest, context: Params) {
  return mutate(req, context, false);
}

export async function DELETE(req: NextRequest, context: Params) {
  return mutate(req, context, true);
}
