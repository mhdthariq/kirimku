import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { checkCorporateLicense, buildTenantConnectionUrl } from "@/lib/license";
import { IS_DEV, PREVIEW_CORP_ID, RUNTIME_MODE } from "@/lib/runtime-mode";

/** Header the client sends on every request once a Corporate ID has been
 *  entered at login. Absent = "default" (single-tenant / local dev / demo)
 *  mode, which keeps the app working exactly as before for anyone not
 *  using the corporate multi-tenant flow. */
export const CORP_ID_HEADER = "x-corp-id";

export const DEFAULT_TENANT_KEY = "__default__";

/**
 * Runtime mode (Revise round 7). The app now has THREE modes instead of
 * two:
 *
 *   - `development` (NODE_ENV !== "production") — license check bypassed,
 *     Corporate ID hidden on the login screen, demo accounts visible.
 *   - `preview`     (NODE_ENV === "production" && PREVIEW_MODE === "true")
 *                   — a compiled build that still shows the demo account
 *                   quick-fill panel BUT also routes every request through
 *     the license server (just like production). The Corporate ID field
 *     is pre-filled with the constant `PREVIEW_CORP_ID` (default "TRIAL")
 *     but the user can override it before login.
 *   - `production`   (NODE_ENV === "production" otherwise) — the original
 *                   strict multi-tenant mode: Corporate ID required, demo
 *                   accounts hidden.
 *
 * Use `IS_DEV` from `runtime-mode.ts` for the "should we bypass the
 * license check?" branch below — it correctly returns false for both
 * Preview and Production, so both compiled modes route through the
 * license server.
 */
export { IS_DEV, IS_PREVIEW, IS_PROD, RUNTIME_MODE, PREVIEW_CORP_ID } from "@/lib/runtime-mode";

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
function buildDefaultClient(): PrismaClient {
  return new PrismaClient({ log: ["query"] });
}
export const defaultClient: PrismaClient = g.__defaultPrisma ?? buildDefaultClient();
if (IS_DEV) g.__defaultPrisma = defaultClient;

const tenantClients: Map<string, PrismaClient> = g.__tenantPrismaClients ?? new Map();
if (IS_DEV) g.__tenantPrismaClients = tenantClients;

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
  //
  // Preview and Production both route through the license server —
  // the difference is purely a UI/login-screen concern (Preview pre-fills
  // the Corporate ID with PREVIEW_CORP_ID = "TRIAL" by default).
  if (IS_DEV) {
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
