/**
 * Standalone database seeder (mock-up data).
 *
 * Usage (Revision 6):
 *   bun run db:seed        # recommended — runs prisma/seed.ts via the
 *                          # `db:seed` script in package.json
 *
 * The seeder is IDEMPOTENT: running it multiple times is safe.
 * It skips any entity that already exists, so it can be used to
 * re-sync missing demo data without duplicating rows.
 *
 * As of Revision 6 the app NO LONGER auto-seeds on the first API request.
 * The database schema and the demo dataset are now separate concerns:
 *   1. `bun run db:push`  — syncs the Prisma schema to the database
 *   2. `bun run db:seed`  — OPTIONAL: creates demo accounts, gudang,
 *                           shipments, invoices, etc.
 *   3. `bun run dev`      — start the dev server
 * To restore the old auto-seed behaviour, set `AUTO_SEED_ON_BOOT=true` in
 * `.env` — then a fresh `db:push` will trigger the seeder the first time
 * any API request comes in (mirrors the Docker "migrate + seed on boot"
 * entrypoint). Production tenants are NEVER auto-seeded.
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
  console.log("  farhan / Demo#Pass2026        (kurir, Gudang Medan)");
  console.log("  lina   / Demo#Pass2026        (kurir, Gudang Banda Aceh)");
  console.log("  bayu   / Demo#Pass2026        (driver, Gudang Medan)");
  console.log("  rudi   / Demo#Pass2026        (driver, Gudang Banda Aceh)");
  console.log("  fajar  / Demo#Pass2026        (kenek, Gudang Medan)");
  console.log("  yudi   / Demo#Pass2026        (kenek, Gudang Banda Aceh)");
  console.log("  wawan  / Demo#Pass2026        (staff gudang, Gudang Medan)");
  console.log("");
  console.log("Demo B2B Master Resi scan:");
  console.log("  MKT-000002 (PT Maju Bersama, PICKED_UP) — paket sudah di kurir, Admin Gudang tinggal scan Master Resi sekali");
  console.log("  MKT-000008 (PT Maju Bersama, READY_FOR_PICKUP) — tugas pickup Rizky, scan Master Resi sekali cukup");
  console.log("  (semua shipment B2B sudah ditagirkan ke invoice: MKT-000002/5 → INV-2026-000001, MKT-000003 → INV-2026-000003, MKT-000008 → INV-2026-000002)");
  console.log("");
  console.log("Demo Owner Dashboard approval queue:");
  console.log("  TOP-000002  Top Up Budi        (Rp150.000, menunggu verifikasi Owner — ada bukti transfer)");
  console.log("  WDR-000001  Withdrawal Hendra (Rp30.000, menunggu approval Owner)");
  console.log("  COM-000001  Komisi Budi        (Rp58.500, PENDING — invoice belum LUNAS)");
  console.log("");
  console.log("Catatan aturan baru:");
  console.log("  - DP / 'Pembayaran Sebagian' dihapus. B2C ditanggung Marketing, B2B ditagih via invoice.");
  console.log("  - Resi hanya menampilkan Nilai Pengiriman (+ No. Invoice untuk B2B).");
  console.log("  - Shipment B2B wajib masuk invoice sebelum bisa di-pickup.");
  console.log("  - Pengirim & Penerima tidak boleh identik (validasi client + server).");
}

main()
  .catch((e) => {
    console.error("✖ Seed gagal:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
