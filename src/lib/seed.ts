import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureRbac } from "@/lib/rbac";
import { computePricing } from "@/lib/pricing";
import { tenantKey } from "@/lib/tenant-context";

// Small placeholder transfer-proof image for demo top-ups (inline SVG data URL).
const DEMO_PROOF_DATA_URL =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#f8f9fa"/><text x="20" y="70" font-family="sans-serif" font-size="14" fill="#334155">Bukti Transfer — BCA</text><text x="20" y="100" font-family="sans-serif" font-size="12" fill="#64748b">Demo: bukti top up marketing partner</text></svg>',
  ).toString("base64");

// Keyed per tenant so demo seeding is tracked separately for each database
// (in practice this only ever runs for the default/local tenant — real
// corporate tenants skip it entirely, see api-helpers.ts `guard()`).
const seedPromises = new Map<string, Promise<void>>();

/**
 * Idempotent demo backfill — safe to run on EVERY boot (fresh or seeded DB):
 *  1. connects the demo customers to the Marketing partner budi (only when
 *     still unassigned, so manual owner assignments always win) — powers the
 *     "marketing only knows their customers" data separation;
 *  2. creates the "driver checked in at the destination gudang" demo
 *     shipment MKT-000007 — physically at Gudang Banda Aceh on the new
 *     AT_DEST_GUDANG status (destReceivedAt still null), awaiting the Admin
 *     Gudang (ratna) transport drop-off scan; legacy rows still on
 *     ARRIVED_AT_GUDANG + destReceivedAt null are migrated to the new status;
 *  3. creates MKT-000008 — a B2B shipment (PT Maju Bersama) that demonstrates
 *     the new "B2B Master Resi scan" mode: a single Master Resi scan satisfies
 *     the entire pickup (no per-package scan required).
 */
async function seedBackfill(): Promise<void> {
  try {
    // --- 1. customer ↔ marketing linkage ------------------------------------
    const budiUser = await db.user.findUnique({ where: { username: "budi" }, select: { id: true } });
    const budiPartner = budiUser
      ? await db.partner.findFirst({ where: { userId: budiUser.id, type: "MARKETING", isActive: true } })
      : null;
    if (budiPartner) {
      await db.customer.updateMany({
        where: {
          code: { in: ["CUS-000001", "CUS-000002", "CUS-000003", "CUS-000004", "CUS-000005"] },
          marketingPartnerId: null,
        },
        data: { marketingPartnerId: budiPartner.id },
      });
    }

    // --- 2. MKT-000007 — driver at destination gudang, awaiting scan ---------
    const existingDemo = await db.masterShipment.findUnique({ where: { masterCode: "MKT-000007" } });
    if (existingDemo) {
      // migrate legacy demo rows (pre AT_DEST_GUDANG split) to the new status
      if (existingDemo.status === "ARRIVED_AT_GUDANG" && existingDemo.destReceivedAt == null) {
        await db.masterShipment.update({ where: { id: existingDemo.id }, data: { status: "AT_DEST_GUDANG" } });
      }
    } else {
      await createDemoArrivalShipment(budiPartner);
    }

    // --- 3. MKT-000008 — B2B Master Resi scan demo -------------------------
    const existingB2B = await db.masterShipment.findUnique({ where: { masterCode: "MKT-000008" } });
    if (!existingB2B) {
      await createB2BMasterResiShipment(budiPartner);
    }
  } catch {
    // backfill is best-effort — never block boot
  }
}

