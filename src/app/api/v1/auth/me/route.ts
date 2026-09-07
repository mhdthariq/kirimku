import { NextRequest } from "next/server";
import { guard, ok, handle } from "@/lib/api-helpers";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await guard(req);
    return ok(user);
  });
}
