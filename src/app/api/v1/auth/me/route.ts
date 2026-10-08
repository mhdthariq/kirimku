import { NextRequest } from "next/server";
import { guard, ok, handle } from "@/composition/api-helpers";
import { currentCompanyName } from "@/infrastructure/persistence/tenant-context";

export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const user = await guard(req);
    const company = { name: currentCompanyName() ?? process.env.NEXT_PUBLIC_COMPANY_NAME ?? "KirimKu Logistics" };
    return ok({ ...user, company });
  });
}
