import { PrismaClient } from '@prisma/client'
import { getCurrentTenant, defaultClient } from '@/lib/tenant-context'

/**
 * `db` used to be a single global PrismaClient. It's now a thin proxy that,
 * on every property access, forwards to whichever tenant's PrismaClient is
 * active for the current request (see tenant-context.ts). Call sites don't
 * need to change — `db.user.findMany(...)` etc. all keep working as before;
 * they just transparently hit the right company's database.
 *
 * Outside of a request (scripts, seeding without a tenant context, etc.)
 * this resolves to `defaultClient`, i.e. the DATABASE_URL from the
 * environment — identical to the old behaviour.
 */
function currentClient(): PrismaClient {
  return getCurrentTenant()?.prisma ?? defaultClient
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = currentClient() as unknown as Record<string | symbol, unknown>
    const value = client[prop as keyof typeof client]
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value
  },
}) as PrismaClient
