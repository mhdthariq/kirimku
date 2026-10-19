import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDelete } from "@/infrastructure/http/client-api";

afterEach(() => vi.unstubAllGlobals());

describe("DELETE request serialization", () => {
  it("sends a reason as a JSON object that the expense endpoint can read", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { status: "REMOVED" } }));
    vi.stubGlobal("fetch", fetch);
    await apiDelete("/transports/6/expenses/2", { reason: "SalahInput" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/v1/transports/6/expenses/2");
    expect(options.method).toBe("DELETE");
    const request = new Request(`http://localhost${url}`, options);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ reason: "SalahInput" });
  });

  it("keeps bodyless delete requests bodyless", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { deleted: true } }));
    vi.stubGlobal("fetch", fetch);
    await apiDelete("/transports/6/expenses/2");
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("Content-Type");
  });
});