/** MKT-000007 — driver at destination gudang (Banda Aceh), awaiting scan. */
async function createDemoArrivalShipment(budiPartner: { id: number } | null): Promise<void> {
  const [sari, medan, bandaAceh, tariffRow] = await Promise.all([
    db.customer.findUnique({ where: { code: "CUS-000005" } }),
    db.warehouse.findFirst({ where: { city: "Medan" } }),
    db.warehouse.findFirst({ where: { city: "Banda Aceh" } }),
    db.tariff.findFirst({ where: { origin: "Medan", destination: "Banda Aceh", customerType: "b2c", isActive: true } }),
  ]);
  if (!sari || !medan || !bandaAceh) return;

  const actorId = async (username: string) =>
    (await db.user.findUnique({ where: { username }, select: { id: true } }))?.id ?? null;
  const [budiId, dewiId, agusId, jokoId] = await Promise.all([actorId("budi"), actorId("dewi"), actorId("agus"), actorId("joko")]);

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const createdAt = daysAgo(1.6);

  const shipment = await db.masterShipment.create({
    data: {
      masterCode: "MKT-000007",
      resi: "MKT-000007",
      customerId: sari.id,
      tariffId: tariffRow?.id ?? null,
      status: "AT_DEST_GUDANG",
      origin: "Medan",
      destination: "Banda Aceh",
      originWarehouseId: medan.id,
      destinationWarehouseId: bandaAceh.id,
      arrivedWarehouseId: bandaAceh.id, // physically at the destination gudang
      destReceivedAt: null, // NOT yet scan-verified by Admin Gudang Banda Aceh
      // Penerima != Pengirim: customer (Sari Indah) mengirim ke alamat berbeda
      // di kota tujuan — penerima adalah keluarga di Banda Aceh.
      penerimaName: "Reza Pahlawan",
      penerimaAddress: "Jl. T. Iskandar No. 7, Banda Aceh",
      penerimaContact: "0813-7700-0007",
      pengirimName: sari.name,
      pengirimPhone: sari.phone,
      createdByPartnerId: budiPartner?.id ?? null,
      createdAt,
      updatedAt: daysAgo(0.8),
    },
  });

  const detailDefs = [
    { description: "Paket elektronik", weightKg: 2.5, l: 30, w: 22, h: 14 },
    { description: "Kemasan kue kering", weightKg: 1.5, l: 25, w: 20, h: 10 },
  ];
  const date = [createdAt.getFullYear(), createdAt.getMonth() + 1, createdAt.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  const detailRows: { id: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null; actualWeightKg: number }[] = [];
  for (const [i, d] of detailDefs.entries()) {
    const row = await db.detailShipment.create({
      data: {
        detailCode: `DTL-${date}-ARR-${String(i + 1).padStart(3, "0")}`,
        masterId: shipment.id,
        description: d.description,
        actualWeightKg: d.weightKg,
        lengthCm: d.l,
        widthCm: d.w,
        heightCm: d.h,
        createdAt,
      },
    });
    detailRows.push(row);
  }
  if (tariffRow) {
    const r = computePricing(detailRows, tariffRow);
    await db.masterShipment.update({
      where: { id: shipment.id },
      data: { chargeableWeightKg: r.chargeableKg, ratePerKg: tariffRow.ratePerKg, priceAmount: r.price, pricedAt: createdAt },
    });
    // B2C — biaya ditanggung Marketing, tidak ada pembayaran customer.
    // Payment row dihapus sesuai aturan baru: B2C tidak ada DP / status pembayaran.
  }

  const events: { event: string; description: string; daysAgo: number; actorId: number | null }[] = [
    { event: "CREATED", description: "Shipment MKT-000007 dibuat", daysAgo: 1.6, actorId: budiId },
    { event: "READY_FOR_PICKUP", description: "Menunggu penjemputan kurir", daysAgo: 1.5, actorId: budiId },
    { event: "PICKED_UP", description: "Picked-up by Dewi Lestari", daysAgo: 1.45, actorId: dewiId },
    { event: "RECEIVED_AT_GUDANG", description: "Diterima di Gudang Medan", daysAgo: 1.4, actorId: agusId },
    { event: "IN_TRANSPORT", description: "Berangkat via transport TRP-2026-000003", daysAgo: 1.3, actorId: jokoId },
    { event: "AT_DEST_GUDANG", description: `Driver transport TRP-2026-000003 check-in di checkpoint akhir (dari ${medan.name}) — paket ada di gudang tujuan, menunggu scan penerimaan Admin Gudang`, daysAgo: 0.8, actorId: jokoId },
  ];
  for (const ev of events) {
    await db.trackingEvent.create({
      data: { masterId: shipment.id, event: ev.event, description: ev.description, actorId: ev.actorId, occurredAt: daysAgo(ev.daysAgo) },
    });
  }

  // The arrived linehaul that carried it (MDN → BNA, crew joko + andi)
  const [vehicle, driverEmp, kenekEmp] = await Promise.all([
    db.vehicle.findFirst({ where: { vehicleNumber: "BK 9455 KTB" } }),
    db.employee.findFirst({ where: { position: "Driver" } }),
    db.employee.findFirst({ where: { position: "Kenek" } }),
  ]);
  if (vehicle) {
    const transport = await db.transport.create({
      data: {
        transportCode: "TRP-2026-000003",
        vehicleId: vehicle.id,
        driverId: driverEmp?.id ?? null,
        kenekId: kenekEmp?.id ?? null,
        status: "ARRIVED",
        origin: "Medan",
        destination: "Banda Aceh",
        departedAt: daysAgo(1.3),
        arrivedAt: daysAgo(0.8),
        createdAt: daysAgo(1.5),
      },
    });
    await db.transportShipment.create({ data: { transportId: transport.id, shipmentId: shipment.id } });
  }
}

/**
 * MKT-000008 — B2B shipment (PT Maju Bersama) demonstrating the new B2B
 * Master Resi scan mode. A B2B pickup task assigned to kurir Rizky so the
 * kurir can open the scan dialog and only need to scan the Master Resi once
 * (not 8 packages individually).
 *
 * Aturan baru: shipment B2B wajib masuk ke invoice perusahaan customer sebelum
 * bisa di-pickup. Fungsi ini juga membuat (secara idempotent) invoice
 * INV-2026-000002 untuk PT Maju Bersama dan menambahkan MKT-000008 sebagai
 * invoice line — supaya pickup task yang dibuat di sini bisa di-confirm.
 */
async function createB2BMasterResiShipment(budiPartner: { id: number } | null): Promise<void> {
  const [maju, medan, bandaAceh, tariffRow] = await Promise.all([
    db.customer.findUnique({ where: { code: "CUS-000002" } }),
    db.warehouse.findFirst({ where: { city: "Medan" } }),
    db.warehouse.findFirst({ where: { city: "Banda Aceh" } }),
    db.tariff.findFirst({ where: { origin: "Medan", destination: "Banda Aceh", customerType: "b2b", isActive: true } }),
  ]);
  if (!maju || !medan || !bandaAceh) return;

  const actorId = async (username: string) =>
    (await db.user.findUnique({ where: { username }, select: { id: true } }))?.id ?? null;
  const [budiId, sitiId] = await Promise.all([actorId("budi"), actorId("siti")]);

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const createdAt = daysAgo(0.4);

  const shipment = await db.masterShipment.create({
    data: {
      masterCode: "MKT-000008",
      resi: "MKT-000008",
      customerId: maju.id,
      tariffId: tariffRow?.id ?? null,
      status: "READY_FOR_PICKUP",
      origin: "Medan",
      destination: "Banda Aceh",
      originWarehouseId: medan.id,
      destinationWarehouseId: bandaAceh.id,
      arrivedWarehouseId: null,
      // Penerima != Pengirim: PT Maju Bersama mengirim ke bagian gudangnya
      // sendiri di Banda Aceh — nama & kontak berbeda, alamat gudang berbeda
      // dari alamat kantor pusat (pengirim).
      penerimaName: "Bagian Gudang PT Maju Bersama",
      penerimaAddress: "Jl. T. Iskandar No. 12, Banda Aceh",
      penerimaContact: "0812-3456-9008",
      pengirimName: maju.companyName ?? maju.name,
      pengirimPhone: maju.phone,
      pengirimAddress: maju.address,
      createdByPartnerId: budiPartner?.id ?? null,
      createdAt,
      updatedAt: createdAt,
    },
  });

  // B2B shipments typically carry MANY packages — exactly the use case for
  // the Master Resi scan mode (one scan covers the whole consignment).
  const date = [createdAt.getFullYear(), createdAt.getMonth() + 1, createdAt.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  const time = [createdAt.getHours(), createdAt.getMinutes(), createdAt.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  const detailRows: { id: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null; actualWeightKg: number }[] = [];
  // 8 packages — typical B2B carton consignment
  for (let i = 0; i < 8; i++) {
    const row = await db.detailShipment.create({
      data: {
        detailCode: `DTL-${date}-${time}-${String(i + 1).padStart(3, "0")}`,
        masterId: shipment.id,
        description: `Karton B2B #${i + 1}`,
        actualWeightKg: 3.5,
        lengthCm: 40,
        widthCm: 30,
        heightCm: 25,
        createdAt,
      },
    });
    detailRows.push(row);
  }
  let invoicePrice = 0;
  if (tariffRow) {
    const r = computePricing(detailRows, tariffRow);
    invoicePrice = r.price;
    await db.masterShipment.update({
      where: { id: shipment.id },
      data: { chargeableWeightKg: r.chargeableKg, ratePerKg: tariffRow.ratePerKg, priceAmount: r.price, pricedAt: createdAt },
    });
    // DP / direct Payment untuk B2B dihapus — penagihan B2B dilakukan via invoice.
  }

  // --- B2B invoice gate: MKT-000008 wajib ada di invoice PT Maju Bersama ---
  // Buat invoice baru (INV-2026-000002) terpisah dari INV-2026-000001 agar
  // tidak mengubah total invoice yang sudah PARTIALLY_SETTLED. Idempotent:
  // gunakan upsert by invoiceNumber, dan hanya tambahkan line jika belum ada.
  if (invoicePrice > 0 && sitiId) {
    const invoice = await db.invoice.upsert({
      where: { invoiceNumber: "INV-2026-000002" },
      create: {
        invoiceNumber: "INV-2026-000002",
        customerId: maju.id,
        status: "SENT",
        issueDate: daysAgo(0.4),
        dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        notes: "Tagihan pengiriman B2B Master Resi demo (MKT-000008) — Medan → Banda Aceh",
        createdAt: daysAgo(0.4),
      },
      update: {},
    });
    const existingLine = await db.invoiceLine.findFirst({
      where: { invoiceId: invoice.id, shipmentId: shipment.id },
    });
    if (!existingLine) {
      await db.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          description: "MKT-000008 — pengiriman B2B Master Resi (8 karton @ 3,5 kg)",
          quantity: 1,
          unitPrice: invoicePrice,
          shipmentId: shipment.id,
        },
      });
    }
  }

  await db.trackingEvent.create({
    data: {
      masterId: shipment.id,
      event: "CREATED",
      description: `Shipment MKT-000008 (B2B Master Resi demo) dibuat oleh Budi Santoso`,
      actorId: budiId,
      occurredAt: createdAt,
    },
  });
  await db.trackingEvent.create({
    data: {
      masterId: shipment.id,
      event: "READY_FOR_PICKUP",
      description: "Menunggu penjemputan kurir — B2B: cukup scan Master Resi sekali (sudah masuk ke INV-2026-000002)",
      actorId: budiId,
      occurredAt: daysAgo(0.38),
    },
  });

  // Open pickup task assigned to kurir Rizky (MKT-000008 — READY_FOR_PICKUP).
  const rizkyEmp = await db.employee.findFirst({ where: { position: "Kurir", name: { contains: "Rizky" } } });
  if (rizkyEmp) {
    await db.pickup.create({
      data: {
        pickupCode: "PICK-2026-000008", masterId: shipment.id,
        kurirId: rizkyEmp.id,
        status: "ASSIGNED", notes: "B2B — cukup scan Master Resi di lokasi customer (invoice INV-2026-000002)",
        createdAt: daysAgo(0.2), updatedAt: daysAgo(0.2),
      },
    });
  }
}

/**
 * Idempotent demo seeding. Runs automatically on the first API request
 * (mirrors the docker "migrate + seed on boot" behaviour) and is a no-op
 * once the demo dataset exists.
 */
export function ensureSeed(): Promise<void> {
  const key = tenantKey();
  let p = seedPromises.get(key);
  if (!p) {
    p = runSeed().catch((e) => {
      seedPromises.delete(key);
      throw e;
    });
    seedPromises.set(key, p);
  }
  return p;
}

