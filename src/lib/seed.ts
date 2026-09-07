import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureRbac } from "@/lib/rbac";

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

  const ownerExists = await db.user.findFirst({ where: { username: "owner" } });
  const shipmentCount = await db.masterShipment.count();
  if (ownerExists && shipmentCount >= 6) return; // already seeded

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  // ----- Employees + users -------------------------------------------------
  const staffPassword = hashPassword("Demo#Pass2026");
  const ownerPassword = hashPassword("ChangeMeOwner#2026");

  const staff: { username: string; name: string; position: string; role: string; employeeNumber: string }[] = [
    { username: "siti", name: "Siti Rahma", position: "Admin Kantor", role: "admin-kantor", employeeNumber: "EMP-000002" },
    { username: "budi", name: "Budi Santoso", position: "Marketing", role: "marketing", employeeNumber: "EMP-000003" },
    { username: "agus", name: "Agus Pratama", position: "Admin Gudang", role: "admin-gudang", employeeNumber: "EMP-000004" },
    { username: "dewi", name: "Dewi Lestari", position: "Kurir", role: "kurir", employeeNumber: "EMP-000005" },
    { username: "rizky", name: "Rizky Hidayat", position: "Kurir", role: "kurir", employeeNumber: "EMP-000006" },
    { username: "joko", name: "Joko Widodo", position: "Driver", role: "driver", employeeNumber: "EMP-000007" },
    { username: "andi", name: "Andi Wijaya", position: "Kenek", role: "kenek", employeeNumber: "EMP-000008" },
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
      create: { employeeNumber: s.employeeNumber, name: s.name, position: s.position, phone: `08110000${s.employeeNumber.slice(-4)}` },
      update: {},
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

  // ----- Gudang (no gateway/type distinction) -------------------------------
  const gudangDefs = [
    { code: "WH-000001", name: "Gudang Jakarta Pusat", city: "Jakarta Pusat", address: "Jl. Gunung Sahari No. 45", latitude: -6.1105, longitude: 106.8814 },
    { code: "WH-000002", name: "Gudang Bandung", city: "Bandung", address: "Jl. Soekarno Hatta No. 210", latitude: -6.9175, longitude: 107.6191 },
    { code: "WH-000003", name: "Gudang Surabaya", city: "Surabaya", address: "Jl. Ahmad Yani No. 88", latitude: -7.2575, longitude: 112.7521 },
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
  const tariffDefs = [
    { origin: "Jakarta Pusat", destination: "Bandung", customerType: "b2b", ratePerKg: 4500 },
    { origin: "Jakarta Pusat", destination: "Bandung", customerType: "b2c", ratePerKg: 5500 },
    { origin: "Jakarta Pusat", destination: "Surabaya", customerType: "b2b", ratePerKg: 7500 },
    { origin: "Jakarta Pusat", destination: "Surabaya", customerType: "b2c", ratePerKg: 8500 },
  ];
  for (const t of tariffDefs) {
    const existing = await db.tariff.findFirst({ where: t });
    if (!existing) {
      await db.tariff.create({ data: { ...t, minChargeableKg: 1, volumetricDivisor: 6000, roundingMode: "UP", roundingUnitKg: 0.5, effectiveFrom: daysAgo(90) } });
    }
  }

  // ----- Customers -------------------------------------------------------------
  const customerDefs = [
    { code: "CUS-000001", type: "b2c", name: "Rina Amelia", phone: "081234000001", address: "Jl. Melati No. 12, Bandung" },
    { code: "CUS-000002", type: "b2b", name: "PT Maju Bersama", companyName: "PT Maju Bersama", phone: "081234000002", address: "Jl. Sudirman Kav. 21, Jakarta" },
    { code: "CUS-000003", type: "b2b", name: "CV Sinar Jaya", companyName: "CV Sinar Jaya", phone: "081234000003", address: "Jl. Pemuda No. 5, Surabaya" },
    { code: "CUS-000004", type: "b2c", name: "Tono Susilo", phone: "081234000004", address: "Jl. Kenanga No. 9, Surabaya" },
    { code: "CUS-000005", type: "b2c", name: "Sari Indah", phone: "081234000005", address: "Jl. Anggrek No. 3, Bandung" },
  ];
  const customers: Record<string, number> = {};
  for (const c of customerDefs) {
    const customer = await db.customer.upsert({ where: { code: c.code }, create: c, update: {} });
    customers[c.name] = customer.id;
  }

  // ----- Shipments lifecycle -----------------------------------------------------
  if ((await db.masterShipment.count()) === 0) {
    const shipmentDefs = [
      {
        masterCode: "MKT-000001", customer: "Rina Amelia", status: "READY_FOR_PICKUP",
        origin: "Jakarta Pusat", destination: "Bandung", priced: false, createdDaysAgo: 1,
        details: [{ description: "Paket pakaian", quantity: 1, weightKg: 2 }, { description: "Buku tulis", quantity: 3, weightKg: 1.5 }],
      },
      {
        masterCode: "MKT-000002", customer: "PT Maju Bersama", status: "PICKED_UP",
        origin: "Jakarta Pusat", destination: "Bandung", priced: true, ratePerKg: 4500, cw: 25, createdDaysAgo: 2,
        details: [{ description: "Karton alat tulis", quantity: 5, weightKg: 25 }],
      },
      {
        masterCode: "MKT-000003", customer: "CV Sinar Jaya", status: "RECEIVED_AT_GUDANG",
        origin: "Jakarta Pusat", destination: "Surabaya", priced: true, ratePerKg: 7500, cw: 60, createdDaysAgo: 4,
        details: [{ description: "Mesin bubut mini", quantity: 1, weightKg: 55 }, { description: "Spare part", quantity: 4, weightKg: 5 }],
      },
      {
        masterCode: "MKT-000004", customer: "Tono Susilo", status: "IN_TRANSPORT",
        origin: "Jakarta Pusat", destination: "Surabaya", priced: true, ratePerKg: 8500, cw: 3, createdDaysAgo: 3,
        details: [{ description: "Kipas angin", quantity: 1, weightKg: 3 }],
      },
      {
        masterCode: "MKT-000005", customer: "PT Maju Bersama", status: "DELIVERED",
        origin: "Jakarta Pusat", destination: "Bandung", priced: true, ratePerKg: 4500, cw: 40, createdDaysAgo: 6,
        details: [{ description: "Paket promosi", quantity: 8, weightKg: 40 }],
      },
      {
        masterCode: "MKT-000006", customer: "Sari Indah", status: "CREATED",
        origin: "Jakarta Pusat", destination: "Bandung", priced: false, createdDaysAgo: 0,
        details: [{ description: "Kosmetik", quantity: 2, weightKg: 1 }],
      },
    ];

    for (const s of shipmentDefs) {
      const createdAt = daysAgo(s.createdDaysAgo);
      const shipment = await db.masterShipment.create({
        data: {
          masterCode: s.masterCode, resi: s.masterCode,
          customerId: customers[s.customer],
          status: s.status,
          origin: s.origin, destination: s.destination,
          originWarehouseId: gudang["Jakarta Pusat"],
          destinationWarehouseId: gudang[s.destination],
          chargeableWeightKg: s.priced ? s.cw : null,
          ratePerKg: s.priced ? s.ratePerKg : null,
          priceAmount: s.priced ? Math.round(s.cw * s.ratePerKg) : null,
          pricedAt: s.priced ? createdAt : null,
          createdAt, updatedAt: createdAt,
        },
      });
      let detailSeq = 1;
      for (const d of s.details) {
        await db.detailShipment.create({
          data: {
            detailCode: `DTL-${s.masterCode.slice(-6)}-${String(detailSeq++).padStart(2, "0")}`,
            masterId: shipment.id, description: d.description, quantity: d.quantity,
            actualWeightKg: d.weightKg, lengthCm: d.description.length % 2 === 0 ? 30 : 20, widthCm: 20, heightCm: 15,
            createdAt,
          },
        });
      }
      const events: { event: string; description: string; daysAgo: number; actor?: string }[] = [
        { event: "CREATED", description: `Shipment ${s.masterCode} dibuat`, daysAgo: s.createdDaysAgo, actor: "budi" },
      ];
      if (["PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        events.push({ event: "READY_FOR_PICKUP", description: "Menunggu penjemputan kurir", daysAgo: s.createdDaysAgo - 0.2, actor: "budi" });
        events.push({ event: "PICKED_UP", description: "Diambil kurir Dewi Lestari", daysAgo: s.createdDaysAgo - 0.4, actor: "dewi" });
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

      // Pickup for statuses after CREATED
      if (["PICKED_UP", "RECEIVED_AT_GUDANG", "IN_TRANSPORT", "DELIVERED"].includes(s.status)) {
        await db.pickup.create({
          data: {
            pickupCode: `PICK-2026-${s.masterCode.slice(-6)}`, masterId: shipment.id,
            kurirId: usersByHandle.dewi.employeeId,
            status: "COMPLETED", createdAt, completedAt: daysAgo(Math.max(0, s.createdDaysAgo - 0.4)), updatedAt: createdAt,
          },
        });
      }
      // Payment for priced shipments
      if (s.priced) {
        await db.payment.create({
          data: {
            masterId: shipment.id, method: s.status === "DELIVERED" ? "CASH" : "TRANSFER",
            amount: Math.round(s.cw * s.ratePerKg), status: s.status === "IN_TRANSPORT" ? "VERIFIED" : "RECORDED",
            reference: `PAY-${s.masterCode.slice(-6)}`,
            recordedById: usersByHandle.dewi.id, createdAt,
            verifiedById: s.status === "IN_TRANSPORT" ? usersByHandle.siti.id : null,
            verifiedAt: s.status === "IN_TRANSPORT" ? daysAgo(Math.max(0, s.createdDaysAgo - 0.5)) : null,
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

    // Completed delivery for MKT-000005
    const mkt5 = await db.masterShipment.findUniqueOrThrow({ where: { masterCode: "MKT-000005" } });
    await db.delivery.create({
      data: {
        deliveryCode: "DLV-2026-000001", masterId: mkt5.id, kurirId: usersByHandle.dewi.employeeId,
        status: "COMPLETED", proofOfDelivery: "Diterima oleh bagian gudang PT Maju Bersama",
        completedAt: daysAgo(2), createdAt: daysAgo(2.5),
      },
    });

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
        { invoiceId: invoice.id, description: "MKT-000002 — pengiriman Jakarta → Bandung", quantity: 1, unitPrice: 112500 },
        { invoiceId: invoice.id, description: "MKT-000005 — pengiriman Jakarta → Bandung", quantity: 1, unitPrice: 180000 },
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
