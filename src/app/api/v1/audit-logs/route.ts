import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str, num } from "@/lib/api-helpers";
import { filterAuditEntriesForScope, scopeForUser } from "@/lib/gudang-scope";

/**
 * Audit timeline. Supports per-menu filtering via ?entityType=customer|shipment|...
 * so every menu can render its own activity log panel.
 * Gudang data separation: entries about gudang-scoped entities (shipment,
 * pickup, delivery, transport, payment, …) are only visible to the gudang
 * they belong to — only the owner sees entries across all gudang.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req, "audit_log.view");
    const scope = await scopeForUser(user);
    const params = req.nextUrl.searchParams;
    const entityType = str(params.get("entityType"));
    const action = str(params.get("action"));
    const actorId = num(params.get("actorId"));
    const search = str(params.get("search"))?.toLowerCase();
    const limit = Math.min(500, Math.max(1, num(params.get("limit")) ?? 100));
    const offset = Math.max(0, num(params.get("offset")) ?? 0);

    const where = {
      ...(entityType ? { entityType } : {}),
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(search
        ? {
            OR: [
              { entityLabel: { contains: search } },
              { action: { contains: search } },
              { actor: { name: { contains: search } } },
            ],
          }
        : {}),
    };

    // Over-fetch when scoped so filtering to the user's gudang still fills
    // the page (scoped visibility is computed per entry afterwards).
    const logs = await db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: scope.unscoped ? limit : Math.min(500, limit + offset),
      ...(scope.unscoped ? { skip: offset } : {}),
      include: { actor: true },
    });

    let visible = logs;
    if (!scope.unscoped) {
      const flags = await filterAuditEntriesForScope(logs, scope);
      visible = logs.filter((_, i) => flags[i]).slice(offset, offset + limit);
    }
    const total = scope.unscoped
      ? await db.auditLog.count({ where })
      : visible.length;

    const [entityTypes, actions] = await Promise.all([
      db.auditLog.groupBy({ by: ["entityType"] }),
      db.auditLog.groupBy({ by: ["action"] }),
    ]);

    return ok(
      visible.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        entityLabel: l.entityLabel,
        actorName: l.actor?.name ?? "System",
        actorUsername: l.actor?.username ?? null,
        beforeData: l.beforeData ? safeParse(l.beforeData) : null,
        afterData: l.afterData ? safeParse(l.afterData) : null,
        createdAt: l.createdAt,
      })),
      {
        total,
        limit,
        offset,
        entityTypes: entityTypes.map((e) => e.entityType).filter((t): t is string => Boolean(t)).sort(),
        actions: actions.map((a) => a.action).sort(),
      },
    );
  });
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