async function runSeed(): Promise<void> {
  await ensureRbac();

  // ----- Gudang (Sumatra Island — main corridor Medan → Banda Aceh) --------
  // WH-000001: Medan — origin hub & HQ
  // WH-000002: Banda Aceh — destination hub (main route endpoint)
  // WH-000003: Lhokseumawe — mid-route branch (demonstrates per-gudang data
  //             isolation: ratna in Lhokseumawe only sees LSM-side data)
  // customerSupportContact is printed on the Shipment Resi & Detail Resi.
  const gudangDefs = [
    { code: "WH-000001", name: "Gudang Medan", city: "Medan", address: "Jl. Gatot Subroto No. 45, Medan", latitude: 3.5952, longitude: 98.6722, customerSupportContact: "061-1234-0001" },
    { code: "WH-000002", name: "Gudang Banda Aceh", city: "Banda Aceh", address: "Jl. T. Iskandar No. 12, Banda Aceh", latitude: 5.5483, longitude: 95.3238, customerSupportContact: "0651-2345-0002" },
    { code: "WH-000003", name: "Gudang Lhokseumawe", city: "Lhokseumawe", address: "Jl. Merdeka No. 88, Lhokseumawe", latitude: 5.0313, longitude: 97.1417, customerSupportContact: "0645-3456-0003" },
  ];
  const gudang: Record<string, number> = {};
  for (const g of gudangDefs) {
    const w = await db.warehouse.upsert({
      where: { code: g.code },
      create: g,
      update: {},
    });
    gudang[g.city] = w.id;
  }

  // ----- Backfill: every karyawan must belong to a gudang (data separation) --
  // Employees without a gudang see no operational data (only the owner sees
  // everything), so older databases are backfilled with the first gudang.
  const unbound = await db.employee.findMany({ where: { warehouseId: null, isActive: true }, select: { id: true } });
  if (unbound.length > 0) {
    await db.employee.updateMany({ where: { id: { in: unbound.map((e) => e.id) } }, data: { warehouseId: gudang["Medan"] } });
  }

  const ownerExists = await db.user.findFirst({ where: { username: "owner" } });
  const shipmentCount = await db.masterShipment.count();
  if (ownerExists && shipmentCount >= 6) {
    // Already seeded — still run the idempotent backfill (customer ↔ marketing
    // linkage + the transport-arrival demo shipment + B2B Master Resi demo)
    // so upgraded DBs get the new demo data without touching existing rows.
    await seedBackfill();
    return;
  }

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  // ----- Employees + users -------------------------------------------------
  // EVERY karyawan is stationed at one gudang (warehouseId) — operational data
  // (shipments, pickups, deliveries, transports) is separated by that gudang.
  // ratna (Admin Gudang Lhokseumawe) demonstrates the data isolation: she only
  // sees Lhokseumawe-side data, never Medan's or Banda Aceh's.
  const staffPassword = hashPassword("Demo#Pass2026");
  const ownerPassword = hashPassword("ChangeMeOwner#2026");

  const staff: { username: string; name: string; position: string; role: string; employeeNumber: string; warehouseId: string }[] = [
    { username: "siti", name: "Siti Rahma", position: "Admin Kantor", role: "admin-kantor", employeeNumber: "EMP-000002", warehouseId: "Medan" },
    { username: "budi", name: "Budi Santoso", position: "Marketing", role: "marketing", employeeNumber: "EMP-000003", warehouseId: "Medan" },
    { username: "agus", name: "Agus Pratama", position: "Admin Gudang", role: "admin-gudang", employeeNumber: "EMP-000004", warehouseId: "Medan" },
    { username: "dewi", name: "Dewi Lestari", position: "Kurir", role: "kurir", employeeNumber: "EMP-000005", warehouseId: "Medan" },
    { username: "rizky", name: "Rizky Hidayat", position: "Kurir", role: "kurir", employeeNumber: "EMP-000006", warehouseId: "Medan" },
    { username: "joko", name: "Joko Widodo", position: "Driver", role: "driver", employeeNumber: "EMP-000007", warehouseId: "Medan" },
    { username: "andi", name: "Andi Wijaya", position: "Kenek", role: "kenek", employeeNumber: "EMP-000008", warehouseId: "Medan" },
    { username: "wawan", name: "Wawan Setiawan", position: "Staff Gudang", role: "staff-gudang", employeeNumber: "EMP-000009", warehouseId: "Medan" },
    { username: "ratna", name: "Ratna Kurnia", position: "Admin Gudang", role: "admin-gudang", employeeNumber: "EMP-000010", warehouseId: "Lhokseumawe" },
    // Revise.md §12 — Vehicle Owner: first-class external partner (NOT an
    // employee). hendra & sari own vehicles and earn transport profit share.
    { username: "hendra", name: "Hendra Gunawan", position: "Vehicle Owner", role: "vehicle-owner", employeeNumber: "EMP-000011", warehouseId: "Medan" },
    { username: "sari", name: "Sari Puspita", position: "Vehicle Owner", role: "vehicle-owner", employeeNumber: "EMP-000012", warehouseId: "Banda Aceh" },
  ];

  const ownerEmployee = await db.employee.upsert({
    where: { employeeNumber: "EMP-000001" },
    create: { employeeNumber: "EMP-000001", name: "Owner Utama", position: "Owner", phone: "061100000001" },
    update: {},
  });
  await db.user.upsert({
    where: { username: "owner" },
    create: { username: "owner", name: "Owner Utama", passwordHash: ownerPassword, isOwner: true, employeeId: ownerEmployee.id },
    update: {},
  });

  const usersByHandle: Record<string, { id: number; employeeId: number | null }> = { owner: { id: (await db.user.findUniqueOrThrow({ where: { username: "owner" } })).id, employeeId: ownerEmployee.id } };
  for (const s of staff) {
    const employee = await db.employee.upsert({
      where: { employeeNumber: s.employeeNumber },
      create: {
        employeeNumber: s.employeeNumber, name: s.name, position: s.position, phone: `06110000${s.employeeNumber.slice(-4)}`,
        warehouseId: gudang[s.warehouseId] ?? null,
      },
      update: { warehouseId: gudang[s.warehouseId] ?? null },
    });
    const user = await db.user.upsert({
      where: { username: s.username },
      create: { username: s.username, name: s.name, passwordHash: staffPassword, employeeId: employee.id },
      update: {},
    });
    const role = await db.role.findUniqueOrThrow({ where: { slug: s.role } });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    usersByHandle[s.username] = { id: user.id, employeeId: employee.id };
  }

  // ----- Revise.md: Partner profiles + wallets (§3/§12) ---------------------
  // budi (Marketing 80/20), hendra (Vehicle Owner 80/20), sari (Vehicle
  // Owner 70/30 — different config demonstrates per-partner profit sharing).
  const partnerDefs: { username: string; type: "MARKETING" | "VEHICLE_OWNER"; companyPercent: number; partnerPercent: number; bank: { bankName: string; bankAccountName: string; bankAccountNumber: string } }[] = [
    { username: "budi", type: "MARKETING", companyPercent: 80, partnerPercent: 20, bank: { bankName: "Bank BCA", bankAccountName: "Budi Santoso", bankAccountNumber: "1234567890" } },
    { username: "hendra", type: "VEHICLE_OWNER", companyPercent: 80, partnerPercent: 20, bank: { bankName: "Bank Mandiri", bankAccountName: "Hendra Gunawan", bankAccountNumber: "9876543210" } },
    { username: "sari", type: "VEHICLE_OWNER", companyPercent: 70, partnerPercent: 30, bank: { bankName: "Bank BRI", bankAccountName: "Sari Puspita", bankAccountNumber: "5555444433" } },
  ];
  const partnersByUsername: Record<string, number> = {};
  for (const p of partnerDefs) {
    const userId = usersByHandle[p.username]?.id;
    if (!userId) continue;
    const partner = await db.partner.upsert({
      where: { userId },
      create: {
        userId,
        type: p.type,
        companyPercent: p.companyPercent,
        partnerPercent: p.partnerPercent,
        bankName: p.bank.bankName,
        bankAccountName: p.bank.bankAccountName,
        bankAccountNumber: p.bank.bankAccountNumber,
      },
      update: {},
    });
    partnersByUsername[p.username] = partner.id;
    await db.wallet.upsert({ where: { partnerId: partner.id }, create: { partnerId: partner.id }, update: {} });
  }

  // ----- Vehicles -----------------------------------------------------------
  // Vehicle plates are Sumatran (BK = North Sumatra / Aceh plates).
  // Revise.md §13 — BK 9102 KTA & BK 9455 KTB belong to Vehicle Owner hendra;
  // BK 7788 KTC belongs to sari (multiple vehicles per owner, multiple owners).
  const vehicleDefs = [
    { vehicleNumber: "BK 9102 KTA", name: "Engkel Box", status: "ACTIVE", maxWeightKg: 1200, maxVolumeM3: 6, ownerUsername: "hendra" },
    { vehicleNumber: "BK 9455 KTB", name: "CDD 6 Ban", status: "ACTIVE", maxWeightKg: 3500, maxVolumeM3: 14, ownerUsername: "hendra" },
    { vehicleNumber: "BK 7788 KTC", name: "Fuso Besar", status: "MAINTENANCE", maxWeightKg: 8000, maxVolumeM3: 28, notes: "Perawatan berkala, kembali aktif minggu depan.", ownerUsername: "sari" },
  ];
  const vehicles: Record<string, number> = {};
  for (const { ownerUsername, ...v } of vehicleDefs) {
    const ownerId = ownerUsername ? partnersByUsername[ownerUsername] ?? null : null;
    const vehicle = await db.vehicle.upsert({
      where: { vehicleNumber: v.vehicleNumber },
      create: { ...v, ownerId },
      update: { ownerId },
    });
    vehicles[v.vehicleNumber] = vehicle.id;
  }
  // default crew for CDD: driver Joko + kenek Andi
  await db.vehicleAssignment.upsert({
    where: {
      vehicleId_driverId_kenekId_validFrom: {
        vehicleId: vehicles["BK 9455 KTB"],
        driverId: usersByHandle.joko.employeeId ?? 0,
        kenekId: usersByHandle.andi.employeeId ?? 0,
        validFrom: daysAgo(30),
      },
    },
    create: {
      vehicleId: vehicles["BK 9455 KTB"],
      driverId: usersByHandle.joko.employeeId,
      kenekId: usersByHandle.andi.employeeId,
      validFrom: daysAgo(30),
    },
    update: {},
  }).catch(() => undefined);

  // ----- Routes + checkpoints (≥ 3 per route) --------------------------------
  // Main route: Medan → Banda Aceh via the east-coast Trans-Sumatran highway.
  // Mid-stop checkpoints are real rest areas / towns along the corridor so
  // the driver dashboard map shows realistic progress.
  const routeDefs = [
    {
      name: "MDN - BNA Aceh Timur", origin: "Medan", destination: "Banda Aceh",
      checkpoints: [
        { name: "Gudang Medan (Start)", latitude: 3.5952, longitude: 98.6722, radiusMeters: 300 },
        { name: "Rest Area Tebing Tinggi", latitude: 3.3302, longitude: 99.1652, radiusMeters: 250 },
        { name: "Lhokseumawe (Mid)", latitude: 5.0313, longitude: 97.1417, radiusMeters: 250 },
        { name: "Gudang Banda Aceh (End)", latitude: 5.5483, longitude: 95.3238, radiusMeters: 300 },
      ],
    },
    {
      name: "MDN - LSM Lintas Sumatera", origin: "Medan", destination: "Lhokseumawe",
      checkpoints: [
        { name: "Gudang Medan (Start)", latitude: 3.5952, longitude: 98.6722, radiusMeters: 300 },
        { name: "Rest Area Tebing Tinggi", latitude: 3.3302, longitude: 99.1652, radiusMeters: 250 },
        { name: "Gudang Lhokseumawe (End)", latitude: 5.0313, longitude: 97.1417, radiusMeters: 300 },
      ],
    },
  ];
  const routes: Record<string, number> = {};
  for (const r of routeDefs) {
    let route = await db.route.findFirst({ where: { name: r.name } });
    if (!route) {
      route = await db.route.create({ data: { name: r.name, origin: r.origin, destination: r.destination } });
      let seq = 1;
      for (const c of r.checkpoints) {
        await db.checkpoint.create({ data: { routeId: route.id, name: c.name, sequence: seq++, latitude: c.latitude, longitude: c.longitude, radiusMeters: c.radiusMeters } });
      }
    }
    routes[r.name] = route.id;
  }

  // ----- Tariffs -------------------------------------------------------------
  // volumetricMultiplier (kg per m³) is configurable per tariff — pricing formula:
  // volumetric kg = (L×W×H cm / 1.000.000) × multiplier
  // Medan → Banda Aceh (~440 km east-coast corridor) — main route.
  const tariffDefs = [
    { origin: "Medan", destination: "Banda Aceh", customerType: "b2b", ratePerKg: 8000, volumetricMultiplier: 250 },
    { origin: "Medan", destination: "Banda Aceh", customerType: "b2c", ratePerKg: 9500, volumetricMultiplier: 250 },
    { origin: "Medan", destination: "Lhokseumawe", customerType: "b2b", ratePerKg: 5500, volumetricMultiplier: 250 },
    { origin: "Medan", destination: "Lhokseumawe", customerType: "b2c", ratePerKg: 6500, volumetricMultiplier: 250 },
  ];
  const tariffByRoute: Record<string, { id: number; ratePerKg: number; minChargeableKg: number; volumetricMultiplier: number; roundingMode: string; roundingUnitKg: number }> = {};
  for (const t of tariffDefs) {
    const existing = await db.tariff.findFirst({ where: { origin: t.origin, destination: t.destination, customerType: t.customerType } });
    const tariff = existing ?? (await db.tariff.create({ data: { ...t, minChargeableKg: 1, roundingMode: "UP", roundingUnitKg: 0.5, effectiveFrom: daysAgo(90) } }));
    tariffByRoute[`${t.origin}|${t.destination}|${t.customerType}`] = tariff;
  }

  // ----- Customers -------------------------------------------------------------
  const customerDefs = [
    { code: "CUS-000001", type: "b2c", name: "Rina Amelia", phone: "081234000001", address: "Jl. T. Iskandar No. 12, Banda Aceh" },
    { code: "CUS-000002", type: "b2b", name: "PT Maju Bersama", companyName: "PT Maju Bersama", phone: "081234000002", address: "Jl. Gatot Subroto No. 21, Medan" },
    { code: "CUS-000003", type: "b2b", name: "CV Sinar Jaya", companyName: "CV Sinar Jaya", phone: "081234000003", address: "Jl. Merdeka No. 5, Lhokseumawe" },
    { code: "CUS-000004", type: "b2c", name: "Tono Susilo", phone: "081234000004", address: "Jl. Kenanga No. 9, Banda Aceh" },
    { code: "CUS-000005", type: "b2c", name: "Sari Indah", phone: "081234000005", address: "Jl. Anggrek No. 3, Banda Aceh" },
  ];
  const customers: Record<string, { id: number; type: string }> = {};
  for (const c of customerDefs) {
    const customer = await db.customer.upsert({ where: { code: c.code }, create: c, update: {} });
    customers[c.name] = { id: customer.id, type: c.type };
  }

  // ----- Shipments lifecycle -----------------------------------------------------
  if ((await db.masterShipment.count()) === 0) {
    const shipmentDefs: {
      masterCode: string;
      customer: string;
      status: string;
      origin: string;
      destination: string;
      priced: boolean;
      createdDaysAgo: number;
      penerima: { name: string; address: string; contact: string };
      details: { description: string; quantity: number; weightKg: number; l: number; w: number; h: number }[];
    }[] = [
      {
        // Priced + READY_FOR_PICKUP so the open pickup task (rizky) can be
        // confirmed. Aturan baru: B2C tidak ada DP — biaya ditanggung Marketing.
        masterCode: "MKT-000001", customer: "Rina Amelia", status: "READY_FOR_PICKUP",
        origin: "Medan", destination: "Banda Aceh", priced: true, createdDaysAgo: 1,
        penerima: { name: "Laksmi Dewi", address: "Jl. T. Iskandar No. 12, Banda Aceh", contact: "0813-2222-3333" },
        details: [
          { description: "Paket pakaian", quantity: 1, weightKg: 2, l: 35, w: 25, h: 12 },
          { description: "Buku tulis", quantity: 3, weightKg: 1.5, l: 25, w: 20, h: 10 },
        ],
      },
      {
        // B2B PICKED_UP — sits in the gudang arrival queue. With the new B2B
        // Master Resi scan option, Admin Gudang can scan the Master Resi ONCE
        // to confirm receipt of all 10 packages (demo of the new feature).
        // Sudah masuk ke invoice INV-2026-000001 — requirement pickup B2B OK.
        masterCode: "MKT-000002", customer: "PT Maju Bersama", status: "PICKED_UP",
        origin: "Medan", destination: "Banda Aceh", priced: true, createdDaysAgo: 2,
        penerima: { name: "Hendra Gunawan", address: "Jl. T. Iskandar No. 88, Banda Aceh", contact: "0814-4444-5555" },
        details: [{ description: "Karton Tulis", quantity: 10, weightKg: 2.5, l: 25, w: 20, h: 20 }],
      },
      {
        // B2B RECEIVED_AT_GUDANG — penagihan via invoice (INV-2026-000003).
        masterCode: "MKT-000003", customer: "CV Sinar Jaya", status: "RECEIVED_AT_GUDANG",
        origin: "Medan", destination: "Lhokseumawe", priced: true, createdDaysAgo: 4,
        penerima: { name: "Bagian Gudang CV Sinar Jaya", address: "Jl. Merdeka No. 5, Lhokseumawe", contact: "0815-5555-6666" },
        details: [
          { description: "Mesin bubut mini", quantity: 1, weightKg: 40, l: 60, w: 45, h: 40 },
          { description: "Spare part", quantity: 4, weightKg: 5, l: 25, w: 20, h: 15 },
        ],
      },
      {
        // B2C IN_TRANSPORT — biaya ditanggung Marketing. Penerima (Dewi Susilo)
        // berbeda dari pengirim (Tono Susilo) — bukan diri sendiri.
        masterCode: "MKT-000004", customer: "Tono Susilo", status: "IN_TRANSPORT",
        origin: "Medan", destination: "Banda Aceh", priced: true, createdDaysAgo: 3,
        penerima: { name: "Dewi Susilo", address: "Jl. Kenanga No. 9, Banda Aceh", contact: "0813-4444-1234" },
        details: [{ description: "Kipas angin", quantity: 1, weightKg: 3, l: 30, w: 25, h: 12 }],
      },
      {
        // B2B DELIVERED — sudah masuk ke invoice INV-2026-000001.
        masterCode: "MKT-000005", customer: "PT Maju Bersama", status: "DELIVERED",
        origin: "Medan", destination: "Banda Aceh", priced: true, createdDaysAgo: 6,
        penerima: { name: "Bagian Gudang PT Maju Bersama", address: "Jl. Gatot Subroto No. 21, Medan", contact: "0812-3456-0002" },
        details: [{ description: "Paket promosi", quantity: 8, weightKg: 5, l: 30, w: 20, h: 15 }],
      },
      {
        // CREATED + unpriced — walk-in candidate: customer hands the package
        // straight to Admin Gudang (no scan needed).
        // Penerima (Adik Indah) berbeda dari pengirim (Sari Indah).
        masterCode: "MKT-000006", customer: "Sari Indah", status: "CREATED",
        origin: "Medan", destination: "Banda Aceh", priced: false, createdDaysAgo: 0,
        penerima: { name: "Adik Indah", address: "Jl. Anggrek No. 3, Banda Aceh", contact: "0813-3300-0006" },
        details: [{ description: "Kosmetik", quantity: 2, weightKg: 1, l: 20, w: 15, h: 10 }],
      },
    ];
    const priceByCode: Record<string, number> = {};
    const shipmentIdByCode: Record<string, number> = {};
    const detailRowsByCode: Record<string, { id: number; detailCode: string }[]> = {};
    const packageSequenceByDate: Record<string, number> = {};

    for (const s of shipmentDefs) {
      const createdAt = daysAgo(s.createdDaysAgo);
      const cust = customers[s.customer];
      const tariff = tariffByRoute[`${s.origin}|${s.destination}|${cust.type}`] ?? null;
      // All demo shipments are created by the Marketing partner budi (§8 —
      // attribution drives the B2B commission on the demo invoice).
      const createdByPartnerId = partnersByUsername["budi"] ?? null;
      const shipment = await db.masterShipment.create({
        data: {
          masterCode: s.masterCode, resi: s.masterCode,
          customerId: cust.id,
          tariffId: tariff?.id ?? null,
          status: s.status,
          origin: s.origin, destination: s.destination,
          originWarehouseId: gudang["Medan"],
          destinationWarehouseId: gudang[s.destination],
          arrivedWarehouseId: ["RECEIVED_AT_GUDANG", "ARRIVED_AT_GUDANG"].includes(s.status) ? gudang["Medan"] : null,
          penerimaName: s.penerima.name,
          penerimaAddress: s.penerima.address,
          penerimaContact: s.penerima.contact,
          createdByPartnerId,
          createdAt, updatedAt: createdAt,
        },
      });
      shipmentIdByCode[s.masterCode] = shipment.id;
      detailRowsByCode[s.masterCode] = [];
      // quantity N expands into N package rows — each with a unique detailCode (QR label)
      const pricedRows: { lengthCm: number | null; widthCm: number | null; heightCm: number | null; actualWeightKg: number }[] = [];
      const date = [createdAt.getFullYear(), createdAt.getMonth() + 1, createdAt.getDate()]
        .map((part) => String(part).padStart(2, "0"))
        .join("");
      const time = [createdAt.getHours(), createdAt.getMinutes(), createdAt.getSeconds()]
        .map((part) => String(part).padStart(2, "0"))
        .join("");
      packageSequenceByDate[date] ??= 0;
      for (const d of s.details) {
        for (let i = 0; i < d.quantity; i++) {
          packageSequenceByDate[date] += 1;
          const row = await db.detailShipment.create({
            data: {
              detailCode: `DTL-${date}-${time}-${String(packageSequenceByDate[date]).padStart(3, "0")}`,
              masterId: shipment.id, description: d.description,
              actualWeightKg: d.weightKg, lengthCm: d.l, widthCm: d.w, heightCm: d.h,
              createdAt,
            },
          });
          pricedRows.push({ lengthCm: row.lengthCm, widthCm: row.widthCm, heightCm: row.heightCm, actualWeightKg: row.actualWeightKg });
          detailRowsByCode[s.masterCode].push({ id: row.id, detailCode: row.detailCode });
        }
      }
      // Pricing snapshot computed with the shared engine (L×W×H/1.000.000 × multiplier)
      if (s.priced && tariff) {
        const r = computePricing(pricedRows, tariff);
        // Revise.md §6 demo — MKT-000001 carries a Marketing-funded B2C
        // discount (amount input; percentage auto-derived by the system).
        const discount = s.masterCode === "MKT-000001" ? 5000 : 0;
        await db.masterShipment.update({
          where: { id: shipment.id },
          data: {
            chargeableWeightKg: r.chargeableKg, ratePerKg: tariff.ratePerKg, priceAmount: r.price, pricedAt: createdAt,
            ...(discount > 0
              ? {
                  discountAmount: discount,
                  discountPercentage: Math.round((discount / r.price) * 10000) / 100,
                  finalPriceAmount: Math.round((r.price - discount) * 100) / 100,
                }
              : {}),
          },
        });
        priceByCode[s.masterCode] = r.price;
      }
      const events: { event: string; description: string; daysAgo: number; actor?: string }[] = [
        { event: "CREATED", description: `Shipment ${s.masterCode} dibuat`, daysAgo: s.createdDaysAgo, actor: "budi" },
      ];
      if (["PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        events.push({ event: "READY_FOR_PICKUP", description: "Menunggu penjemputan kurir", daysAgo: s.createdDaysAgo - 0.2, actor: "budi" });
        events.push({ event: "PICKED_UP", description: "Picked-up by Dewi Lestari", daysAgo: s.createdDaysAgo - 0.4, actor: "dewi" });
      }
      if (["RECEIVED_AT_GUDANG", "IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        events.push({ event: "RECEIVED_AT_GUDANG", description: "Diterima di Gudang Medan", daysAgo: s.createdDaysAgo - 0.6, actor: "agus" });
      }
      if (["IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        events.push({ event: "IN_TRANSPORT", description: "Berangkat via transport TRP-2026-000001", daysAgo: s.createdDaysAgo - 0.8, actor: "joko" });
      }
      if (s.status === "DELIVERED") {
        events.push({ event: "ARRIVED_AT_GUDANG", description: "Tiba di Gudang Banda Aceh", daysAgo: s.createdDaysAgo - 1, actor: "agus" });
        events.push({ event: "DELIVERED", description: "Terkirim ke penerima", daysAgo: s.createdDaysAgo - 1.2, actor: "dewi" });
      }
      for (const ev of events) {
        await db.trackingEvent.create({
          data: {
            masterId: shipment.id, event: ev.event, description: ev.description,
            actorId: ev.actor ? usersByHandle[ev.actor].id : null,
            occurredAt: daysAgo(ev.daysAgo),
          },
        });
      }

      // Pickup for statuses after CREATED (+ per-package scans so Riwayat Scan
      // shows SCANNED / TYPED methods on completed tasks).
      // Revision Part A — pickup lifecycle: PICKED_UP while the package is in
      // the kurir's custody; COMPLETED only once the package has arrived and
      // been received at the gudang (RECEIVED_AT_GUDANG and beyond).
      if (["PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        const arrivedAtGudang = s.status !== "PICKED_UP";
        const pickup = await db.pickup.create({
          data: {
            pickupCode: `PICK-2026-${s.masterCode.slice(-6)}`, masterId: shipment.id,
            kurirId: usersByHandle.dewi.employeeId,
            status: arrivedAtGudang ? "COMPLETED" : "PICKED_UP",
            createdAt,
            completedAt: arrivedAtGudang ? daysAgo(Math.max(0, s.createdDaysAgo - 0.4)) : null,
            updatedAt: createdAt,
          },
        });
        // B2B shipments (e.g. MKT-000002 PT Maju Bersama): record a single
        // master-level scan instead of per-package scans — demonstrates the
        // new B2B Master Resi scan mode in the Riwayat Scan view.
        const isB2B = cust.type === "b2b";
        if (isB2B) {
          await db.handoverScan.create({
            data: {
              pickupId: pickup.id, context: "pickup", scanLevel: "master", detailId: null,
              payload: shipment.masterCode, result: "ok", method: "SCANNED",
              scannedById: usersByHandle.dewi.id, scannedAt: daysAgo(Math.max(0, s.createdDaysAgo - 0.4)),
            },
          });
        } else {
          for (const [i, d] of detailRowsByCode[s.masterCode].entries()) {
            await db.handoverScan.create({
              data: {
                pickupId: pickup.id, context: "pickup", scanLevel: "detail", detailId: d.id, payload: d.detailCode,
                result: "ok", method: i % 4 === 3 ? "TYPED" : "SCANNED", // mostly scanner, some typed
                scannedById: usersByHandle.dewi.id, scannedAt: daysAgo(Math.max(0, s.createdDaysAgo - 0.4)),
              },
            });
          }
        }
      }
      // Gudang arrival scans for RECEIVED_AT_GUDANG shipments (B2B uses the
      // master-scan shortcut; B2C keeps per-package scans).
      if (["RECEIVED_AT_GUDANG"].includes(s.status)) {
        const isB2B = cust.type === "b2b";
        if (isB2B) {
          await db.handoverScan.create({
            data: {
              masterId: shipment.id, context: "gudang_arrival", scanLevel: "master", detailId: null,
              payload: shipment.masterCode, result: "ok", method: "SCANNED",
              scannedById: usersByHandle.agus.id, scannedAt: daysAgo(Math.max(0, s.createdDaysAgo - 0.6)),
            },
          });
        } else {
          for (const [i, d] of detailRowsByCode[s.masterCode].entries()) {
            await db.handoverScan.create({
              data: {
                masterId: shipment.id, context: "gudang_arrival", scanLevel: "detail", detailId: d.id, payload: d.detailCode,
                result: "ok", method: i === detailRowsByCode[s.masterCode].length - 1 ? "TYPED" : "SCANNED",
                scannedById: usersByHandle.agus.id, scannedAt: daysAgo(Math.max(0, s.createdDaysAgo - 0.6)),
              },
            });
          }
        }
      }
      // Payment rows untuk B2C dan B2B dihapus dari seed: aturan baru — B2C
      // ditanggung Marketing (tidak ada DP / status pembayaran), B2B ditagih
      // via invoice + settlement (lihat blok Invoice di bawah).
    }

    // Transport carrying MKT-000004
    const mkt4 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000004" } });
    const transport = await db.transport.create({
      data: {
        transportCode: "TRP-2026-000001", routeId: routes["MDN - BNA Aceh Timur"],
        vehicleId: vehicles["BK 9455 KTB"],
        driverId: usersByHandle.joko.employeeId, kenekId: usersByHandle.dewi.employeeId,
        status: "DEPARTED", departedAt: daysAgo(1), createdAt: daysAgo(1.5),
      },
    });
    await db.transportShipment.create({ data: { transportId: transport.id, shipmentId: mkt4.id } });

    // Open pickup task assigned to kurir Rizky (MKT-000001 — READY_FOR_PICKUP).
    // Demo path for the QR handover scan flow: login as rizky, scan every
    // detail barang QR, then confirm → tracking shows "Picked-up by Rizky Hidayat".
    const mkt1 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000001" } });
    await db.pickup.create({
      data: {
        pickupCode: "PICK-2026-000001", masterId: mkt1.id,
        kurirId: usersByHandle.rizky.employeeId,
        status: "ASSIGNED", notes: "Ambil di reception kantor customer",
        createdAt: daysAgo(0.2), updatedAt: daysAgo(0.2),
      },
    });

    // Open delivery task assigned to kurir Rizky (MKT-000003 — RECEIVED_AT_GUDANG).
    // Demo path for delivery QR scan: scan all packages, confirm with POD.
    const mkt3 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000003" } });
    await db.delivery.create({
      data: {
        deliveryCode: "DLV-2026-000002", masterId: mkt3.id,
        kurirId: usersByHandle.rizky.employeeId,
        status: "ASSIGNED", notes: "Hubungi bagian gudang CV Sinar Jaya",
        createdAt: daysAgo(0.3), updatedAt: daysAgo(0.3),
      },
    });

    // Completed delivery for MKT-000005
    const mkt5 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000005" } });
    const delivery5 = await db.delivery.create({
      data: {
        deliveryCode: "DLV-2026-000001", masterId: mkt5.id, kurirId: usersByHandle.dewi.employeeId,
        status: "COMPLETED", proofOfDelivery: "Diterima oleh bagian gudang PT Maju Bersama",
        completedAt: daysAgo(2), createdAt: daysAgo(2.5),
      },
    });
    // Delivery scans (SCANNED method) for the completed delivery — Riwayat Scan demo
    for (const d of detailRowsByCode["MKT-000005"] ?? []) {
      await db.handoverScan.create({
        data: {
          deliveryId: delivery5.id, context: "delivery", scanLevel: "detail", detailId: d.id, payload: d.detailCode,
          result: "ok", method: "SCANNED", scannedById: usersByHandle.dewi.id, scannedAt: daysAgo(2),
        },
      });
    }

    // Invoice for PT Maju — lines linked to the B2B shipments (§7.1) so the
    // Marketing commission (§8) attaches to the invoice.
    const maju = await db.customer.findUniqueOrThrow({ where: { code: "CUS-000002" } });
    const invoice = await db.invoice.create({
      data: {
        invoiceNumber: "INV-2026-000001", customerId: maju.id, status: "SENT",
        issueDate: daysAgo(3), dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        notes: "Tagihan pengiriman periode ini — Medan → Banda Aceh", createdAt: daysAgo(3),
      },
    });
    const mkt2 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000002" } });
    const mkt5Row = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000005" } });
    await db.invoiceLine.createMany({
      data: [
        { invoiceId: invoice.id, description: "MKT-000002 — pengiriman Medan → Banda Aceh (B2B, 25 kg × Rp8.000)", quantity: 1, unitPrice: priceByCode["MKT-000002"] ?? 200000, shipmentId: mkt2.id },
        { invoiceId: invoice.id, description: "MKT-000005 — pengiriman Medan → Banda Aceh (B2B, 40 kg × Rp8.000)", quantity: 1, unitPrice: priceByCode["MKT-000005"] ?? 320000, shipmentId: mkt5Row.id },
      ],
    });
    // Partial settlement — invoice PARTIALLY_SETTLED, commission stays
    // PENDING (§8.1: partial payment must NOT credit the wallet).
    await db.invoiceSettlement.create({
      data: { invoiceId: invoice.id, amount: 100000, method: "TRANSFER", reference: "TRF-MAJU-001", recordedById: usersByHandle.siti.id, settledAt: daysAgo(1.5) },
    });
    const invoiceTotal = (priceByCode["MKT-000002"] ?? 200000) + (priceByCode["MKT-000005"] ?? 320000);
    await db.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIALLY_SETTLED" } });

    // PENDING Marketing commission on the invoice (§8) — 20% for budi.
    const budiPartnerId = partnersByUsername["budi"]!;
    await db.marketingCommission.create({
      data: {
        commissionCode: "COM-000001", partnerId: budiPartnerId, invoiceId: invoice.id,
        invoiceAmount: invoiceTotal, companyPercent: 80, partnerPercent: 20,
        commissionAmount: Math.round(invoiceTotal * 0.2 * 100) / 100,
        status: "PENDING", createdAt: daysAgo(3),
      },
    });

    // ----- Invoice for CV Sinar Jaya (MKT-000003 — B2B) ------------------
    // Aturan baru: B2B shipment wajib masuk invoice sebelum bisa di-pickup.
    // MKT-000003 sudah PICKED_UP / RECEIVED_AT_GUDANG di seed awal (status
    // ditulis langsung, lewati gate pickup), tetapi tetap perlu invoice agar
    // konsisten dengan aturan baru dan resi-nya menampilkan No. Invoice.
    const sinar = await db.customer.findUniqueOrThrow({ where: { code: "CUS-000003" } });
    const invoice3 = await db.invoice.create({
      data: {
        invoiceNumber: "INV-2026-000003", customerId: sinar.id, status: "SENT",
        issueDate: daysAgo(4), dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        notes: "Tagihan pengiriman Medan → Lhokseumawe (MKT-000003)", createdAt: daysAgo(4),
      },
    });
    const mkt3Row = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000003" } });
    await db.invoiceLine.create({
      data: {
        invoiceId: invoice3.id,
        description: "MKT-000003 — pengiriman Medan → Lhokseumawe (B2B, mesin + spare part)",
        quantity: 1,
        unitPrice: priceByCode["MKT-000003"] ?? 330000,
        shipmentId: mkt3Row.id,
      },
    });

    // ----- Revise.md demo: completed transport with settlement (§14/§15) ---
    // TRP-2026-000002: ARRIVED MDN→BNA with hendra's Engkel Box carrying the
    // delivered MKT-000005; settled at an explicit transport value of
    // Rp500.000 → hendra 20% = Rp100.000 credited as TRANSPORT_PROFIT_SHARE.
    const settledTransport = await db.transport.create({
      data: {
        transportCode: "TRP-2026-000002", routeId: routes["MDN - BNA Aceh Timur"],
        vehicleId: vehicles["BK 9102 KTA"],
        driverId: usersByHandle.joko.employeeId, kenekId: usersByHandle.andi.employeeId,
        status: "ARRIVED",
        origin: "Medan", destination: "Banda Aceh",
        departedAt: daysAgo(5), arrivedAt: daysAgo(4.5), createdAt: daysAgo(5.5),
      },
    });
    await db.transportShipment.create({ data: { transportId: settledTransport.id, shipmentId: mkt5Row.id } });
    const hendraPartnerId = partnersByUsername["hendra"]!;
    const hendraWallet = await db.wallet.upsert({ where: { partnerId: hendraPartnerId }, create: { partnerId: hendraPartnerId }, update: {} });
    const transportValue = 500000;
    const ownerAmount = Math.round(transportValue * 0.2 * 100) / 100;
    const profitLedger = await db.walletTransaction.create({
      data: {
        walletId: hendraWallet.id, type: "TRANSPORT_PROFIT_SHARE", amount: ownerAmount, direction: "CREDIT",
        balanceBefore: 0, balanceAfter: ownerAmount,
        referenceType: "transport_settlement", referenceId: settledTransport.id,
        businessRef: `TST-TRP-${settledTransport.id}`, status: "COMPLETED",
        description: `Profit share transport TRP-2026-000002 (20% dari Rp500.000)`,
        createdById: usersByHandle.owner.id, createdAt: daysAgo(4.5),
      },
    });
    await db.wallet.update({ where: { id: hendraWallet.id }, data: { balance: ownerAmount } });
    await db.transportSettlement.create({
      data: {
        settlementCode: "TST-000001", transportId: settledTransport.id,
        vehicleId: vehicles["BK 9102 KTA"], ownerId: hendraPartnerId,
        transportValue, companyPercent: 80, ownerPercent: 20,
        companyAmount: transportValue - ownerAmount, ownerAmount,
        status: "FINALIZED", finalizedById: usersByHandle.owner.id, finalizedAt: daysAgo(4.5),
        walletTransactionId: profitLedger.id, createdAt: daysAgo(4.5),
      },
    });

    // ----- Repair demo (simplified §19–§22 flow) ---------------------------
    // No approval workflow: an authorized company user creates a repair and
    // it is VERIFIED immediately with an atomic wallet deduction. Two demo
    // records exercise BOTH log views:
    //   REP-000001 (kept)  — created (Rp20.000) then edited (→ Rp25.000,
    //                        wallet auto-adjusted +Rp5.000)
    //   REP-000002 (gone)  — created (Rp40.000) then DELETED (full refund);
    //                        the row is gone from the list but its CREATED +
    //                        DELETED log entries survive for the owner.
    const rep1 = await db.vehicleRepair.create({
      data: {
        repairCode: "REP-000001", vehicleId: vehicles["BK 9102 KTA"], ownerId: hendraPartnerId,
        description: "Ganti oli + servis rem depan", amount: 25000, repairDate: daysAgo(2),
        workshopVendor: "Bengkel Amanah Jaya Medan",
        proofUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y4ZjlmYSIvPjx0ZXh0IHg9IjEyIiB5PSI3MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTMiIGZpbGw9IiM2NDc0OGIiPk5vdGEgUmVwYWlyIC0gQnVrdGkgUmVzbWk8L3RleHQ+PC9zdmc+",
        notes: "Bengkel menyerahkan nota asli ke kantor.",
        status: "VERIFIED", createdById: usersByHandle.siti.id,
        deductedAmount: 25000, verifiedAt: daysAgo(2),
        createdAt: daysAgo(2),
      },
    });
    // REP-000001 deduction ledger (Rp20.000 at creation) + edit adjustment (+Rp5.000)
    await db.walletTransaction.create({
      data: {
        walletId: hendraWallet.id, type: "REPAIR_DEDUCTION", amount: 20000, direction: "DEBIT",
        balanceBefore: 100000, balanceAfter: 80000,
        referenceType: "repair", referenceId: rep1.id, businessRef: `REP-${rep1.id}`, status: "COMPLETED",
        description: `Deduction repair REP-000001 — Ganti oli + servis rem depan`,
        createdById: usersByHandle.siti.id, createdAt: daysAgo(2),
      },
    });
    await db.walletTransaction.create({
      data: {
        walletId: hendraWallet.id, type: "REPAIR_DEDUCTION", amount: 5000, direction: "DEBIT",
        balanceBefore: 80000, balanceAfter: 75000,
        referenceType: "repair", referenceId: rep1.id, businessRef: `REP-ADJ-${rep1.id}-seed`, status: "COMPLETED",
        description: `Tambahan deduction repair REP-000001 (biaya diubah Rp20.000 → Rp25.000)`,
        createdById: usersByHandle.siti.id, createdAt: daysAgo(1.5),
      },
    });
    await db.repairActionLog.create({
      data: {
        repairId: rep1.id, repairCode: "REP-000001", ownerId: hendraPartnerId, vehicleNumber: "BK 9102 KTA",
        action: "CREATED",
        detail: "Repair REP-000001 dibuat dan langsung terverifikasi — deduction Rp20.000 dari wallet Vehicle Owner.",
        amount: 20000, actorId: usersByHandle.siti.id, actorName: "Siti Rahma", createdAt: daysAgo(2),
      },
    });
    await db.repairActionLog.create({
      data: {
        repairId: rep1.id, repairCode: "REP-000001", ownerId: hendraPartnerId, vehicleNumber: "BK 9102 KTA",
        action: "UPDATED",
        detail: "Repair REP-000001 diubah oleh Siti Rahma — field: amount · wallet disesuaikan +Rp5.000.",
        changes: JSON.stringify({ amount: { before: 20000, after: 25000 } }),
        amount: 25000, actorId: usersByHandle.siti.id, actorName: "Siti Rahma", createdAt: daysAgo(1.5),
      },
    });

    // REP-000002 — created then deleted (full refund). Row is deleted, logs survive.
    const rep2 = await db.vehicleRepair.create({
      data: {
        repairCode: "REP-000002", vehicleId: vehicles["BK 9455 KTB"], ownerId: hendraPartnerId,
        description: "Servis kopling", amount: 40000, repairDate: daysAgo(1.2),
        workshopVendor: "Bengkel Jaya Motor Medan",
        proofUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y4ZjlmYSIvPjx0ZXh0IHg9IjEyIiB5PSI3MCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTMiIGZpbGw9IiM2NDc0OGIiPk5vdGEgUmVwYWlyIC0gS29wbGluZzwvdGV4dD48L3N2Zz4=",
        notes: "Entry salah kendaraan — record ini sengaja dihapus sebagai demo log.",
        status: "VERIFIED", createdById: usersByHandle.owner.id,
        deductedAmount: 0, verifiedAt: daysAgo(1),
        createdAt: daysAgo(1),
      },
    });
    await db.walletTransaction.create({
      data: {
        walletId: hendraWallet.id, type: "REPAIR_DEDUCTION", amount: 40000, direction: "DEBIT",
        balanceBefore: 75000, balanceAfter: 35000,
        referenceType: "repair", referenceId: rep2.id, businessRef: `REP-${rep2.id}`, status: "COMPLETED",
        description: `Deduction repair REP-000002 — Servis kopling`,
        createdById: usersByHandle.owner.id, createdAt: daysAgo(1),
      },
    });
    await db.walletTransaction.create({
      data: {
        walletId: hendraWallet.id, type: "REPAIR_DEDUCTION", amount: 40000, direction: "CREDIT",
        balanceBefore: 35000, balanceAfter: 75000,
        referenceType: "repair", referenceId: rep2.id, businessRef: `REP-DEL-${rep2.id}-seed`, status: "COMPLETED",
        description: `Pengembalian penuh deduction repair REP-000002 (Rp40.000) — record dihapus.`,
        createdById: usersByHandle.owner.id, createdAt: daysAgo(0.8),
      },
    });
    await db.repairActionLog.create({
      data: {
        repairId: rep2.id, repairCode: "REP-000002", ownerId: hendraPartnerId, vehicleNumber: "BK 9455 KTB",
        action: "CREATED",
        detail: "Repair REP-000002 dibuat dan langsung terverifikasi — deduction Rp40.000 dari wallet Vehicle Owner.",
        amount: 40000, actorId: usersByHandle.owner.id, actorName: "Owner Utama", createdAt: daysAgo(1),
      },
    });
    await db.repairActionLog.create({
      data: {
        repairId: rep2.id, repairCode: "REP-000002", ownerId: hendraPartnerId, vehicleNumber: "BK 9455 KTB",
        action: "DELETED",
        detail: "Repair REP-000002 (Servis kopling — Rp40.000) dihapus oleh Owner Utama · deduction Rp40.000 dikembalikan ke wallet.",
        amount: 40000, actorId: usersByHandle.owner.id, actorName: "Owner Utama", createdAt: daysAgo(0.8),
      },
    });
    await db.vehicleRepair.delete({ where: { id: rep2.id } });
    // Net wallet effect of both repairs: -25.000 (REP-000001) — hendra's
    // balance lands at Rp75.000 before the withdrawal reservation below.
    await db.wallet.update({ where: { id: hendraWallet.id }, data: { balance: 75000 } });

    // ----- Revise.md demo: pending withdrawal with reservation (§26/§27) ---
    // hendra requests Rp30.000 — reserved out of his Rp75.000 balance
    // (available becomes Rp45.000) until approved+completed or rejected.
    await db.withdrawalRequest.create({
      data: {
        requestCode: "WDR-000001", partnerId: hendraPartnerId, amount: 30000, status: "PENDING",
        bankName: "Bank Mandiri", bankAccountName: "Hendra Gunawan", bankAccountNumber: "9876543210",
        partnerNote: "Untuk biaya operasional kendaraan", requestedById: usersByHandle.hendra.id,
        createdAt: daysAgo(0.5),
      },
    });

    // ----- Revise.md demo: Marketing wallet history (§10) ------------------
    // budi's verified top-up Rp200.000 (with ledger) + one PENDING_VERIFICATION
    // top-up with proof attached, waiting for Owner to verify.
    const budiWallet = await db.wallet.upsert({ where: { partnerId: budiPartnerId }, create: { partnerId: budiPartnerId }, update: {} });
    const topUpAmount = 200000;
    const verifiedTopUp = await db.topUpRequest.create({
      data: {
        requestCode: "TOP-000001", partnerId: budiPartnerId, amount: topUpAmount, status: "VERIFIED",
        partnerNote: "Transfer via BCA mobile 08:30", requestedById: usersByHandle.siti.id,
        submittedForVerificationAt: daysAgo(6), verifiedById: usersByHandle.owner.id, verifiedAt: daysAgo(5.8),
        createdAt: daysAgo(6.2),
      },
    });
    await db.walletTransaction.create({
      data: {
        walletId: budiWallet.id, type: "TOPUP", amount: topUpAmount, direction: "CREDIT",
        balanceBefore: 0, balanceAfter: topUpAmount,
        referenceType: "topup", referenceId: verifiedTopUp.id,
        businessRef: `TOP-${verifiedTopUp.id}`, status: "COMPLETED",
        description: "Top up TOP-000001 terverifikasi",
        createdById: usersByHandle.owner.id, createdAt: daysAgo(5.8),
      },
    });
    await db.wallet.update({ where: { id: budiWallet.id }, data: { balance: topUpAmount } });
    // second top-up stuck mid-workflow: Admin Kantor created it with the
    // transfer proof attached, waiting for Owner verification
    await db.topUpRequest.create({
      data: {
        requestCode: "TOP-000002", partnerId: budiPartnerId, amount: 150000, status: "PENDING_VERIFICATION",
        partnerNote: "Transfer Rp150.000 via BCA — jam 07:15 pagi.",
        proofUrl: DEMO_PROOF_DATA_URL,
        requestedById: usersByHandle.siti.id,
        submittedForVerificationAt: daysAgo(0.3),
        createdAt: daysAgo(0.4),
      },
    });
  }

  // ----- Seed audit trail -----------------------------------------------------
  const auditCount = await db.auditLog.count();
  if (auditCount === 0) {
    const entries = [
      { action: "login", entityType: "auth", entityLabel: "owner", actor: "owner" },
      { action: "created", entityType: "customer", entityLabel: "PT Maju Bersama", actor: "budi" },
      { action: "created", entityType: "shipment", entityLabel: "MKT-000001", actor: "budi" },
      { action: "status_change", entityType: "shipment", entityLabel: "MKT-000002 → PICKED_UP", actor: "dewi" },
      { action: "created", entityType: "pickup", entityLabel: "PICK-2026-000002", actor: "agus" },
      { action: "created", entityType: "transport", entityLabel: "TRP-2026-000001", actor: "agus" },
      { action: "status_change", entityType: "transport", entityLabel: "TRP-2026-000001 → DEPARTED", actor: "joko" },
      { action: "created", entityType: "invoice", entityLabel: "INV-2026-000001", actor: "siti" },
      { action: "created", entityType: "invoice", entityLabel: "INV-2026-000003 (CV Sinar Jaya — MKT-000003)", actor: "siti" },
      { action: "created", entityType: "warehouse", entityLabel: "Gudang Banda Aceh", actor: "agus" },
      { action: "updated", entityType: "tariff", entityLabel: "Medan → Banda Aceh (b2c)", actor: "siti" },
      { action: "login", entityType: "auth", entityLabel: "siti", actor: "siti" },
      { action: "login", entityType: "auth", entityLabel: "agus", actor: "agus" },
    ];
    for (const [i, e] of entries.entries()) {
      await db.auditLog.create({
        data: {
          action: e.action, entityType: e.entityType, entityLabel: e.entityLabel,
          actorId: usersByHandle[e.actor]?.id ?? null,
          createdAt: daysAgo(2 - i * 0.1),
        },
      });
    }
  }

  // fresh seed finished — run the same idempotent backfill (customer ↔
  // marketing linkage + the transport-arrival demo shipment + B2B Master Resi demo)
  await seedBackfill();
}
