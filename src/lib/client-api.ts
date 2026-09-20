"use client";

/**
 * Typed API client for the /api/v1 backend. Token stored in localStorage,
 * Bearer auth, envelope handling, consistent error shape.
 */

const TOKEN_KEY = "kirimku_token";
const CORP_ID_KEY = "kirimku_corp_id";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Corporate ID entered at login — sent as the `x-corp-id` header on every
 *  request so the backend knows which company's database to use. */
export function getCorpId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CORP_ID_KEY);
}

export function setCorpId(corpId: string | null): void {
  if (typeof window === "undefined") return;
  if (corpId) window.localStorage.setItem(CORP_ID_KEY, corpId);
  else window.localStorage.removeItem(CORP_ID_KEY);
}

/** Error codes that mean "this Corporate ID session is no longer valid" —
 *  worth logging the user out for, same as an expired auth token. */
const CORP_SESSION_INVALID_CODES = new Set(["INACTIVE", "EXPIRED", "NOT_FOUND", "NO_DATABASE", "MISSING_CORP_ID"]);

export class ApiError extends Error {
  readonly status: number;
  readonly errors?: Record<string, string[]>;
  readonly code?: string;
  constructor(status: number, message: string, errors?: Record<string, string[]>, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const corpId = getCorpId();
  if (corpId) headers["x-corp-id"] = corpId;
  return headers;
}

/** Session became invalid (expired token or Corporate ID no longer valid) —
 *  clear local state and send the user back to the login screen. */
function invalidateSession(): void {
  if (typeof window === "undefined") return;
  setToken(null);
  window.location.reload();
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = authHeaders();

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

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; meta?: Record<string, unknown>; message?: string; errors?: Record<string, string[]>; code?: string }
    | null;

  if (response.status === 401 && typeof window !== "undefined" && getToken()) {
    invalidateSession();
  } else if (payload?.code && CORP_SESSION_INVALID_CODES.has(payload.code) && typeof window !== "undefined" && getToken()) {
    invalidateSession();
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ?? `Permintaan gagal (${response.status}).`,
      payload?.errors,
      payload?.code,
    );
  }
  return (payload?.data ?? undefined) as T;
}

