import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canTransition } from "@/lib/shipment-flow";
import { hasPermission } from "@/lib/auth";
import { assertShipmentScope } from "@/lib/gudang-scope";

type Params = { params: Promise<{ id: string }> };

/**
 * Submit a CREATED shipment for pickup.
 * Allowed for shipment editors, or for staff who may create pickup requests
 * (Admin Gudang requesting a pickup for a customer they know).
 * Gates (revision):
 * - the price MUST be counted first ("Hitung Harga") — a pickup request without
 *   a computed price is rejected (422);
 * - the Penerima (recipient) must be filled — it is printed on the Shipment
 *   Resi & every Detail Resi when the pickup is requested.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.view");
    if (!hasPermission(user, "shipment.update") && !hasPermission(user, "pickup.create")) {
      return fail(403, "Missing permission: shipment.update");
    }
    const { id } = await params;
    const master = await db.masterShipment.findUnique({ where: { id: Number(id) }, include: { details: true } });
    if (!master) return fail(404, "Shipment tidak ditemukan.");
    await assertShipmentScope(user, master);
    if (!canTransition(master.status, "READY_FOR_PICKUP")) {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa di-submit untuk pickup.`);
    }
    if (master.details.length === 0) {
      return fail(422, "Tambahkan minimal satu detail barang sebelum submit untuk pickup.");
    }
    if (master.priceAmount == null || master.priceAmount <= 0) {
      return fail(422, "Harga belum dihitung — klik “Hitung Harga” dan simpan harga shipment sebelum submit untuk pickup.");
    }
    if (!master.penerimaName) {
      return fail(422, "Isi data Penerima (nama penerima) sebelum submit untuk pickup — Penerima dicetak pada resi.", {
        penerimaName: ["Penerima wajib diisi (dicetak pada Resi)."],
      });
    }

    const updated = await db.masterShipment.update({ where: { id: master.id }, data: { status: "READY_FOR_PICKUP" } });
    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "READY_FOR_PICKUP",
        description: `Shipment siap dijemput (${master.details.length} paket) — harga Rp${Math.round(master.priceAmount).toLocaleString("id-ID")}`,
        actorId: user.id,
      },
    });
    await audit({ action: "status_change", entityType: "shipment", entityId: master.id, entityLabel: `${master.masterCode} → READY_FOR_PICKUP`, actor: user });
    return ok(updated);
  });
}
