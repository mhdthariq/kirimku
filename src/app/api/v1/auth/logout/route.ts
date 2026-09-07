import { NextRequest } from "next/server";
import { destroySession, getTokenFromRequest, getAuthUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, handle } from "@/lib/api-helpers";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const token = getTokenFromRequest(req);
    const user = token ? await getAuthUser(req) : null;
    if (token) await destroySession(token).catch(() => undefined);
    if (user) await audit({ action: "logout", entityType: "auth", entityLabel: user.username, actor: user });
    return ok({ success: true });
  });
}
