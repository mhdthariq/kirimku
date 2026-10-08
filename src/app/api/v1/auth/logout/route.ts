import { NextRequest } from "next/server";
import { destroySession, getTokenFromRequest, getAuthUser } from "@/infrastructure/auth/auth";
import { audit } from "@/infrastructure/services/audit";
import { ok, handle } from "@/composition/api-helpers";

export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const token = getTokenFromRequest(req);
    const user = token ? await getAuthUser(req) : null;
    if (token) await destroySession(token).catch(() => undefined);
    if (user) await audit({ action: "logout", entityType: "auth", entityLabel: user.username, actor: user });
    return ok({ success: true });
  });
}
