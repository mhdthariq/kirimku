import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, hasPermission, type AuthUser } from "@/lib/auth";
import { ensureRbac } from "@/lib/rbac";
import { ensureSeed } from "@/lib/seed";

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
  message?: string;
}

export function ok<T>(data: T, meta?: Record<string, unknown>): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) });
}

export function fail(status: number, message: string, errors?: Record<string, string[]>): NextResponse {
  return NextResponse.json({ message, ...(errors ? { errors } : {}) }, { status });
}

export class HttpError extends Error {
  status: number;
  errors?: Record<string, string[]>;
  constructor(status: number, message: string, errors?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/** Guard: boots RBAC + demo data, resolves the session, enforces a permission. */
export async function guard(
  req: NextRequest,
  permission?: string,
): Promise<AuthUser> {
  await ensureRbac();
  await ensureSeed();
  const user = await getAuthUser(req);
  if (!user) throw new HttpError(401, "Unauthenticated.");
  if (permission && !hasPermission(user, permission)) {
    throw new HttpError(403, `Missing permission: ${permission}`);
  }
  return user;
}

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message, error.errors);
    console.error("[api] unhandled error", error);
    return fail(500, "Internal server error.");
  }
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function requireStr(value: unknown, field: string): string {
  const s = str(value);
  if (!s) throw new HttpError(422, `The ${field} field is required.`, { [field]: ["The " + field + " field is required."] });
  return s;
}

export function requireNum(value: unknown, field: string, min?: number): number {
  const n = num(value);
  if (n == null || (min != null && n < min)) {
    throw new HttpError(422, `The ${field} field must be a valid number${min != null ? ` ≥ ${min}` : ""}.`, {
      [field]: [`The ${field} field must be a valid number${min != null ? ` >= ${min}` : ""}.`],
    });
  }
  return n;
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

export function dateOrNull(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Case-insensitive `contains` filter that works on BOTH SQLite and PostgreSQL.
 *
 * Why: SQLite's LIKE is case-insensitive by default, but PostgreSQL's LIKE is
 * case-sensitive. On Postgres we must add `mode: "insensitive"` to keep the
 * same search behaviour (e.g. searching "b 9455" still matches "B 9455 KTB").
 * `mode` is not supported by the SQLite connector, so it is only included
 * when DATABASE_URL points at a Postgres family database.
 *
 * Usage: `{ vehicleNumber: ci(search) }` instead of `{ vehicleNumber: { contains: search } }`.
 */
export function ci(value: string): { contains: string; mode?: "insensitive" } {
  const url = process.env.DATABASE_URL ?? "";
  const isPostgres =
    url.startsWith("postgres://") ||
    url.startsWith("postgresql://") ||
    url.startsWith("postgis://");
  return isPostgres ? { contains: value, mode: "insensitive" } : { contains: value };
}
