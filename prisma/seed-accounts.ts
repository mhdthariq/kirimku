/**
 * Standalone ACCOUNTS-ONLY seeder — creates just the demo logins (owner +
 * staff + partners) plus the supporting gudang needed for them to operate.
 * SKIPS all transactional demo data: no vehicles, routes, tariffs, customers,
 * shipments, invoices, or audit logs.
 *
 * Usage:
 *   bun run db:seed:accounts   # recommended — runs this file via the
 *                              # `db:seed:accounts` script in package.json
 *
 * Why this exists separately from `bun run db:seed`:
 *   The full seeder (`prisma/seed.ts`) is great for a one-shot demo setup,
 *   but it pollutes the operational pages with 9 mock shipments, 4 pickups,
 *   transports, invoices, etc. — which gets in the way when you just want
 *   to test a fresh workflow end-to-end with your own data.
 *
 *   This script gives you a clean database with all 22 demo logins working
 *   (owner + 21 staff/partner) plus the three demo gudang (Medan / Banda
 *   Aceh / Lhokseumawe) so role-based access control, per-gudang data
 *   isolation, and partner wallets all work — nothing else.
 *
 * Need an even more minimal seed? Use `bun run db:seed:owner` — it creates
 * ONLY the owner login (no gudang, no staff, no partners). See
 * `prisma/seed-owner.ts`.
 *
 * Idempotent: every upsert is keyed by a natural identifier
 * (warehouse.code, employee.employeeNumber, user.username, partner.userId),
 * so running this multiple times is safe. It is also safe to run BEFORE or
 * AFTER the full `bun run db:seed` or the owner-only `bun run db:seed:owner`
 * — all three seeders converge on the same account set.
 *
 * Demo accounts created (passwords are shown in docs/06-seeding-and-demo-accounts.md):
 *   owner  / ChangeMeOwner#2026   (akses penuh — satu-satunya yang melihat data SEMUA gudang)
 *   siti   / Demo#Pass2026        (admin kantor, Gudang Medan)
 *   budi   / Demo#Pass2026        (marketing, Gudang Medan)
 *   agus   / Demo#Pass2026        (admin gudang, Gudang Medan)
 *   ratna  / Demo#Pass2026        (admin gudang, Gudang Lhokseumawe — demo isolasi data)
 *   dewi   / Demo#Pass2026        (kurir, Gudang Medan)
 *   rizky  / Demo#Pass2026        (kurir, Gudang Medan)
 *   joko   / Demo#Pass2026        (driver, Gudang Medan)
 *   andi   / Demo#Pass2026        (kenek, Gudang Medan)
 *   farhan / Demo#Pass2026        (kurir, Gudang Medan)
 *   lina   / Demo#Pass2026        (kurir, Gudang Banda Aceh)
 *   bayu   / Demo#Pass2026        (driver, Gudang Medan)
 *   rudi   / Demo#Pass2026        (driver, Gudang Banda Aceh)
 *   fajar  / Demo#Pass2026        (kenek, Gudang Medan)
 *   yudi   / Demo#Pass2026        (kenek, Gudang Banda Aceh)
 *   wawan  / Demo#Pass2026        (staff gudang, Gudang Medan)
 *   adit   / Demo#Pass2026        (marketing, Gudang Medan — UMUM, no gudang alignment)
 *   hendra / Demo#Pass2026        (vehicle owner — owns BK 9102 KTA & BK 9455 KTB)
 *   sari   / Demo#Pass2026        (vehicle owner — owns BK 7788 KTC)
 *   doni   / Demo#Pass2026        (vehicle owner)
 *   maya   / Demo#Pass2026        (vehicle owner)
 *   yusuf  / Demo#Pass2026        (vehicle owner)
 */
import { seedAccountsOnly } from "../src/lib/seed";
import { db } from "../src/lib/db";

async function main() {
  console.log("→ Menjalankan seeder AKUN SAJA (tanpa data mock-up operasional)...");
  await seedAccountsOnly();

  // Report what is in the database now.
  const [users, employees, warehouses, partners, wallets, roles, rolePermissions] =
    await Promise.all([
      db.user.count(),
      db.employee.count(),
      db.warehouse.count(),
      db.partner.count(),
      db.wallet.count(),
      db.role.count(),
      db.rolePermission.count(),
    ]);

  console.log("✔ Seed akun selesai. Ringkasan:");
  console.log(`   Users: ${users} (owner + 21 staff/partner)`);
  console.log(`   Employees: ${employees}`);
  console.log(`   Gudang: ${warehouses} (Medan · Banda Aceh · Lhokseumawe)`);
  console.log(`   Partners: ${partners} (budi, adit, hendra, sari, doni, maya, yusuf)`);
  console.log(`   Wallets: ${wallets}`);
  console.log(`   RBAC: ${roles} roles · ${rolePermissions} role-permission links`);
  console.log("");
  console.log("Akun demo (password sama untuk semua kecuali owner):");
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
  console.log("  adit   / Demo#Pass2026        (marketing, Gudang Medan — UMUM, no gudang alignment)");
  console.log("  hendra / Demo#Pass2026        (vehicle owner)");
  console.log("  sari   / Demo#Pass2026        (vehicle owner)");
  console.log("  doni   / Demo#Pass2026        (vehicle owner)");
  console.log("  maya   / Demo#Pass2026        (vehicle owner)");
  console.log("  yusuf  / Demo#Pass2026        (vehicle owner)");
  console.log("");
  console.log("Tidak ada data operasional dibuat — kendaraan, rute, tarif, pelanggan,");
  console.log("shipment, invoice, dan audit log tidak di-seed. Gunakan `bun run db:seed`");
  console.log("(full) jika ingin dataset lengkap, atau buat data manual lewat UI.");
}

main()
  .catch((e) => {
    console.error("✖ Seed akun gagal:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
