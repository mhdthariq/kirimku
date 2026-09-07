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
  quantity: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  actualWeightKg: number;
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
  chargeableWeightKg: number | null;
  ratePerKg: number | null;
  priceAmount: number | null;
  pricedAt: string | null;
  createdAt: string;
  details?: DetailShipment[];
  _count?: { details: number; pickups: number; deliveries: number; payments: number };
  trackingEvents?: { id: number; event: string; description: string | null; occurredAt: string; actor?: { name: string } | null }[];
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
  quantity: number;
  scanned: boolean;
  scannedAt: string | null;
  scannedByName: string | null;
}

export interface ScanProgress {
  total: number;
  scanned: number;
  allScanned: boolean;
  details: ScanDetailState[];
}

export interface ScanResponse {
  scan: { id: number; payload: string; result: string; scanLevel: string; detailId: number | null; scannedAt: string };
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
  details: { id: number; detailCode: string; description: string; quantity: number; scanned: boolean }[];
}

export interface Vehicle {
  id: number;
  vehicleNumber: string;
  name: string | null;
  status: string;
  maxWeightKg: number;
  maxVolumeM3: number;
  notes: string | null;
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
  driverName: string | null;
  kenekName: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  createdAt: string;
  shipments: { id: number; masterCode: string; status: string }[];
  checkpointRecordsCount: number;
}

export interface Tariff {
  id: number;
  origin: string;
  destination: string;
  customerType: string | null;
  ratePerKg: number;
  minChargeableKg: number;
  volumetricDivisor: number;
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
  employees: { id: number; name: string; position: string | null }[];
  vehicles: { id: number; vehicleNumber: string; name: string | null; maxWeightKg: number }[];
  routes: { id: number; name: string; origin: string | null; destination: string | null }[];
  warehouses: { id: number; code: string; name: string; city: string | null }[];
  customers: { id: number; code: string; name: string; type: string }[];
  tariffs: { id: number; origin: string; destination: string; customerType: string | null; ratePerKg: number }[];
  permissions: { id: number; slug: string; module: string; description: string | null }[];
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
