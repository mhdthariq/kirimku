/* Reset demo data for repeatable E2E testing: pickup PICK-2026-000001 back to
 * ASSIGNED, remove its pickup scans (keep seed data), remove test transports
 * created by the API test, and restore MKT-000001 to READY_FOR_PICKUP. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // pickup 5 (PICK-2026-000001)
  const pickup = await db.pickup.findUnique({ where: { pickupCode: "PICK-2026-000001" } });
  if (pickup) {
    await db.handoverScan.deleteMany({ where: { pickupId: pickup.id, scannedAt: { gte: new Date("2026-09-10") } } });
    await db.pickup.update({ where: { id: pickup.id }, data: { status: "ASSIGNED", completedAt: null } });
    await db.masterShipment.update({ where: { id: pickup.masterId }, data: { status: "READY_FOR_PICKUP", arrivedWarehouseId: null } });
    await db.handoverScan.deleteMany({ where: { masterId: pickup.masterId, context: "gudang_arrival", scannedAt: { gte: new Date("2026-09-10") } } });
    console.log("pickup reset to ASSIGNED; master to READY_FOR_PICKUP");
  }
  // delete transports created today (test artifacts) — restore shipments
  const today = new Date("2026-09-10");
  const testTransports = await db.transport.findMany({ where: { createdAt: { gte: today } }, include: { shipments: true } });
  for (const t of testTransports) {
    for (const s of t.shipments) {
      if (s.master.status === "IN_TRANSPORT" || s.master.status === "ARRIVED_AT_GUDANG") {
        await db.masterShipment.update({ where: { id: s.shipmentId }, data: { status: "RECEIVED_AT_GUDANG", arrivedWarehouseId: null } });
      }
    }
    await db.transport.delete({ where: { id: t.id } });
    console.log("deleted test transport", t.transportCode);
  }
  console.log("reset done");
}

main().finally(() => db.$disconnect());
