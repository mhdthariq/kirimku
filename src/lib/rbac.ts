import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Permission catalog (module -> [permission slug, description])
// ---------------------------------------------------------------------------

export const PERMISSIONS: { slug: string; module: string; description: string }[] = [
  // Customers & shipments
  { slug: "customer.view", module: "Customers", description: "View customers" },
  { slug: "customer.create", module: "Customers", description: "Create customers" },
  { slug: "customer.update", module: "Customers", description: "Update customers" },
  { slug: "customer.delete", module: "Customers", description: "Delete/deactivate customers" },
  { slug: "shipment.view", module: "Shipments", description: "View master shipments" },
  { slug: "shipment.create", module: "Shipments", description: "Create master shipments" },
  { slug: "shipment.update", module: "Shipments", description: "Update master shipments" },
  { slug: "shipment.cancel", module: "Shipments", description: "Cancel master shipments" },
  { slug: "shipment.delete", module: "Shipments", description: "Delete master shipments" },
  { slug: "shipment.view_tracking", module: "Shipments", description: "View tracking history" },
  { slug: "shipment.confirm_arrival", module: "Shipments", description: "Confirm package arrival at gudang (scan packages / walk-in / scan-all)" },
  { slug: "shipment.notify_marketing", module: "Shipments", description: "Notify marketing about unpaid shipments at gudang" },
  { slug: "shipment_detail.view", module: "Shipments", description: "View detail shipments" },
  { slug: "shipment_detail.create", module: "Shipments", description: "Add detail shipments" },
  { slug: "shipment_detail.update", module: "Shipments", description: "Update detail shipments" },
  { slug: "shipment_detail.delete", module: "Shipments", description: "Remove detail shipments" },
  // Pickup
  { slug: "pickup.view", module: "Pickups", description: "View pickup tasks" },
  { slug: "pickup.create", module: "Pickups", description: "Create pickup requests" },
  { slug: "pickup.assign_kurir", module: "Pickups", description: "Assign kurir to pickups" },
  { slug: "pickup.scan", module: "Pickups", description: "Scan QR detail barang at pickup" },
  { slug: "pickup.confirm", module: "Pickups", description: "Confirm pickup completion (all details scanned)" },
  // Delivery
  { slug: "delivery.view", module: "Deliveries", description: "View delivery tasks" },
  { slug: "delivery.assign_kurir", module: "Deliveries", description: "Assign kurir to deliveries" },
  { slug: "delivery.scan", module: "Deliveries", description: "Scan QR detail barang at delivery" },
  { slug: "delivery.confirm", module: "Deliveries", description: "Complete deliveries (all packages scanned + POD)" },
  // Transport
  { slug: "transport.view", module: "Transports", description: "View transports" },
  { slug: "transport.create", module: "Transports", description: "Create transports" },
  { slug: "transport.depart", module: "Transports", description: "Mark transport departed" },
  { slug: "transport.arrive", module: "Transports", description: "Mark transport arrived" },
  // Vehicle
  { slug: "vehicle.view", module: "Vehicles", description: "View vehicles" },
  { slug: "vehicle.create", module: "Vehicles", description: "Create vehicles" },
  { slug: "vehicle.update", module: "Vehicles", description: "Update vehicles" },
  // Gudang
  { slug: "warehouse.view", module: "Gudang", description: "View gudang master data" },
  { slug: "warehouse.create", module: "Gudang", description: "Create gudang" },
  { slug: "warehouse.update", module: "Gudang", description: "Update gudang" },
  { slug: "warehouse.delete", module: "Gudang", description: "Delete/deactivate gudang" },
  // Routes & checkpoints
  { slug: "checkpoint.view", module: "Routes", description: "View routes & checkpoints" },
  { slug: "checkpoint.create", module: "Routes", description: "Create routes/checkpoints" },
  { slug: "checkpoint.update", module: "Routes", description: "Update routes/checkpoints" },
  { slug: "checkpoint.delete", module: "Routes", description: "Delete routes/checkpoints" },
  // Tariffs
  { slug: "tariff.view", module: "Tariffs", description: "View tariffs" },
  { slug: "tariff.create", module: "Tariffs", description: "Create tariffs" },
  { slug: "tariff.update", module: "Tariffs", description: "Update tariffs" },
  // Payments
  { slug: "payment.view", module: "Payments", description: "View payments" },
  { slug: "payment.record", module: "Payments", description: "Record payments" },
  { slug: "payment.verify", module: "Payments", description: "Verify payments" },
  { slug: "payment.unpaid.view", module: "Payments", description: "View unpaid B2C shipments" },
  // Invoices
  { slug: "invoice.view", module: "Invoices", description: "View invoices" },
  { slug: "invoice.create", module: "Invoices", description: "Create invoices" },
  { slug: "invoice.update", module: "Invoices", description: "Update invoices" },
  { slug: "invoice.send", module: "Invoices", description: "Send/finalize invoices" },
  // Access control
  { slug: "employee.view", module: "Access", description: "View employees" },
  { slug: "employee.create", module: "Access", description: "Create employees" },
  { slug: "employee.update", module: "Access", description: "Update employees" },
  { slug: "employee.disable", module: "Access", description: "Disable employees" },
  { slug: "user.view", module: "Access", description: "View users" },
  { slug: "user.create", module: "Access", description: "Create users" },
  { slug: "user.update", module: "Access", description: "Update users and assign roles" },
  { slug: "user.disable", module: "Access", description: "Disable users" },
  { slug: "role.view", module: "Access", description: "View roles" },
  { slug: "role.create", module: "Access", description: "Create roles" },
  { slug: "role.update", module: "Access", description: "Update roles" },
  { slug: "role.delete", module: "Access", description: "Delete roles" },
  { slug: "audit_log.view", module: "Access", description: "View audit log timeline" },
];

