/**
 * Standalone database seeder (mock-up data).
 *
 * Usage:
 *   bun run db:seed        (recommended — resolves tsconfig paths)
 *
 * The seeder is IDEMPOTENT: running it multiple times is safe.
 * It skips any entity that already exists, so it can be used to
 * re-sync missing demo data without duplicating rows.
 *
 * The app ALSO auto-seeds on the first API request after a fresh
 * `prisma db push` (see src/lib/seed.ts → ensureSeed), mirroring a
 * "migrate + seed on boot" docker workflow. This CLI script simply
 * exposes the same routine for manual / CI usage.
 *
 * Demo dataset geography: Sumatra Island only — main corridor
 *   Medan → Banda Aceh (via Lhokseumawe mid-route).
 * The B2B shipment MKT-000002 / MKT-000008 demonstrates the new
 *   B2B Master Resi scan option (single Master Resi scan covers all
 *   packages — no per-package scan required).
 */
import { ensureSeed } from "../src/lib/seed";
import { db } from "../src/lib/db";

async function main() {
  console.log("→ Menjalankan seeder mock-up data...");
  await ensureSeed();

  // Report what is in the database now.
  const [users, employees, warehouses, vehicles, routes, checkpoints, tariffs, customers, shipments, shipmentDetails, pickups, deliveries, transports, invoices, payments, auditLogs] =
    await Promise.all([
      db.user.count(),
      db.employee.count(),
      db.warehouse.count(),
      db.vehicle.count(),
      db.route.count(),
      db.checkpoint.count(),
      db.tariff.count(),
      db.customer.count(),
      db.masterShipment.count(),
      db.detailShipment.count(),
      db.pickup.count(),
      db.delivery.count(),
      db.transport.count(),
      db.invoice.count(),
      db.payment.count(),
      db.auditLog.count(),
    ]);

  console.log("✔ Seed selesai. Ringkasan data mock-up:");
  console.log(`   Users: ${users} (owner + 8 staff)`);
  console.log(`   Employees: ${employees}`);
  console.log(`   Gudang: ${warehouses} (Medan · Banda Aceh · Lhokseumawe)`);
  console.log(`   Vehicles: ${vehicles}`);
  console.log(`   Routes: ${routes} | Checkpoints: ${checkpoints}`);
  console.log(`   Tariffs: ${tariffs}`);
  console.log(`   Customers: ${customers}`);
  console.log(`   Shipments: ${shipments} | Detail items: ${shipmentDetails}`);
  console.log(`   Pickups: ${pickups} | Deliveries: ${deliveries}`);
  console.log(`   Transports: ${transports}`);
  console.log(`   Invoices: ${invoices} | Payments: ${payments}`);
  console.log(`   Audit logs: ${auditLogs}`);
  console.log("");
  console.log("Akun demo:");
  console.log("  owner  / ChangeMeOwner#2026   (akses penuh — satu-satunya yang melihat data SEMUA gudang)");
  console.log("  siti   / Demo#Pass2026        (admin kantor, Gudang Medan)");
  console.log("  budi   / Demo#Pass2026        (marketing, Gudang Medan)");
  console.log("  agus   / Demo#Pass2026        (admin gudang, Gudang Medan)");
  console.log("  ratna  / Demo#Pass2026        (admin gudang, Gudang Lhokseumawe — demo isolasi data)");
  console.log("  dewi   / Demo#Pass2026        (kurir, Gudang Medan)");
  console.log("  rizky  / Demo#Pass2026        (kurir, Gudang Medan)");
  console.log("  joko   / Demo#Pass2026        (driver, Gudang Medan)");
  console.log("  andi   / Demo#Pass2026        (kenek, Gudang Medan)");
  console.log("  wawan  / Demo#Pass2026        (staff gudang, Gudang Medan)");
  console.log("");
  console.log("Demo B2B Master Resi scan:");
  console.log("  MKT-000002 (PT Maju Bersama, PICKED_UP) — paket sudah di kurir, Admin Gudang tinggal scan Master Resi sekali");
  console.log("  MKT-000008 (PT Maju Bersama, READY_FOR_PICKUP) — tugas pickup Rizky, scan Master Resi sekali cukup");
  console.log("");
  console.log("Demo Owner Dashboard approval queue:");
  console.log("  TOP-000002  Top Up Budi        (Rp150.000, menunggu verifikasi Owner — ada bukti transfer)");
  console.log("  WDR-000001  Withdrawal Hendra (Rp30.000, menunggu approval Owner)");
  console.log("  PAY-000001  Payment MKT-000001 (Rp20.000, status RECORDED — menunggu verifikasi)");
  console.log("  COM-000001  Komisi Budi        (Rp58.500, PENDING — invoice belum LUNAS)");
}

main()
  .catch((e) => {
    console.error("✖ Seed gagal:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
