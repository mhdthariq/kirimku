import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guard, ok, handle, fail, str, num } from "@/lib/api-helpers";

/**
 * GET /api/v1/repairs/logs — repair action log feed.
 *
 * Two views over the same append-only RepairActionLog table:
 *   · Vehicle Owner (repair.view_own): only logs for their own vehicles —
 *     they see when a record was created, changed, or deleted, by whom.
 *   · Company (repair.view): the full feed across all Vehicle Owners.
 *
 * Query params:
 *   ?repairId=…  — per-item history (used by the detail dialog log)
 *   ?action=…    — CREATED | UPDATED | DELETED filter
 *   ?limit=…     — page size (default 50, max 200)
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const params = req.nextUrl.searchParams;
    const repairId = num(params.get("repairId"));
    const action = str(params.get("action"));
    const limit = Math.min(200, Math.max(1, num(params.get("limit")) ?? 50));

    const isVehicleOwner = user.partnerType === "VEHICLE_OWNER" && user.partnerId;
    if (!isVehicleOwner && !user.isOwner && !user.permissions.includes("repair.view")) {
      return fail(403, "Missing permission: repair.view");
    }

    const where = {
      ...(isVehicleOwner ? { ownerId: user.partnerId! } : {}),
      ...(repairId != null ? { repairId } : {}),
      ...(action ? { action } : {}),
    };

    const [logs, total] = await Promise.all([
      db.repairActionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.repairActionLog.count({ where }),
    ]);

    return ok(
      logs.map((l) => ({
        id: l.id,
        repairId: l.repairId,
        repairCode: l.repairCode,
        ownerId: l.ownerId,
        vehicleNumber: l.vehicleNumber,
        action: l.action,
        detail: l.detail,
        changes: l.changes ? safeParse(l.changes) : null,
        amount: l.amount,
        actorId: l.actorId,
        actorName: l.actorName,
        createdAt: l.createdAt,
      })),
      { total, limit },
    );
  });
}

function safeParse(json: string): Record<string, { before: unknown; after: unknown }> | null {
  try {
    return JSON.parse(json) as Record<string, { before: unknown; after: unknown }>;
  } catch {
    return null;
  }
}
