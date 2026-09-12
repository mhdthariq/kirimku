"use client";

/**
 * Typed API client for the /api/v1 backend. Token stored in localStorage,
 * Bearer auth, envelope handling, consistent error shape.
 */

const TOKEN_KEY = "kirimku_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  readonly errors?: Record<string, string[]>;
  constructor(status: number, message: string, errors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body,
    cache: "no-store",
  });

  if (response.status === 401 && typeof window !== "undefined" && getToken()) {
    setToken(null);
    window.location.reload();
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; meta?: Record<string, unknown>; message?: string; errors?: Record<string, string[]> }
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ?? `Permintaan gagal (${response.status}).`,
      payload?.errors,
    );
  }
  return (payload?.data ?? undefined) as T;
}

/** Like apiGet but also exposes the envelope `meta` (pagination / filter options). */
export async function apiGetWithMeta<T>(path: string): Promise<{ data: T; meta: Record<string, unknown> | undefined }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api/v1${path}`, { headers, cache: "no-store" });
  if (response.status === 401 && typeof window !== "undefined" && getToken()) {
    setToken(null);
    window.location.reload();
  }
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; meta?: Record<string, unknown>; message?: string }
    | null;
  if (!response.ok) {
    throw new ApiError(response.status, payload?.message ?? `Permintaan gagal (${response.status}).`);
  }
  return { data: payload?.data as T, meta: payload?.meta };
}

export const apiGet = <T>(path: string) => apiFetch<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body });
export const apiPut = <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body });
export const apiDelete = <T>(path: string) => apiFetch<T>(path, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  isOwner: boolean;
  employeeId: number | null;
  /** gudang the user's employee belongs to (null when unbound / owner) */
  warehouseId: number | null;
  /** display name of the user's gudang */
  warehouseName: string | null;
  /** partner profile when the user is a Marketing / Vehicle Owner partner */
  partnerId: number | null;
  partnerType: "MARKETING" | "VEHICLE_OWNER" | null;
  roles: { id: number; slug: string; name: string }[];
  permissions: string[];
}

export function hasPermission(user: SessionUser | null, permission: string): boolean {
  if (!user) return false;
  if (user.isOwner || user.permissions.includes("*")) return true;
  return user.permissions.includes(permission);
}

export function hasAnyPermission(user: SessionUser | null, permissions: string[]): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export interface Customer {
  id: number;
  code: string;
  type: "b2b" | "b2c";
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
}

export interface DetailShipment {
  id: number;
  detailCode: string;
  masterId: number;
  description: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  actualWeightKg: number;
}

/** Server-computed pricing preview returned by GET /shipments/{id}. */
export interface PricingPreview {
  tariffId: number | null;
  ratePerKg: number | null;
  volumetricMultiplier: number;
  minChargeableKg: number;
  roundingMode: string;
  roundingUnitKg: number;
  actualKg: number;
  volumetricKg: number;
  chargeableKg: number;
  estimatedPrice: number | null;
}

export interface Shipment {
  id: number;
  masterCode: string;
  resi: string | null;
  status: string;
  origin: string;
  destination: string;
  customerId: number;
  customer?: Customer | null;
  originWarehouseId?: number | null;
  destinationWarehouseId?: number | null;
  arrivedWarehouseId?: number | null;
  /** gudang(s) this shipment currently belongs to — drives the owner's per-gudang tabs */
  gudangIds?: number[];
  penerimaName?: string | null;
  penerimaAddress?: string | null;
  penerimaContact?: string | null;
  tariffId?: number | null;
  tariff?: Tariff | null;
  pricingPreview?: PricingPreview | null;
  totals?: ShipmentTotals;
  paymentSummary?: PaymentSummary;
  chargeableWeightKg: number | null;
  ratePerKg: number | null;
  priceAmount: number | null;
  pricedAt: string | null;
  /** Revise.md §6 — Marketing-funded B2C discount */
  discountAmount: number;
  discountPercentage: number | null;
  finalPriceAmount: number | null;
  discountFundedBy: "MARKETING" | "COMPANY";
  createdByPartnerId?: number | null;
  createdAt: string;
  invoiceLines?: { invoice: { id: number; invoiceNumber: string; status: string } }[];
  details?: DetailShipment[];
  _count?: { details: number; pickups: number; deliveries: number; payments: number };
  trackingEvents?: { id: number; event: string; description: string | null; occurredAt: string; actor?: { name: string } | null }[];
}

export interface ShipmentTotals {
  totalPackages: number;
  totalActualKg: number;
  totalVolumeM3: number;
}

export interface PaymentSummary {
  priceAmount: number | null;
  discountAmount: number; // Revise.md §6 — Marketing-funded discount
  finalPriceAmount: number | null; // what the customer actually owes
  paidAmount: number;
  remainingAmount: number;
  dpRequirement: number;
  dpOk: boolean;
  status: "UNPAID" | "DP" | "PAID" | "UNPRICED";
}

export interface TrackingEvent {
  id: number;
  event: string;
  description: string | null;
  occurredAt: string;
  actor?: { name: string } | null;
}

export interface Payment {
  id: number;
  masterId: number;
  method: string;
  amount: number;
  status: string;
  reference: string | null;
  createdAt: string;
  verifiedAt: string | null;
  recordedBy?: { name: string } | null;
  verifiedBy?: { name: string } | null;
}

export interface ScanDetailState {
  id: number;
  detailCode: string;
  description: string;
  scanned: boolean;
  scannedAt: string | null;
  scannedByName: string | null;
  /** SCANNED (camera / reader tool) | TYPED (manual input) — Riwayat Scan */
  scanMethod: string | null;
}

export interface ScanProgress {
  total: number;
  scanned: number;
  allScanned: boolean;
  details: ScanDetailState[];
}

export interface ScanResponse {
  scan: { id: number; payload: string; result: string; scanLevel: string; detailId: number | null; method?: string; scannedAt: string };
  message: string;
  progress: ScanProgress;
}

export interface PickupTask {
  id: number;
  pickupCode: string;
  status: string;
  kurirId: number | null;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  masterCode: string;
  masterStatus: string;
  origin: string;
  destination: string;
  customerName: string;
  customerType: string;
  detailsCount: number;
  scannedCount: number;
  /** gudang(s) this pickup belongs to (origin side of the master shipment) */
  gudangIds?: number[];
}

export interface DeliveryTask {
  id: number;
  deliveryCode: string;
  status: string;
  kurirId: number | null;
  notes: string | null;
  proofOfDelivery: string | null;
  createdAt: string;
  completedAt: string | null;
  masterCode: string;
  masterStatus: string;
  destination: string;
  address: string | null;
  customerName: string;
  customerPhone: string | null;
  priceAmount: number | null;
  detailsCount: number;
  scannedCount: number;
  allScanned: boolean;
  details: { id: number; detailCode: string; description: string; scanned: boolean }[];
  /** gudang(s) this delivery belongs to */
  gudangIds?: number[];
}

export interface Vehicle {
  id: number;
  vehicleNumber: string;
  name: string | null;
  status: string;
  maxWeightKg: number;
  maxVolumeM3: number;
  notes: string | null;
  /** Revise.md §13 — linked Vehicle Owner (null = company-owned) */
  ownerId: number | null;
  owner?: { id: number; user: { name: string } } | null;
  assignments: { driverId: number | null; driver: { name: string } | null; kenek: { name: string } | null }[];
  _count?: { transports: number };
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  customerSupportContact?: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface Checkpoint {
  id: number;
  routeId: number;
  name: string;
  sequence: number;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export interface Route {
  id: number;
  name: string;
  origin: string | null;
  destination: string | null;
  isActive: boolean;
  checkpoints: Checkpoint[];
  _count?: { transports: number };
}

export interface Transport {
  id: number;
  transportCode: string;
  status: string;
  routeId: number | null;
  routeName: string | null;
  routeCheckpoints?: Checkpoint[];
  vehicleId: number;
  vehicleNumber: string;
  vehicleName: string | null;
  /** Revise.md §14 — partner owner + settlement state of this transport */
  vehicleOwnerId?: number | null;
  vehicleOwnerName?: string | null;
  settlement?: {
    settlementCode: string;
    status: string;
    transportValue: number;
    companyPercent: number;
    ownerPercent: number;
    companyAmount: number;
    ownerAmount: number;
    finalizedAt: string | null;
  } | null;
  driverName: string | null;
  kenekName: string | null;
  /** Planning fields (Revision Part J) */
  origin: string | null;
  destination: string | null;
  plannedDepartureAt: string | null;
  plannedArrivalAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  /** last known position (Revision Part K) */
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: string | null;
  shipments: { id: number; masterCode: string; status: string; packages: number }[];
  checkpointRecordsCount: number;
  /** aggregate totals (Revision Parts L/M) */
  shipmentCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  totalPrice: number | null;
  /** gudang(s) this transport belongs to (route endpoints + shipments) */
  gudangIds?: number[];
}

/** Transport detail (GET /transports/{id}) — Revision Part K. */
export interface TransportDetail {
  id: number;
  transportCode: string;
  status: string;
  routeId: number | null;
  routeName: string | null;
  routeOrigin: string | null;
  routeDestination: string | null;
  checkpoints: Checkpoint[];
  origin: string | null;
  destination: string | null;
  plannedDepartureAt: string | null;
  plannedArrivalAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle: {
    id: number;
    vehicleNumber: string;
    name: string | null;
    status: string;
    maxWeightKg: number;
    maxVolumeM3: number;
  };
  driver: { id: number; name: string } | null;
  kenek: { id: number; name: string } | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: string | null;
  checkpointRecords: {
    id: number;
    checkpointId: number;
    checkpointName: string;
    checkpointSequence: number;
    latitude: number;
    longitude: number;
    withinRadius: boolean;
    distanceMeters: number | null;
    photoUrl: string | null;
    recordedBy: { id: number; name: string } | null;
    recordedAt: string;
  }[];
  shipments: {
    id: number;
    masterCode: string;
    resi: string | null;
    status: string;
    origin: string;
    destination: string;
    customerName: string | null;
    penerimaName: string | null;
    packages: number;
    weightKg: number;
    volumeM3: number;
    priceAmount: number | null;
  }[];
  shipmentCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  totalPrice: number | null;
}

/** Check-in response (POST /transports/{id}/checkins) — Revision Part O. */
export interface CheckinResponse {
  record: {
    id: number;
    checkpointId: number;
    checkpointName: string;
    latitude: number;
    longitude: number;
    distanceMeters: number;
    withinRadius: boolean;
    recordedAt: string;
  };
  distanceKm: number;
  radiusKm: number;
  autoArrived: boolean;
  message: string;
}

export interface Tariff {
  id: number;
  origin: string;
  destination: string;
  customerType: string | null;
  ratePerKg: number;
  minChargeableKg: number;
  volumetricMultiplier: number;
  roundingMode: string;
  roundingUnitKg: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface InvoiceLine {
  id: number;
  invoiceId: number;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Revise.md §7.1 — linked B2B shipment billed by this line */
  shipmentId?: number | null;
  shipment?: { id: number; masterCode: string } | null;
}

export interface InvoiceSettlement {
  id: number;
  invoiceId: number;
  amount: number;
  method: string;
  reference: string | null;
  settledAt: string;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  customerCode: string;
  customerType: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
  linesCount: number;
  totalAmount: number;
  settledAmount: number;
  remainingAmount: number;
  isOverdue: boolean;
  createdAt: string;
  lines?: InvoiceLine[];
  settlements?: InvoiceSettlement[];
  /** Revise.md §8 — Marketing commission attached to this invoice */
  commission?: {
    status: string;
    partnerName: string;
    commissionAmount: number;
    partnerPercent: number;
  } | null;
}

export interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  entityLabel: string | null;
  actorName: string;
  actorUsername: string | null;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditResponse {
  data: AuditEntry[];
  meta: { total: number; entityTypes: string[]; actions: string[] };
}

export interface Employee {
  id: number;
  employeeNumber: string;
  name: string;
  phone: string | null;
  position: string | null;
  warehouseId: number | null;
  warehouse?: { id: number; name: string; city: string | null } | null;
  isActive: boolean;
  user?: { id: number; username: string; isActive: boolean; roles: { role: { id: number; name: string; slug: string }[] } } | null;
}

export interface UserAccount {
  id: number;
  username: string;
  name: string;
  isOwner: boolean;
  isActive: boolean;
  employeeId: number | null;
  employee?: { name: string; employeeNumber: string } | null;
  partnerId?: number | null;
  partnerType?: "MARKETING" | "VEHICLE_OWNER" | null;
  roles: { role: { id: number; name: string; slug: string } }[];
}

export interface Role {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: { id: number; slug: string; module: string; description: string } }[];
  _count?: { users: number };
}

export interface Permission {
  id: number;
  slug: string;
  module: string;
  description: string;
}

export interface Options {
  company: { name: string };
  employees: { id: number; name: string; position: string | null; warehouseId: number | null }[];
  vehicles: { id: number; vehicleNumber: string; name: string | null; maxWeightKg: number }[];
  routes: { id: number; name: string; origin: string | null; destination: string | null }[];
  warehouses: { id: number; code: string; name: string; city: string | null; customerSupportContact?: string | null }[];
  customers: { id: number; code: string; name: string; type: string }[];
  tariffs: { id: number; origin: string; destination: string; customerType: string | null; ratePerKg: number; minChargeableKg: number; volumetricMultiplier: number; roundingMode: string; roundingUnitKg: number; effectiveFrom: string; effectiveTo: string | null }[];
  permissions: { id: number; slug: string; module: string; description: string | null }[];
  /** Revise.md §13 — vehicle-owner partners (vehicle ownership dropdown) */
  vehicleOwners?: { id: number; name: string; username: string; profitShare: { company: number; partner: number } }[];
  /** Revise.md §7.1 — B2B shipments available for invoice line linking */
  b2bShipments?: { id: number; masterCode: string; priceAmount: number | null; finalPriceAmount: number | null; customerId: number; createdByPartnerId: number | null; origin: string; destination: string; invoiceLines: { invoice: { id: number; invoiceNumber: string; status: string } }[] }[];
}

// ---------------------------------------------------------------------------
// Gudang operations workspace (GET /gudang)
// ---------------------------------------------------------------------------

export interface GudangArrivalQueueItem {
  id: number;
  masterCode: string;
  customerName: string;
  customerPhone: string | null;
  origin: string;
  destination: string;
  originWarehouseId: number | null;
  destinationWarehouseId: number | null;
  priceAmount: number | null;
  paidAmount: number;
  remainingAmount: number | null;
  dpOk: boolean;
  penerimaName: string | null;
  detailsCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  scannedCount: number;
  scannedByMethod: { SCANNED: number; TYPED: number };
  pickupCode: string | null;
  kurirName: string | null;
  updatedAt: string;
}

export interface GudangWalkInItem {
  id: number;
  masterCode: string;
  customerName: string;
  origin: string;
  destination: string;
  originWarehouseId: number | null;
  destinationWarehouseId: number | null;
  status: string;
  priceAmount: number | null;
  penerimaName: string | null;
  detailsCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
}

export interface GudangContentShipment {
  id: number;
  masterCode: string;
  customerName: string;
  status: string;
  stage: string;
  packages: number;
  weightKg: number;
  volumeM3: number;
  priceAmount: number | null;
  remainingAmount: number | null;
  updatedAt: string;
}

export interface GudangWorkspace {
  scope: { warehouseId: number | null; warehouseName: string | null; scoped: boolean };
  arrivals: GudangArrivalQueueItem[];
  walkIns: GudangWalkInItem[];
  warehouses: {
    id: number;
    code: string;
    name: string;
    city: string | null;
    customerSupportContact: string | null;
    heldShipments: number;
    heldPackages: number;
    heldWeightKg: number;
    unpaidCount: number;
    shipments: GudangContentShipment[];
  }[];
}

export interface UnpaidShipment {
  id: number;
  masterCode: string;
  status: string;
  destination: string;
  customerName: string;
  customerPhone: string | null;
  priceAmount: number;
  paidAmount: number;
  pendingAmount: number;
  remainingAmount: number;
  payments: { id: number; method: string; amount: number; status: string; reference: string | null; createdAt: string; recordedByName: string | null }[];
}

export interface DashboardData {
  counts: Record<string, number | null>;
  statusCounts: Record<string, number>;
  revenueVerified: number;
  recentShipments: {
    id: number;
    masterCode: string;
    status: string;
    origin: string;
    destination: string;
    customerName: string;
    createdAt: string;
  }[];
  recentAudit: {
    id: number;
    action: string;
    entityType: string;
    entityLabel: string | null;
    actorName: string;
    createdAt: string;
  }[];
}

// ---------------------------------------------------------------------------
// Revise.md — Partner wallet financial system types
// ---------------------------------------------------------------------------

export interface WalletSummaryData {
  partnerId: number;
  walletId: number;
  balance: number;
  reserved: number;
  available: number;
  partnerType: "MARKETING" | "VEHICLE_OWNER";
  partnerName: string;
  profitShare: { company: number; partner: number };
  bank: { bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null };
}

export interface WalletTransaction {
  id: number;
  walletId: number;
  type: "TOPUP" | "COMMISSION" | "TRANSPORT_PROFIT_SHARE" | "REPAIR_DEDUCTION" | "WITHDRAWAL" | "ADJUSTMENT";
  amount: number;
  direction: "CREDIT" | "DEBIT";
  balanceBefore: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: number | null;
  businessRef: string;
  status: string;
  description: string | null;
  createdAt: string;
}

export interface TopUpRequest {
  id: number;
  requestCode: string;
  partnerId: number;
  amount: number;
  status: "PENDING_PAYMENT" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED" | "CANCELLED";
  partnerNote: string | null;
  partnerProofUrl: string | null;
  proofUrl: string | null;
  rejectReason: string | null;
  submittedForVerificationAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  partner?: { user: { name: string; username: string }; type: string } | null;
  verifiedBy?: { name: string } | null;
}

export interface TopUpsResponse {
  topUps: TopUpRequest[];
  bankInfo: { bankName: string; accountNumber: string; accountName: string };
}

export interface WithdrawalRequest {
  id: number;
  requestCode: string;
  partnerId: number;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  partnerNote: string | null;
  transferProofUrl: string | null;
  rejectReason: string | null;
  reviewedById: number | null;
  processedById: number | null;
  completedAt: string | null;
  createdAt: string;
  partner?: { user: { name: string; username: string }; type: string } | null;
  reviewedBy?: { name: string } | null;
  processedBy?: { name: string } | null;
}

export interface CommissionRow {
  id: number;
  commissionCode: string;
  status: "PENDING" | "RELEASED" | "CANCELLED";
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  customerName: string;
  invoiceAmount: number;
  paidAmount: number;
  remainingAmount: number;
  companyPercent: number;
  partnerPercent: number;
  commissionAmount: number;
  releasedAt: string | null;
  createdAt: string;
  shipments: number;
}

export interface VehicleRepairRow {
  id: number;
  repairCode: string;
  vehicleId: number;
  ownerId: number;
  description: string;
  amount: number;
  repairDate: string;
  workshopVendor: string | null;
  proofUrl: string | null;
  relatedTransportId: number | null;
  notes: string | null;
  status: "PENDING_CONFIRMATION" | "OWNER_CONFIRMED" | "VERIFIED" | "REJECTED";
  rejectReason: string | null;
  createdAt: string;
  vehicle: { id: number; vehicleNumber: string; name: string | null };
  owner?: { user: { name: string } } | null;
  confirmations: { id: number; party: "VEHICLE_OWNER" | "OWNER_COMPANY"; decision: string; note: string | null; user: { name: string } | null; createdAt: string }[];
}

export interface PartnerRow {
  id: number;
  userId: number;
  name: string;
  username: string;
  userActive: boolean;
  type: "MARKETING" | "VEHICLE_OWNER";
  profitShare: { company: number; partner: number };
  bank: { bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null };
  isActive: boolean;
  notes: string | null;
  wallet: { balance: number; reserved: number; available: number };
  totals: { transportEarnings: number; commissions: number; repairDeductions: number; withdrawals: number };
  counts: { vehicles: number; commissions: number; settlements: number; topUps: number; withdrawals: number; repairs: number };
}

export interface VehicleOwnerDashboard {
  wallet: { balance: number; reserved: number; available: number };
  totals: { earnings: number; transportCount: number; repairDeductions: number; withdrawals: number };
  vehicles: { id: number; vehicleNumber: string; name: string | null; status: string; maxWeightKg: number; maxVolumeM3: number }[];
  recentSettlements: {
    id: number;
    settlementCode: string;
    transportValue: number;
    ownerPercent: number;
    ownerAmount: number;
    finalizedAt: string | null;
    transport: { transportCode: string; origin: string | null; destination: string | null; arrivedAt: string | null };
    vehicle: { vehicleNumber: string };
  }[];
  recentTransactions: WalletTransaction[];
  pendingRepairs: number;
}

export interface VOTransportRow {
  id: number;
  transportCode: string;
  status: string;
  routeName: string;
  vehicleNumber: string;
  shipmentCount: number;
  transportValue: number;
  ownerPercent: number;
  ownerEarnings: number | null;
  departedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  settlement: {
    settlementCode: string;
    status: string;
    companyPercent: number;
    ownerPercent: number;
    transportValue: number;
    companyAmount: number;
    ownerAmount: number;
    finalizedAt: string | null;
  } | null;
}

export interface FinanceSummary {
  totals: {
    partnerCount: number;
    marketingCount: number;
    vehicleOwnerCount: number;
    totalWalletBalance: number;
    totalReserved: number;
    totalAvailable: number;
    verifiedTopUps: number;
    releasedCommissions: number;
    transportSharePaid: number;
    transportValueSettled: number;
    repairDeductions: number;
    withdrawalsCompleted: number;
    unsettledArrivedTransports: number;
  };
  pending: {
    topUps: { id: number; requestCode: string; partnerName: string; partnerType: string; amount: number; status: string; createdAt: string }[];
    withdrawals: { id: number; requestCode: string; partnerName: string; partnerType: string; amount: number; status: string; bankName: string | null; bankAccountNumber: string | null; createdAt: string }[];
    repairs: { id: number; repairCode: string; vehicleNumber: string; ownerName: string; amount: number; status: string; createdAt: string }[];
    commissions: { id: number; commissionCode: string; partnerName: string; invoiceNumber: string; commissionAmount: number; createdAt: string }[];
  };
  partners: { id: number; name: string; username: string; type: string; profitShare: { company: number; partner: number }; walletBalance: number; vehicleCount: number }[];
  monthlyLedger: { month: string; byType: Record<string, number> }[];
}

export interface ProfileData {
  id: number;
  username: string;
  name: string;
  isOwner: boolean;
  roles: { name: string; slug: string }[];
  warehouse: { name: string; city: string | null } | null;
  partner: {
    id: number;
    type: "MARKETING" | "VEHICLE_OWNER";
    profitShare: { company: number; partner: number };
    bank: { bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null };
  } | null;
}