// ---------------------------------------------------------------------------
// System roles
// ---------------------------------------------------------------------------

export const ROLE_TEMPLATES: { slug: string; name: string; description: string; permissions: string[] }[] = [
  {
    slug: "admin-kantor",
    name: "Admin Kantor",
    description: "Office administration: tariffs, invoices, payments, customers",
    permissions: [
      "customer.view", "customer.create", "customer.update",
      "shipment.view", "shipment.view_tracking",
      "tariff.view", "tariff.create", "tariff.update",
      "payment.view", "payment.record", "payment.verify", "payment.unpaid.view",
      "invoice.view", "invoice.create", "invoice.update", "invoice.send",
      "audit_log.view",
    ],
  },
  {
    slug: "marketing",
    name: "Marketing",
    description: "Acquisition: customers, shipments, pickups",
    permissions: [
      "customer.view", "customer.create", "customer.update", "customer.delete",
      "shipment.view", "shipment.create", "shipment.update", "shipment.cancel", "shipment.view_tracking",
      "shipment_detail.view", "shipment_detail.create", "shipment_detail.update", "shipment_detail.delete",
      "pickup.view", "pickup.create", "pickup.assign_kurir",
    ],
  },
  {
    slug: "admin-gudang",
    name: "Admin Gudang",
    description: "Warehouse operations: arrival scanning, fleet, routes, transports — data terbatas ke gudang tempatnya bertugas",
    permissions: [
      "warehouse.view", "warehouse.create", "warehouse.update", "warehouse.delete",
      "vehicle.view", "vehicle.create", "vehicle.update",
      "checkpoint.view", "checkpoint.create", "checkpoint.update", "checkpoint.delete",
      "transport.view", "transport.create", "transport.depart", "transport.arrive",
      "shipment.view", "shipment.view_tracking", "shipment.confirm_arrival", "shipment.notify_marketing",
      "shipment_detail.view",
      "delivery.view", "delivery.assign_kurir",
      "pickup.view", "pickup.create", "pickup.assign_kurir", "pickup.confirm",
      "payment.view",
      "audit_log.view",
    ],
  },
  {
    slug: "staff-gudang",
    name: "Staff Gudang",
    description: "Warehouse floor staff: arrival scanning & walk-in confirm — data terbatas ke gudang tempatnya bertugas",
    permissions: [
      "warehouse.view",
      "shipment.view", "shipment.view_tracking", "shipment.confirm_arrival",
      "shipment_detail.view",
      "pickup.view",
      "transport.view",
      "delivery.view",
    ],
  },
  {
    slug: "kurir",
    name: "Kurir",
    description: "First/last mile: pickup & delivery execution with QR scanning — data terbatas ke gudang tempatnya bertugas",
    permissions: [
      "pickup.view", "pickup.create", "pickup.scan", "pickup.confirm",
      "delivery.view", "delivery.scan", "delivery.confirm",
      "shipment.view",
      "payment.view", "payment.record",
    ],
  },
  {
    slug: "driver",
    name: "Driver",
    description: "Linehaul driver: transport depart/arrive",
    permissions: [
      "transport.view", "transport.depart", "transport.arrive",
      "shipment.view",
    ],
  },
  {
    slug: "kenek",
    name: "Kenek",
    description: "Linehaul assistant: view transports",
    permissions: ["transport.view", "shipment.view"],
  },
];

// ---------------------------------------------------------------------------
// Idempotent bootstrap of the RBAC catalog. Safe to call on every request;
// performs actual work only once (or when the catalog changes).
// ---------------------------------------------------------------------------

let rbacReady = false;

export async function ensureRbac(): Promise<void> {
  if (rbacReady) return;
  const existingCount = await db.permission.count();
  // Re-apply system role templates whenever the permission catalog changes
  // (e.g. new scan permissions shipped with an app update) so seeded roles
  // stay aligned with code. Owner edits made in between persist across
  // ordinary restarts — only a catalog change re-applies templates.
  const catalogChanged = existingCount !== PERMISSIONS.length;
  if (catalogChanged) {
    for (const p of PERMISSIONS) {
      await db.permission.upsert({
        where: { slug: p.slug },
        create: p,
        update: { module: p.module, description: p.description },
      });
    }
    // prune permissions removed from the catalog (e.g. the obsolete
    // warehouse.scope_own — gudang scoping is now universal for every
    // non-owner role) so the count check stays in sync
    const keep = PERMISSIONS.map((p) => p.slug);
    await db.rolePermission.deleteMany({ where: { permission: { slug: { notIn: keep } } } });
    await db.permission.deleteMany({ where: { slug: { notIn: keep } } });
  }
  const roleCount = await db.role.count();
  if (roleCount < ROLE_TEMPLATES.length || catalogChanged) {
    const allPermissions = await db.permission.findMany();
    const bySlug = new Map(allPermissions.map((p) => [p.slug, p.id]));
    for (const template of ROLE_TEMPLATES) {
      const role = await db.role.upsert({
        where: { slug: template.slug },
        create: {
          slug: template.slug,
          name: template.name,
          description: template.description,
          isSystem: true,
        },
        update: { name: template.name, description: template.description },
      });
      const permissionIds = template.permissions
        .map((slug) => bySlug.get(slug))
        .filter((id): id is number => id != null)
        .map((permissionId) => ({ roleId: role.id, permissionId }));
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      await db.rolePermission.createMany({ data: permissionIds });
    }
  }
  rbacReady = true;
}
