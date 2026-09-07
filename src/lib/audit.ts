import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: number | null;
  entityLabel?: string | null;
  actor?: AuthUser | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only audit logging. Never throws into the request path. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        actorId: input.actor?.id ?? null,
        beforeData: input.before == null ? null : JSON.stringify(input.before),
        afterData: input.after == null ? null : JSON.stringify(input.after),
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", error);
  }
}

/** Compact diff of changed fields for `updated` actions. */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  if (!before) return {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = after[key];
    const b = before[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { before: b, after: a };
  }
  return changes;
}
