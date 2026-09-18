/**
 * Corporate ID (license) verification.
 *
 * KirimKu is multi-tenant: every company using the app has its own
 * PostgreSQL database. Before we can log a user in (or serve any API
 * request) we need to know WHICH database to talk to. That mapping lives on
 * a central license server (portal.kaminova.id) — given a "Corporate ID"
 * (KdCustomer) it tells us the DB host/name/credentials to use, whether the
 * license is active, and the customer's display name.
 *
 * This module wraps that lookup:
 *  - `checkCorporateLicense()` calls the external API (POST, header-based
 *    auth) and normalizes the response.
 *  - Results are cached briefly in-memory so we don't hit the license
 *    server on every single request (every page load fires a dozen+ API
 *    calls, each of which needs to resolve the tenant).
 *  - `buildTenantConnectionUrl()` turns the license payload into a
 *    PostgreSQL connection string Prisma can use.
 *
 * NOTE on field mapping: the license API returns both a top-level
 * Server/Db/Username/Password group and a separate CredentialServer/
 * CredentialUsername/CredentialPassword group. We use the top-level
 * Server/Db/Username/Password fields as the Postgres connection info, per
 * the mapping requested when this feature was built. If your license
 * server actually intends the "Credential*" fields for the database
 * connection instead, adjust `extractDbFields()` below — everything else
 * in this file is agnostic to that choice.
 */

// ---------------------------------------------------------------------------
// Config (env-overridable; defaults match the Nova Logistik license server)
// ---------------------------------------------------------------------------

const LICENSE_API_URL =
  process.env.LICENSE_API_URL;
const LICENSE_API_KEY = process.env.LICENSE_API_KEY;
const LICENSE_API_TOKEN = process.env.LICENSE_API_TOKEN;
const LICENSE_APLIKASI = process.env.LICENSE_APLIKASI;

/** How long a successful lookup is trusted before we re-check the license
 *  server. Keeps every page load from re-hitting the external API while
 *  still picking up NonAktif / due-date changes reasonably quickly. */
const CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LicenseData {
  trxId: string;
  corpId: string;
  companyName: string;
  isActive: boolean;
  aplikasi: string;
  maxLisensi: number | null;
  dueDate: string | null;
  maintenance: boolean;
  maxCabang: number | null;
  /** Raw connection fields from the license server (before validation). */
  server: string | null;
  dbName: string | null;
  dbUsername: string | null;
  dbPassword: string | null;
}

export class LicenseError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 422, code = "LICENSE_ERROR") {
    super(message);
    this.name = "LicenseError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: LicenseData;
  expiresAt: number;
}

const g = globalThis as unknown as { __licenseCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = g.__licenseCache ?? new Map();
if (process.env.NODE_ENV !== "production") g.__licenseCache = cache;

function clean(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === "" || s === "-") return null;
  return s;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function fetchLicense(corpId: string): Promise<LicenseData> {
  const params = new URLSearchParams({ KdCustomer: corpId, Aplikasi: LICENSE_APLIKASI });

  let res: Response;
  try {
    res = await fetch(`${LICENSE_API_URL}?${params.toString()}`, {
      method: "POST",
      headers: {
        Key: LICENSE_API_KEY,
        Token: LICENSE_API_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
      cache: "no-store",
    });
  } catch {
    throw new LicenseError(
      "Tidak dapat menghubungi server lisensi. Periksa koneksi internet server dan coba lagi.",
      503,
      "NETWORK_ERROR",
    );
  }

  if (!res.ok) {
    throw new LicenseError(
      `Server lisensi mengembalikan error (HTTP ${res.status}).`,
      502,
      "UPSTREAM_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new LicenseError("Respons server lisensi tidak valid.", 502, "UPSTREAM_ERROR");
  }

  const body = payload as {
    Status?: string;
    Message?: string;
    Data?: Record<string, unknown>;
  };

  if (!body || body.Status !== "Ok" || !body.Data) {
    throw new LicenseError(
      body?.Message || "Corporate ID tidak ditemukan.",
      404,
      "NOT_FOUND",
    );
  }

  const d = body.Data;
  return {
    trxId: String(d.TrxId ?? ""),
    corpId: String(d.KdCustomer ?? corpId).trim(),
    companyName: String(d.NamaCustomer ?? "").trim() || corpId,
    isActive: String(d.NonAktif ?? "F").trim().toUpperCase() !== "T",
    aplikasi: String(d.Aplikasi ?? LICENSE_APLIKASI),
    maxLisensi: numOrNull(d.MaxLisensi),
    dueDate: clean(d.DueDate),
    maintenance: String(d.Maintenance ?? "F").trim().toUpperCase() === "T",
    maxCabang: numOrNull(d.MaxCabang),
    server: clean(d.Server),
    dbName: clean(d.Db),
    dbUsername: clean(d.Username),
    dbPassword: clean(d.Password),
  };
}

function numOrNull(value: unknown): number | null {
  const cleaned = clean(value);
  if (cleaned == null) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve + validate a Corporate ID against the license server.
 * Throws LicenseError when the corp id is unknown, inactive, expired, or the
 * license server can't be reached and there's no usable cached result.
 */
export async function checkCorporateLicense(corpIdRaw: string): Promise<LicenseData> {
  const corpId = corpIdRaw.trim();
  if (!corpId) throw new LicenseError("Corporate ID wajib diisi.", 422, "MISSING_CORP_ID");
  const key = corpId.toUpperCase();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  let data: LicenseData;
  try {
    data = await fetchLicense(corpId);
  } catch (err) {
    // Stale-while-error: if the license server hiccups but we have an
    // earlier successful result, keep using it rather than taking the
    // whole tenant down over a transient network blip.
    if (cached) return cached.data;
    throw err;
  }

  validateLicense(data);
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

function validateLicense(data: LicenseData): void {
  if (!data.isActive) {
    throw new LicenseError(
      `Corporate ID "${data.corpId}" tidak aktif. Hubungi admin untuk mengaktifkan kembali.`,
      403,
      "INACTIVE",
    );
  }
  if (data.dueDate) {
    const due = new Date(data.dueDate);
    if (!Number.isNaN(due.getTime()) && due.getTime() < Date.now()) {
      throw new LicenseError(
        `Lisensi Corporate ID "${data.corpId}" telah berakhir pada ${data.dueDate}.`,
        403,
        "EXPIRED",
      );
    }
  }
}

/** Build a Postgres connection string from a validated license payload. */
export function buildTenantConnectionUrl(data: LicenseData): string {
  if (!data.server || !data.dbName) {
    throw new LicenseError(
      `Database belum disiapkan untuk Corporate ID "${data.corpId}". Hubungi admin.`,
      409,
      "NO_DATABASE",
    );
  }
  const hostPart = data.server.includes(":") ? data.server : `${data.server}:5432`;
  const user = encodeURIComponent(data.dbUsername || "postgres");
  const pass = encodeURIComponent(data.dbPassword || "");
  return `postgresql://${user}:${pass}@${hostPart}/${data.dbName}?schema=public`;
}
