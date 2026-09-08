import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, str, num } from "@/lib/api-helpers";

/**
 * Audit timeline. Supports per-menu filtering via ?entityType=customer|shipment|...
 * so every menu can render its own activity log panel.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    await guard(req, "audit_log.view");
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

    const [logs, total, entityTypes, actions] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: { actor: true },
      }),
      db.auditLog.count({ where }),
      db.auditLog.groupBy({ by: ["entityType"] }),
      db.auditLog.groupBy({ by: ["action"] }),
    ]);

    return ok(
      logs.map((l) => ({
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
