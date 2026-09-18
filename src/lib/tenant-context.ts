import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { checkCorporateLicense, buildTenantConnectionUrl } from "@/lib/license";

/** Header the client sends on every request once a Corporate ID has been
 *  entered at login. Absent = "default" (single-tenant / local dev / demo)
 *  mode, which keeps the app working exactly as before for anyone not
 *  using the corporate multi-tenant flow. */
export const CORP_ID_HEADER = "x-corp-id";

export const DEFAULT_TENANT_KEY = "__default__";

/**
 * Dev-mode flag. In `next dev` (NODE_ENV === "development") the app is
 * being used to push database schema with Prisma against the regular
 * DATABASE_URL — there is no license server involved, no per-tenant
 * database, and the Corporate ID field on the login screen is hidden.
 * In production (after `next build`), the app expects a Corporate ID
 * at login, validates it against the license server, and connects to
 * that company's own database.
 */
export const IS_DEV_MODE = process.env.NODE_ENV !== "production";

export interface TenantContext {
  /** null in default/local mode */
  corpId: string | null;
  companyName: string | null;
  dueDate: string | null;
  prisma: PrismaClient;
}

const als = new AsyncLocalStorage<TenantContext>();

// ---------------------------------------------------------------------------
// Prisma client registry — one client per resolved connection string,
// reused across requests (and across the corp id it belongs to) so we don't
// open a fresh pool of Postgres connections on every API call.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  __defaultPrisma?: PrismaClient;
  __tenantPrismaClients?: Map<string, PrismaClient>;
};

/** The client used when no Corporate ID is supplied — talks to whatever
 *  DATABASE_URL is set in the environment, exactly like before this feature
 *  existed. */
export const defaultClient: PrismaClient = g.__defaultPrisma ?? new PrismaClient({ log: ["query"] });
if (process.env.NODE_ENV !== "production") g.__defaultPrisma = defaultClient;

const tenantClients: Map<string, PrismaClient> = g.__tenantPrismaClients ?? new Map();
if (process.env.NODE_ENV !== "production") g.__tenantPrismaClients = tenantClients;

function getOrCreateTenantClient(connectionUrl: string): PrismaClient {
  let client = tenantClients.get(connectionUrl);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url: connectionUrl } } });
    tenantClients.set(connectionUrl, client);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Request-scoped context
// ---------------------------------------------------------------------------

/** Resolve which tenant (and therefore which Prisma client) a request
 *  belongs to, based on the `x-corp-id` header. Throws LicenseError (via
 *  checkCorporateLicense) when a Corporate ID is present but invalid.
 *
 *  In dev mode (`next dev`, NODE_ENV !== "production") the license check
 *  is bypassed entirely and the default DATABASE_URL client is always
 *  used — this lets developers push schema with Prisma and log in with
 *  the demo accounts without needing a license server. */
export async function resolveTenantContext(headers: {
  get(name: string): string | null;
}): Promise<TenantContext> {
  const corpId = headers.get(CORP_ID_HEADER)?.trim() || null;

  // Dev mode: always use the regular DATABASE_URL. The Corporate ID is
  // not collected on the login screen in dev mode, but even if a stale
  // value arrives (e.g. leftover header in a long-lived browser tab),
  // we ignore it so dev sessions never break on a license lookup.
  if (IS_DEV_MODE) {
    return { corpId: null, companyName: null, dueDate: null, prisma: defaultClient };
  }

  if (!corpId) {
    return { corpId: null, companyName: null, dueDate: null, prisma: defaultClient };
  }
  const license = await checkCorporateLicense(corpId);
  const url = buildTenantConnectionUrl(license);
  const prisma = getOrCreateTenantClient(url);
  return { corpId: license.corpId, companyName: license.companyName, dueDate: license.dueDate, prisma };
}

/** Runs `fn` with the given tenant active for every `db.*` call made
 *  (directly or transitively) during its execution. */
export function runWithTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getCurrentTenant(): TenantContext | undefined {
  return als.getStore();
}

/** Stable per-tenant cache key — use this instead of the raw corpId when
 *  memoizing something (e.g. "has RBAC been bootstrapped for this DB yet"). */
export function tenantKey(): string {
  return getCurrentTenant()?.corpId ?? DEFAULT_TENANT_KEY;
}

export function isDefaultTenant(): boolean {
  return tenantKey() === DEFAULT_TENANT_KEY;
}

/** Tenant's display name (from the license server's NamaCustomer), or null
 *  in default mode / before login. Callers should fall back to
 *  NEXT_PUBLIC_COMPANY_NAME / the hardcoded default. */
export function currentCompanyName(): string | null {
  return getCurrentTenant()?.companyName ?? null;
}
