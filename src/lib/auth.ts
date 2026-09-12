import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";
import { db } from "@/lib/db";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Password hashing (scrypt — no external dependency required)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  isOwner: boolean;
  isActive: boolean;
  employeeId: number | null;
  /** gudang the user's employee belongs to (null when unbound / owner) */
  warehouseId: number | null;
  /** display name of the user's gudang */
  warehouseName: string | null;
  /** partner profile when the user is a Marketing / Vehicle Owner partner */
  partnerId: number | null;
  partnerType: "MARKETING" | "VEHICLE_OWNER" | null;
  roles: { id: number; slug: string; name: string }[];
  permissions: string[];
}

const SESSION_HOURS = 12;

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.sessionToken.create({ data: { token: tokenHash, userId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.sessionToken.deleteMany({ where: { token: tokenHash } });
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await db.sessionToken.findUnique({
    where: { token: tokenHash },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          employee: { include: { warehouse: true } },
          partner: true,
        },
      },
    },
  });
  if (!session || session.expiresAt < new Date()) {
    if (session) await db.sessionToken.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const user = session.user;
  if (!user.isActive) return null;
  const roles = user.roles.map((ur) => ({
    id: ur.role.id,
    slug: ur.role.slug,
    name: ur.role.name,
  }));
  const permissions = user.isOwner
    ? ["*"]
    : Array.from(
        new Set(
          user.roles.flatMap((ur) =>
            ur.role.permissions.map((rp) => rp.permission.slug),
          ),
        ),
      );
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    isOwner: user.isOwner,
    isActive: user.isActive,
    employeeId: user.employeeId,
    warehouseId: user.employee?.warehouseId ?? null,
    warehouseName: user.employee?.warehouse?.name ?? null,
    partnerId: user.partner?.id ?? null,
    partnerType: (user.partner?.type as "MARKETING" | "VEHICLE_OWNER" | undefined) ?? null,
    roles,
    permissions,
  };
}

export function hasPermission(user: AuthUser | null, permission: string): boolean {
  if (!user) return false;
  if (user.isOwner) return true;
  if (user.permissions.includes("*")) return true;
  return user.permissions.includes(permission);
}
