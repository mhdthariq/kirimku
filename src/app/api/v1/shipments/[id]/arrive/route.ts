import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, num, str } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { canTransition } from "@/lib/shipment-flow";
import { scanProgress } from "@/lib/scan-flow";

type Params = { params: Promise<{ id: string }> };

/**
 * Confirm that a shipment has arrived at the gudang (permission:
 * shipment.confirm_arrival — Admin Gudang / Staff Gudang).
 *
 * Body: { warehouseId, mode: "scan" | "walk_in", notes? }
 * - mode "scan":    shipment PICKED_UP (kurir brought the packages back) —
 *                   every package must have been scanned first.
 * - mode "walk_in": customer handed the package over at the gudang counter —
 *                   no scanning needed, allowed straight from CREATED /
 *                   READY_FOR_PICKUP.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handle(async () => {
    const user = await guard(req, "shipment.confirm_arrival");
    const { id } = await params;
    const master = await db.masterShipment.findUnique({
      where: { id: Number(id) },
      include: { customer: { select: { name: true } }, details: { select: { id: true } } },
    });
    if (!master) return fail(404, "Shipment tidak ditemukan.");

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === "walk_in" ? "walk_in" : "scan";
    const warehouseId = num(body.warehouseId);
    const warehouse = warehouseId ? await db.warehouse.findUnique({ where: { id: warehouseId } }) : null;
    if (!warehouse || !warehouse.isActive) {
      return fail(422, "Gudang tujuan wajib dipilih.", { warehouseId: ["Gudang tujuan wajib dipilih."] });
    }
    const notes = str(body.notes);

    if (!canTransition(master.status, "RECEIVED_AT_GUDANG")) {
      return fail(422, `Shipment dengan status ${master.status} tidak bisa dikonfirmasi tiba di gudang.`);
    }

    if (mode === "scan") {
      if (master.status !== "PICKED_UP") {
        return fail(422, `Mode scan hanya untuk shipment PICKED_UP (saat ini: ${master.status}). Gunakan walk-in untuk pelanggan yang datang langsung.`);
      }
      if (master.details.length === 0) {
        return fail(422, "Shipment belum punya detail barang.");
      }
      const progress = await scanProgress({ masterId: master.id, context: "gudang_arrival" });
      if (!progress.allScanned) {
        return fail(422, `Belum semua paket discan (${progress.scanned}/${progress.total}) — scan semua paket atau gunakan tombol "Scan Semua Paket".`);
      }
    } else if (!["CREATED", "READY_FOR_PICKUP"].includes(master.status)) {
      return fail(422, `Walk-in hanya untuk shipment CREATED / READY_FOR_PICKUP (saat ini: ${master.status}).`);
    }

    const updated = await db.masterShipment.update({
      where: { id: master.id },
      data: {
        status: "RECEIVED_AT_GUDANG",
        arrivedWarehouseId: warehouse.id,
        // walk-in packages start their journey at this gudang
        originWarehouseId: master.originWarehouseId ?? warehouse.id,
      },
    });

    const description =
      mode === "scan"
        ? `Paket diterima di ${warehouse.name} — ${master.details.length} paket terverifikasi scan${master.customer ? ` (kurir drop-off, shipment ${master.customer.name})` : ""}`
        : `Pelanggan ${master.customer?.name ?? ""} menyerahkan langsung di ${warehouse.name} (walk-in, tanpa scan)`;

    await db.trackingEvent.create({
      data: {
        masterId: master.id,
        event: "RECEIVED_AT_GUDANG",
        description: notes ? `${description} — ${notes}` : description,
        actorId: user.id,
      },
    });
    await audit({
      action: "status_change",
      entityType: "shipment",
      entityId: master.id,
      entityLabel: `${master.masterCode} → RECEIVED_AT_GUDANG (${mode === "walk_in" ? "walk-in" : "scan"}) @ ${warehouse.name}`,
      actor: user,
      after: { mode, warehouse: warehouse.name, packages: master.details.length },
    });
    return ok({ ...updated, warehouseName: warehouse.name, mode });
  });
}
