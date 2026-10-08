import { NextRequest } from "next/server";
import { db } from "@/infrastructure/persistence/db";
import { guard, ok, handle } from "@/composition/api-helpers";

/**
 * GET /api/v1/capacity/trend — capacity-config change frequency over the last
 * `days` days (default 14). Returns one bucket per day with the count of
 * vehicle audit entries whose `after.capacityConfigChanged` is true.
 *
 * Used by the dashboard's capacity trend mini-chart (recharts). Informational.
 * Gated on `vehicle.view`.
 */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    await guard(req, "vehicle.view");
    const params = req.nextUrl.searchParams;
    const days = Math.min(90, Math.max(7, Number(params.get("days")) || 14));
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));

    const logs = await db.auditLog.findMany({
      where: { entityType: "vehicle", createdAt: { gte: from } },
      select: { afterData: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const buckets: { date: string; label: string; count: number }[] = [];
    const dayMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, 0);
      buckets.push({ date: key, label: d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }), count: 0 });
    }
    for (const l of logs) {
      let after: Record<string, unknown> | null = null;
      try {
        after = l.afterData ? JSON.parse(l.afterData as unknown as string) : null;
      } catch {
        after = null;
      }
      if (after && after.capacityConfigChanged) {
        const key = l.createdAt.toISOString().slice(0, 10);
        if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
      }
    }
    for (const b of buckets) b.count = dayMap.get(b.date) ?? 0;

    return ok({ buckets, total: buckets.reduce((s, b) => s + b.count, 0) });
  });
}