/** Like apiGet but also exposes the envelope `meta` (pagination / filter options). */
export async function apiGetWithMeta<T>(path: string): Promise<{ data: T; meta: Record<string, unknown> | undefined }> {
  const headers = authHeaders();
  const response = await fetch(`/api/v1${path}`, { headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; meta?: Record<string, unknown>; message?: string; code?: string }
    | null;
  if (response.status === 401 && typeof window !== "undefined" && getToken()) {
    invalidateSession();
  } else if (payload?.code && CORP_SESSION_INVALID_CODES.has(payload.code) && typeof window !== "undefined" && getToken()) {
    invalidateSession();
  }
  if (!response.ok) {
    throw new ApiError(response.status, payload?.message ?? `Permintaan gagal (${response.status}).`, undefined, payload?.code);
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
  /** Marketing partner this customer is connected to ("customer connected
   *  to who") — drives the marketing data separation. */
  marketingPartnerId?: number | null;
  marketingPartnerName?: string | null;
  /** Revise round 7 — Gudang attachment. null = "umum" (general —
   *  visible to every gudang). When set, only that gudang's admin/staff
   *  see this customer in their customer list. */
  warehouseId?: number | null;
  warehouseName?: string | null;
}

export interface DetailShipment {
  id: number;
  detailCode: string;
  masterId: number;
  description: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  /** Revise round 11 — optional direct volume entry (m³). When set, used
   *  directly instead of computing L×W×H/1.000.000. */
  volumeM3?: number | null;
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
  /** warehouse display names — power the "shipment dari Gudang X" chips */
  originWarehouseName?: string | null;
  destinationWarehouseName?: string | null;
  arrivedWarehouseName?: string | null;
  /** Revise round 8 — Fulfillment Mode.
   *  - "STANDARD" = kurir → company warehouse → transport → destination warehouse → kurir delivery
   *  - "DIRECT"    = driver picks up directly at the origin warehouse and delivers directly to the destination warehouse
   *  Defaults to "STANDARD" on the server for rows created before this revision. */
  fulfillmentMode?: "STANDARD" | "DIRECT";
  /** when Admin Gudang scan-verified receipt at the destination gudang
   *  (transport drop-off). null + ARRIVED_AT_GUDANG = awaiting scan-in. */
  destReceivedAt?: string | null;
  /** gudang(s) this shipment currently belongs to — drives the owner's per-gudang tabs */
  gudangIds?: number[];
  penerimaName?: string | null;
  penerimaAddress?: string | null;
  penerimaContact?: string | null;
  /** Sender (pengirim) — auto-filled from the Customer record at creation but
   *  editable per-shipment so the resi can show a different contact. */
  pengirimName?: string | null;
  pengirimPhone?: string | null;
  pengirimEmail?: string | null;
  pengirimAddress?: string | null;
  tariffId?: number | null;
  tariff?: Tariff | null;
  pricingPreview?: PricingPreview | null;
  totals?: ShipmentTotals;
  paymentSummary?: PaymentSummary;
  chargeableWeightKg: number | null;
  ratePerKg: number | null;
  priceAmount: number | null;
  pricedAt: string | null;
  insuranceAmount: number;
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
  /** B2B Master Resi mode — a single Master Resi scan satisfies the whole shipment. */
  isB2B: boolean;
  /** True once at least one Master Resi scan is recorded. */
  masterScanned: boolean;
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
  /** Revise round 7 — Pickup address shown to the kurir so they know where
   *  to pick up the package. Sourced from MasterShipment.pengirimAddress
   *  (the per-shipment sender address the staff typed, which may differ
   *  from the customer's master DB record). */
  pickupAddress?: string | null;
  /** Sender contact phone — paired with pickupAddress so the kurir can
   *  call the customer on arrival. */
  pickupContact?: string | null;
  /** Sender name as typed into the shipment (for the kurir to ask for). */
  pickupSenderName?: string | null;
  /** Revise round 8 — pickup photo (proof of pickup). Display gated by
   *  proof_photo.view (Admin Gudang + Owner default). */
  photoUrl?: string | null;
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
  /** Free-text proof of delivery — typically the receiver's name as typed
   *  by the kurir at handover. NOT a photo. */
  proofOfDelivery: string | null;
  /** Revise round 8 — optional delivery photo (proof of delivery image).
   *  Display is gated by proof_photo.view (Admin Gudang + Owner default). */
  photoUrl?: string | null;
  createdAt: string;
  completedAt: string | null;
  masterCode: string;
  masterStatus: string;
  destination: string;
  /** where this shipment came from ("shipment dari Gudang A") */
  originWarehouseId?: number | null;
  originWarehouseName?: string | null;
  address: string | null;
  customerName: string;
  customerPhone: string | null;
  customerType?: string;
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
  /** Revise round 9 — physical cargo box dimensions in meters.
   *  When all three are set, maxVolumeM3 = L × W × H (computed on save). */
  lengthM?: number | null;
  widthM?: number | null;
  heightM?: number | null;
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
    /** warehouse names — power the dynamic "Arrived at {Gudang}" status label */
    arrivedWarehouseName: string | null;
    destinationWarehouseName: string | null;
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
  proofUrl: string | null;
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
  /** Revise round 10 — marketing partner's gudang alignment. null = umum. */
  partnerWarehouseId?: number | null;
  partnerWarehouseName?: string | null;
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
  vehicles: { id: number; vehicleNumber: string; name: string | null; maxWeightKg: number; maxVolumeM3?: number; lengthM?: number | null; widthM?: number | null; heightM?: number | null }[];
  routes: { id: number; name: string; origin: string | null; destination: string | null }[];
  warehouses: { id: number; code: string; name: string; city: string | null; customerSupportContact?: string | null }[];
  customers: { id: number; code: string; name: string; type: string; phone: string | null; email: string | null; address: string | null; marketingPartnerId?: number | null; warehouseId?: number | null; warehouseName?: string | null }[];
  tariffs: { id: number; origin: string; destination: string; customerType: string | null; ratePerKg: number; minChargeableKg: number; volumetricMultiplier: number; roundingMode: string; roundingUnitKg: number; effectiveFrom: string; effectiveTo: string | null }[];
  permissions: { id: number; slug: string; module: string; description: string | null }[];
  /** Revise.md §13 — vehicle-owner partners (vehicle ownership dropdown) */
  vehicleOwners?: { id: number; name: string; username: string; profitShare: { company: number; partner: number } }[];
  /** Marketing partners — "customer connected to who" dropdown (Customers page) */
  marketingPartners?: { id: number; name: string; username: string; warehouseId?: number | null; warehouseName?: string | null }[];
  /** Revise.md §7.1 — B2B shipments available for invoice line linking */
  b2bShipments?: { id: number; masterCode: string; priceAmount: number | null; finalPriceAmount: number | null; customerId: number; createdByPartnerId: number | null; origin: string; destination: string; invoiceLines: { invoice: { id: number; invoiceNumber: string; status: string } }[] }[];
}

/** Filter employees for a role-specific dropdown (Kurir / Driver / Kenek …).
 *  Falls back to the full list when no employee matches the position (legacy
 *  datasets without positions) so the dropdown never ends up empty. */
export function employeesByPosition(
  employees: { id: number; name: string; position: string | null; warehouseId: number | null }[],
  position: string,
): { id: number; name: string; position: string | null; warehouseId: number | null }[] {
  const needle = position.trim().toLowerCase();
  const matched = employees.filter(
    (e) => (e.position ?? "").trim().toLowerCase() === needle || (e.position ?? "").trim().toLowerCase().includes(needle),
  );
  return matched.length > 0 ? matched : employees;
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

/** Shipment that reached THIS gudang from ANOTHER gudang via transport and
 *  still awaits the Admin Gudang scan-in (destReceivedAt is null). */
export interface GudangTransportArrivalItem {
  id: number;
  masterCode: string;
  customerName: string;
  customerPhone: string | null;
  origin: string;
  destination: string;
  originWarehouseId: number | null;
  destinationWarehouseId: number | null;
  arrivedWarehouseId: number | null;
  /** "This shipment is from Gudang X" — the origin branch it departed from */
  originWarehouseName: string | null;
  transportCode: string | null;
  driverName: string | null;
  kenekName: string | null;
  penerimaName: string | null;
  detailsCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  scannedCount: number;
  updatedAt: string;
}

export interface GudangContentShipment {
  id: number;
  masterCode: string;
  customerName: string;
  status: string;
  stage: string;
  /** destination-stage rows: the origin gudang this shipment came from */
  originWarehouseName?: string | null;
  /** scan-verified receipt time at the destination gudang (transport drop-off) */
  destReceivedAt?: string | null;
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
  transportArrivals: GudangTransportArrivalItem[];
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

export interface DashboardApprovalItem {
  id: number;
  requestCode?: string;
  amount: number;
  partnerName: string;
  partnerType?: string;
  submittedAt?: string;
  createdAt?: string;
  // topup
  proofUrl?: string | null;
  // withdrawal
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  // payment
  method?: string;
  reference?: string | null;
  masterCode?: string;
  customerName?: string;
  recordedByName?: string;
  // commission
  commissionCode?: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
}

export interface DashboardApprovals {
  pendingTopups: DashboardApprovalItem[];
  pendingWithdrawals: DashboardApprovalItem[];
  pendingPayments: DashboardApprovalItem[];
  pendingCommissions: DashboardApprovalItem[];
}

export interface DashboardPermissions {
  canVerifyTopup: boolean;
  canApproveWithdrawal: boolean;
  canReviewWithdrawal: boolean;
  canVerifyPayment: boolean;
  canReleaseCommission: boolean;
}

/** Marketing-specific dashboard extras — own wallet & commission pipeline. */
export interface MarketingDashboardSnapshot {
  wallet: { balance: number; reserved: number; available: number };
  pendingCommission: number;
  releasedCommission: number;
  recentCommissions: {
    id: number;
    commissionCode: string;
    status: string;
    amount: number;
    invoiceNumber: string;
    invoiceStatus: string;
    customerName: string;
    createdAt: string;
  }[];
  recentTransactions: {
    id: number;
    type: string;
    amount: number;
    direction: string;
    description: string | null;
    businessRef: string;
    createdAt: string;
  }[];
  pendingWithdrawals: {
    id: number;
    requestCode: string;
    amount: number;
    status: string;
    createdAt: string;
  }[];
}

/** Gudang workspace surfaced inside the dashboard for admin/staff gudang. */
export interface GudangDashboardWorkspace {
  scope: { warehouseId: number | null; warehouseName: string | null; scoped: boolean };
  arrivals: {
    id: number;
    masterCode: string;
    customerName: string;
    origin: string;
    destination: string;
    detailsCount: number;
    scannedCount: number;
    pickupCode: string | null;
    kurirName: string | null;
    updatedAt: string;
  }[];
  transportArrivals: {
    id: number;
    masterCode: string;
    customerName: string;
    origin: string;
    destination: string;
    originWarehouseName: string | null;
    transportCode: string | null;
    driverName: string | null;
    detailsCount: number;
    scannedCount: number;
    updatedAt: string;
  }[];
  walkIns: {
    id: number;
    masterCode: string;
    customerName: string;
    origin: string;
    destination: string;
    status: string;
    detailsCount: number;
    totalWeightKg: number;
  }[];
  heldSummary: {
    warehouseId: number;
    warehouseName: string;
    city: string | null;
    heldShipments: number;
    heldPackages: number;
    heldWeightKg: number;
    unpaidCount: number;
  }[];
}

export interface DashboardData {
  role: "owner" | "admin-kantor" | "marketing" | "admin-gudang" | "staff-gudang";
  permissions: DashboardPermissions;
  period: { from: string; to: string; days: number };
  approvals: DashboardApprovals;
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
  /** Present only for Marketing partners — own wallet & commission pipeline. */
  marketing: MarketingDashboardSnapshot | null;
  /** Present for owner / admin-gudang / staff-gudang — gudang scan queue. */
  gudang: GudangDashboardWorkspace | null;
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
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED" | "CANCELLED";
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
  /** Simplified flow — records are final (VERIFIED) the moment an
   *  authorized user creates them; no approval workflow. */
  status: "VERIFIED";
  /** Net amount currently deducted from the owner wallet for this repair. */
  deductedAmount: number;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  vehicle: { id: number; vehicleNumber: string; name: string | null };
  owner?: { user: { name: string } } | null;
}

/** Append-only repair action log — visible to the Vehicle Owner (own
 *  vehicles) and the company (repair.view). Survives repair deletion. */
export interface RepairActionLogRow {
  id: number;
  repairId: number;
  repairCode: string;
  ownerId: number;
  vehicleNumber: string;
  action: "CREATED" | "UPDATED" | "DELETED";
  detail: string | null;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  amount: number | null;
  actorId: number | null;
  actorName: string | null;
  createdAt: string;
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
  /** Revise round 7 — Partner Alignment. null = "umum" (general). */
  warehouseId?: number | null;
  warehouseName?: string | null;
  wallet: { balance: number; reserved: number; available: number };
  totals: { transportEarnings: number; commissions: number; repairDeductions: number; withdrawals: number };
  /** Combined earnings breakdown — shipment commission + transport profit share. */
  earningsSummary: { shipment: number; transport: number; total: number };
  counts: { vehicles: number; commissions: number; settlements: number; topUps: number; withdrawals: number; repairs: number };
}

export interface VehicleOwnerDashboard {
  wallet: { balance: number; reserved: number; available: number };
  totals: { earnings: number; transportCount: number; repairDeductions: number; withdrawals: number; pendingWithdrawals: number };
  vehicles: { id: number; vehicleNumber: string; name: string | null; status: string; maxWeightKg: number; maxVolumeM3: number }[];
  vehicleStatusBreakdown: Record<string, number>;
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
  recentRepairLogs: RepairActionLogRow[];
  /** Full list of the partner's own repair records (not just action log). */
  repairs: {
    id: number;
    repairCode: string;
    vehicleId: number;
    description: string;
    amount: number;
    repairDate: string;
    workshopVendor: string | null;
    proofUrl: string | null;
    notes: string | null;
    status: string;
    deductedAmount: number;
    verifiedAt: string | null;
    createdAt: string;
    vehicle: { id: number; vehicleNumber: string; name: string | null };
  }[];
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
    /** Revision 6 — invoice payments (full + partial) are realized company
     *  profit the moment they're received. */
    realizedInvoicePayments: number;
    settledInvoicePayments: number;
    partialInvoicePayments: number;
  };
  pending: {
    topUps: { id: number; requestCode: string; partnerName: string; partnerType: string; amount: number; status: string; createdAt: string }[];
    withdrawals: { id: number; requestCode: string; partnerName: string; partnerType: string; amount: number; status: string; bankName: string | null; bankAccountNumber: string | null; createdAt: string }[];
    repairs: { id: number; repairCode: string; vehicleNumber: string; ownerName: string; amount: number; status: string; createdAt: string }[];
    commissions: { id: number; commissionCode: string; partnerName: string; invoiceNumber: string; commissionAmount: number; createdAt: string }[];
  };
  partners: { id: number; name: string; username: string; type: string; profitShare: { company: number; partner: number }; walletBalance: number; vehicleCount: number }[];
  /** Revision 6 — explicit invoice payment profit (incl. partial). */
  invoicePayments?: {
    realized: number;
    settledTotal: number;
    partialTotal: number;
    recent: {
      id: number;
      amount: number;
      method: string;
      reference: string | null;
      hasProof: boolean;
      settledAt: string;
      invoiceNumber: string;
      invoiceStatus: string;
      customerName: string;
    }[];
    byMonth: { month: string; settled: number; partial: number }[];
  };
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
