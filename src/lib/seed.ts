import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureRbac } from "@/lib/rbac";
import { computePricing } from "@/lib/pricing";

let seedPromise: Promise<void> | null = null;

/**
 * Idempotent demo seeding. Runs automatically on the first API request
 * (mirrors the docker "migrate + seed on boot" behaviour) and is a no-op
 * once the demo dataset exists.
 */
export function ensureSeed(): Promise<void> {
  if (!seedPromise) seedPromise = runSeed().catch((e) => { seedPromise = null; throw e; });
  return seedPromise;
}

async function runSeed(): Promise<void> {
  await ensureRbac();

  // ----- Gudang (no gateway/type distinction) -------------------------------
  // customerSupportContact is printed on the Shipment Resi & Detail Resi.
  const gudangDefs = [
    { code: "WH-000001", name: "Gudang Jakarta Pusat", city: "Jakarta Pusat", address: "Jl. Gunung Sahari No. 45", latitude: -6.1105, longitude: 106.8814, customerSupportContact: "0811-1000-001" },
    { code: "WH-000002", name: "Gudang Bandung", city: "Bandung", address: "Jl. Soekarno Hatta No. 210", latitude: -6.9175, longitude: 107.6191, customerSupportContact: "0822-2000-002" },
    { code: "WH-000003", name: "Gudang Surabaya", city: "Surabaya", address: "Jl. Ahmad Yani No. 88", latitude: -7.2575, longitude: 112.7521, customerSupportContact: "0833-3000-003" },
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
    await db.employee.updateMany({ where: { id: { in: unbound.map((e) => e.id) } }, data: { warehouseId: gudang["Jakarta Pusat"] } });
  }

  const ownerExists = await db.user.findFirst({ where: { username: "owner" } });
  const shipmentCount = await db.masterShipment.count();
  if (ownerExists && shipmentCount >= 6) return; // already seeded

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  // ----- Employees + users -------------------------------------------------
  // EVERY karyawan is stationed at one gudang (warehouseId) — operational data
  // (shipments, pickups, deliveries, transports) is separated by that gudang.
  // ratna (Admin Gudang Bandung) demonstrates the data isolation: she only
  // sees Bandung-side data, never Jakarta's.
  const staffPassword = hashPassword("Demo#Pass2026");
  const ownerPassword = hashPassword("ChangeMeOwner#2026");

  const staff: { username: string; name: string; position: string; role: string; employeeNumber: string; warehouseId: string }[] = [
    { username: "siti", name: "Siti Rahma", position: "Admin Kantor", role: "admin-kantor", employeeNumber: "EMP-000002", warehouseId: "Jakarta Pusat" },
    { username: "budi", name: "Budi Santoso", position: "Marketing", role: "marketing", employeeNumber: "EMP-000003", warehouseId: "Jakarta Pusat" },
    { username: "agus", name: "Agus Pratama", position: "Admin Gudang", role: "admin-gudang", employeeNumber: "EMP-000004", warehouseId: "Jakarta Pusat" },
    { username: "dewi", name: "Dewi Lestari", position: "Kurir", role: "kurir", employeeNumber: "EMP-000005", warehouseId: "Jakarta Pusat" },
    { username: "rizky", name: "Rizky Hidayat", position: "Kurir", role: "kurir", employeeNumber: "EMP-000006", warehouseId: "Jakarta Pusat" },
    { username: "joko", name: "Joko Widodo", position: "Driver", role: "driver", employeeNumber: "EMP-000007", warehouseId: "Jakarta Pusat" },
    { username: "andi", name: "Andi Wijaya", position: "Kenek", role: "kenek", employeeNumber: "EMP-000008", warehouseId: "Jakarta Pusat" },
    { username: "wawan", name: "Wawan Setiawan", position: "Staff Gudang", role: "staff-gudang", employeeNumber: "EMP-000009", warehouseId: "Jakarta Pusat" },
    { username: "ratna", name: "Ratna Kurnia", position: "Admin Gudang", role: "admin-gudang", employeeNumber: "EMP-000010", warehouseId: "Bandung" },
  ];

  const ownerEmployee = await db.employee.upsert({
    where: { employeeNumber: "EMP-000001" },
    create: { employeeNumber: "EMP-000001", name: "Owner Utama", position: "Owner", phone: "081100000001" },
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
        employeeNumber: s.employeeNumber, name: s.name, position: s.position, phone: `08110000${s.employeeNumber.slice(-4)}`,
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

  // ----- Vehicles -----------------------------------------------------------
  const vehicleDefs = [
    { vehicleNumber: "B 9102 KTA", name: "Engkel Box", status: "ACTIVE", maxWeightKg: 1200, maxVolumeM3: 6 },
    { vehicleNumber: "B 9455 KTB", name: "CDD 6 Ban", status: "ACTIVE", maxWeightKg: 3500, maxVolumeM3: 14 },
    { vehicleNumber: "L 7788 KTC", name: "Fuso Besar", status: "MAINTENANCE", maxWeightKg: 8000, maxVolumeM3: 28, notes: "Perawatan berkala, kembali aktif minggu depan." },
  ];
  const vehicles: Record<string, number> = {};
  for (const v of vehicleDefs) {
    const vehicle = await db.vehicle.upsert({ where: { vehicleNumber: v.vehicleNumber }, create: v, update: {} });
    vehicles[v.vehicleNumber] = vehicle.id;
  }
  // default crew for CDD: driver Joko + kenek Andi
  await db.vehicleAssignment.upsert({
    where: {
      vehicleId_driverId_kenekId_validFrom: {
        vehicleId: vehicles["B 9455 KTB"],
        driverId: usersByHandle.joko.employeeId ?? 0,
        kenekId: usersByHandle.andi.employeeId ?? 0,
        validFrom: daysAgo(30),
      },
    },
    create: {
      vehicleId: vehicles["B 9455 KTB"],
      driverId: usersByHandle.joko.employeeId,
      kenekId: usersByHandle.andi.employeeId,
      validFrom: daysAgo(30),
    },
    update: {},
  }).catch(() => undefined);

  // ----- Routes + checkpoints (≥ 3 per route) --------------------------------
  const routeDefs = [
    {
      name: "JKT - BDG Tol Cipularang", origin: "Jakarta Pusat", destination: "Bandung",
      checkpoints: [
        { name: "Gudang Jakarta Pusat (Start)", latitude: -6.1105, longitude: 106.8814, radiusMeters: 300 },
        { name: "Rest Area KM 57 Cipularang", latitude: -6.4461, longitude: 107.4394, radiusMeters: 250 },
        { name: "Gudang Bandung (End)", latitude: -6.9175, longitude: 107.6191, radiusMeters: 300 },
      ],
    },
    {
      name: "JKT - SBY Pantura", origin: "Jakarta Pusat", destination: "Surabaya",
      checkpoints: [
        { name: "Gudang Jakarta Pusat (Start)", latitude: -6.1105, longitude: 106.8814, radiusMeters: 300 },
        { name: "Rest Area KM 207 Brebes", latitude: -6.8721, longitude: 109.0354, radiusMeters: 250 },
        { name: "Gudang Surabaya (End)", latitude: -7.2575, longitude: 112.7521, radiusMeters: 300 },
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
  const tariffDefs = [
    { origin: "Jakarta Pusat", destination: "Bandung", customerType: "b2b", ratePerKg: 4500, volumetricMultiplier: 250 },
    { origin: "Jakarta Pusat", destination: "Bandung", customerType: "b2c", ratePerKg: 5500, volumetricMultiplier: 250 },
    { origin: "Jakarta Pusat", destination: "Surabaya", customerType: "b2b", ratePerKg: 7500, volumetricMultiplier: 300 },
    { origin: "Jakarta Pusat", destination: "Surabaya", customerType: "b2c", ratePerKg: 8500, volumetricMultiplier: 300 },
  ];
  const tariffByRoute: Record<string, { id: number; ratePerKg: number; minChargeableKg: number; volumetricMultiplier: number; roundingMode: string; roundingUnitKg: number }> = {};
  for (const t of tariffDefs) {
    const existing = await db.tariff.findFirst({ where: { origin: t.origin, destination: t.destination, customerType: t.customerType } });
    const tariff = existing ?? (await db.tariff.create({ data: { ...t, minChargeableKg: 1, roundingMode: "UP", roundingUnitKg: 0.5, effectiveFrom: daysAgo(90) } }));
    tariffByRoute[`${t.origin}|${t.destination}|${t.customerType}`] = tariff;
  }

  // ----- Customers -------------------------------------------------------------
  const customerDefs = [
    { code: "CUS-000001", type: "b2c", name: "Rina Amelia", phone: "081234000001", address: "Jl. Melati No. 12, Bandung" },
    { code: "CUS-000002", type: "b2b", name: "PT Maju Bersama", companyName: "PT Maju Bersama", phone: "081234000002", address: "Jl. Sudirman Kav. 21, Jakarta" },
    { code: "CUS-000003", type: "b2b", name: "CV Sinar Jaya", companyName: "CV Sinar Jaya", phone: "081234000003", address: "Jl. Pemuda No. 5, Surabaya" },
    { code: "CUS-000004", type: "b2c", name: "Tono Susilo", phone: "081234000004", address: "Jl. Kenanga No. 9, Surabaya" },
    { code: "CUS-000005", type: "b2c", name: "Sari Indah", phone: "081234000005", address: "Jl. Anggrek No. 3, Bandung" },
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
      payment?: { amount: number; method: string; status: string };
      details: { description: string; quantity: number; weightKg: number; l: number; w: number; h: number }[];
    }[] = [
      {
        // Priced + DP ≥ 50% so the open pickup task (rizky) can be confirmed —
        // demonstrates the DP rule + QR scan flow end-to-end.
        masterCode: "MKT-000001", customer: "Rina Amelia", status: "READY_FOR_PICKUP",
        origin: "Jakarta Pusat", destination: "Bandung", priced: true, createdDaysAgo: 1,
        penerima: { name: "Laksmi Dewi", address: "Jl. Melati No. 12, Bandung", contact: "0813-2222-3333" },
        payment: { amount: 20000, method: "TRANSFER", status: "RECORDED" },
        details: [
          { description: "Paket pakaian", quantity: 1, weightKg: 2, l: 35, w: 25, h: 12 },
          { description: "Buku tulis", quantity: 3, weightKg: 1.5, l: 25, w: 20, h: 10 },
        ],
      },
      {
        // PICKED_UP — sits in the gudang arrival queue (Admin Gudang scans the
        // 10 packages / uses “Scan Semua”, then confirms arrival). Balance
        // unpaid → “Notify Marketing” demo after arrival.
        masterCode: "MKT-000002", customer: "PT Maju Bersama", status: "PICKED_UP",
        origin: "Jakarta Pusat", destination: "Bandung", priced: true, createdDaysAgo: 2,
        penerima: { name: "Hendra Gunawan", address: "Jl. Merdeka No. 88, Bandung", contact: "0814-4444-5555" },
        payment: { amount: 60000, method: "TRANSFER", status: "VERIFIED" },
        details: [{ description: "Karton Tulis", quantity: 10, weightKg: 2.5, l: 25, w: 20, h: 20 }],
      },
      {
        masterCode: "MKT-000003", customer: "CV Sinar Jaya", status: "RECEIVED_AT_GUDANG",
        origin: "Jakarta Pusat", destination: "Surabaya", priced: true, createdDaysAgo: 4,
        penerima: { name: "Bagian Gudang CV Sinar Jaya", address: "Jl. Pemuda No. 5, Surabaya", contact: "0815-5555-6666" },
        payment: { amount: 450000, method: "TRANSFER", status: "VERIFIED" },
        details: [
          { description: "Mesin bubut mini", quantity: 1, weightKg: 40, l: 60, w: 45, h: 40 },
          { description: "Spare part", quantity: 4, weightKg: 5, l: 25, w: 20, h: 15 },
        ],
      },
      {
        masterCode: "MKT-000004", customer: "Tono Susilo", status: "IN_TRANSPORT",
        origin: "Jakarta Pusat", destination: "Surabaya", priced: true, createdDaysAgo: 3,
        penerima: { name: "Tono Susilo", address: "Jl. Kenanga No. 9, Surabaya", contact: "0812-3456-0004" },
        payment: { amount: 25500, method: "CASH", status: "VERIFIED" },
        details: [{ description: "Kipas angin", quantity: 1, weightKg: 3, l: 30, w: 25, h: 12 }],
      },
      {
        masterCode: "MKT-000005", customer: "PT Maju Bersama", status: "DELIVERED",
        origin: "Jakarta Pusat", destination: "Bandung", priced: true, createdDaysAgo: 6,
        penerima: { name: "Bagian Gudang PT Maju Bersama", address: "Jl. Sudirman Kav. 21, Jakarta", contact: "0812-3456-0002" },
        payment: { amount: 180000, method: "CASH", status: "VERIFIED" },
        details: [{ description: "Paket promosi", quantity: 8, weightKg: 5, l: 30, w: 20, h: 15 }],
      },
      {
        // CREATED + unpriced — walk-in candidate: customer hands the package
        // straight to Admin Gudang (no scan needed).
        masterCode: "MKT-000006", customer: "Sari Indah", status: "CREATED",
        origin: "Jakarta Pusat", destination: "Bandung", priced: false, createdDaysAgo: 0,
        penerima: { name: "Sari Indah", address: "Jl. Anggrek No. 3, Bandung", contact: "0812-3456-0005" },
        details: [{ description: "Kosmetik", quantity: 2, weightKg: 1, l: 20, w: 15, h: 10 }],
      },
    ];
    const priceByCode: Record<string, number> = {};
    const shipmentIdByCode: Record<string, number> = {};
    const detailRowsByCode: Record<string, { id: number; detailCode: string }[]> = {};

    for (const s of shipmentDefs) {
      const createdAt = daysAgo(s.createdDaysAgo);
      const cust = customers[s.customer];
      const tariff = tariffByRoute[`${s.origin}|${s.destination}|${cust.type}`] ?? null;
      const shipment = await db.masterShipment.create({
        data: {
          masterCode: s.masterCode, resi: s.masterCode,
          customerId: cust.id,
          tariffId: tariff?.id ?? null,
          status: s.status,
          origin: s.origin, destination: s.destination,
          originWarehouseId: gudang["Jakarta Pusat"],
          destinationWarehouseId: gudang[s.destination],
          arrivedWarehouseId: ["RECEIVED_AT_GUDANG", "ARRIVED_AT_GUDANG"].includes(s.status) ? gudang["Jakarta Pusat"] : null,
          penerimaName: s.penerima.name,
          penerimaAddress: s.penerima.address,
          penerimaContact: s.penerima.contact,
          createdAt, updatedAt: createdAt,
        },
      });
      shipmentIdByCode[s.masterCode] = shipment.id;
      detailRowsByCode[s.masterCode] = [];
      // quantity N expands into N package rows — each with a unique detailCode (QR label)
      const pricedRows: { lengthCm: number | null; widthCm: number | null; heightCm: number | null; actualWeightKg: number }[] = [];
      let detailSeq = 1;
      for (const d of s.details) {
        for (let i = 0; i < d.quantity; i++) {
          const row = await db.detailShipment.create({
            data: {
              detailCode: `DTL-${s.masterCode.slice(-6)}-${String(detailSeq++).padStart(2, "0")}`,
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
        await db.masterShipment.update({
          where: { id: shipment.id },
          data: { chargeableWeightKg: r.chargeableKg, ratePerKg: tariff.ratePerKg, priceAmount: r.price, pricedAt: createdAt },
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
        events.push({ event: "RECEIVED_AT_GUDANG", description: "Diterima di Gudang Jakarta Pusat", daysAgo: s.createdDaysAgo - 0.6, actor: "agus" });
      }
      if (["IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        events.push({ event: "IN_TRANSPORT", description: "Berangkat via transport TRP-2026-000001", daysAgo: s.createdDaysAgo - 0.8, actor: "joko" });
      }
      if (s.status === "DELIVERED") {
        events.push({ event: "ARRIVED_AT_GUDANG", description: "Tiba di Gudang Bandung", daysAgo: s.createdDaysAgo - 1, actor: "agus" });
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
      // Gudang arrival scans for RECEIVED_AT_GUDANG shipments (mostly SCANNED,
      // one TYPED so Riwayat Scan differentiates both methods)
      if (["RECEIVED_AT_GUDANG"].includes(s.status)) {
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
      // Payment for priced shipments — DP/balance demo values per def
      const priceAmount = priceByCode[s.masterCode];
      if (s.payment && priceAmount != null) {
        await db.payment.create({
          data: {
            masterId: shipment.id, method: s.payment.method,
            amount: s.payment.amount, status: s.payment.status,
            reference: `PAY-${s.masterCode.slice(-6)}`,
            recordedById: usersByHandle.dewi.id, createdAt,
            verifiedById: s.payment.status === "VERIFIED" ? usersByHandle.siti.id : null,
            verifiedAt: s.payment.status === "VERIFIED" ? daysAgo(Math.max(0, s.createdDaysAgo - 0.5)) : null,
          },
        });
      }
    }

    // Transport carrying MKT-000004
    const mkt4 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000004" } });
    const transport = await db.transport.create({
      data: {
        transportCode: "TRP-2026-000001", routeId: routes["JKT - SBY Pantura"],
        vehicleId: vehicles["B 9455 KTB"],
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

    // Invoice for PT Maju
    const maju = await db.customer.findUniqueOrThrow({ where: { code: "CUS-000002" } });
    const invoice = await db.invoice.create({
      data: {
        invoiceNumber: "INV-2026-000001", customerId: maju.id, status: "SENT",
        issueDate: daysAgo(3), dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        notes: "Tagihan pengiriman periode ini", createdAt: daysAgo(3),
      },
    });
    await db.invoiceLine.createMany({
      data: [
        { invoiceId: invoice.id, description: "MKT-000002 — pengiriman Jakarta → Bandung (25 kg × Rp4.500)", quantity: 1, unitPrice: priceByCode["MKT-000002"] ?? 112500 },
        { invoiceId: invoice.id, description: "MKT-000005 — pengiriman Jakarta → Bandung (40 kg × Rp4.500)", quantity: 1, unitPrice: priceByCode["MKT-000005"] ?? 180000 },
      ],
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
      { action: "created", entityType: "warehouse", entityLabel: "Gudang Bandung", actor: "agus" },
      { action: "updated", entityType: "tariff", entityLabel: "Jakarta → Bandung (b2c)", actor: "siti" },
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
}
