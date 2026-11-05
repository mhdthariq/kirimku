import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

async function setup() {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T00:00:00Z"));
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ display_name: "Jl. Pulau Palu, Medan" }) });
  vi.stubGlobal("fetch", fetcher);
  const { reverseEvidenceAddress } = await import("@/infrastructure/services/evidence-address");
  return { lookup: reverseEvidenceAddress, fetcher };
}

describe("Nominatim evidence addresses", () => {
  it("defaults to online, caches repeated coordinates and limits other requests", async () => {
    const { lookup, fetcher } = await setup();
    vi.stubEnv("NOMINATIM_URL", "");
    expect(await lookup(3.6, 98.6)).toBe("Jl. Pulau Palu, Medan");
    expect(fetcher.mock.calls[0][0].origin).toBe("https://nominatim.openstreetmap.org");
    expect(fetcher.mock.calls[0][0].searchParams.get("lat")).toBe("3.6");
    expect(await lookup(3.6, 98.6)).toBe("Jl. Pulau Palu, Medan");
    expect(await lookup(3.7, 98.7)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1100);
    await lookup(3.7, 98.7);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("supports a self-hosted base URL and sanitizes provider text", async () => {
    const { lookup, fetcher } = await setup();
    vi.stubEnv("NOMINATIM_URL", "https://geo.example.com/nominatim/");
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ display_name: " Medan\n " + "a".repeat(300) }) });
    const address = await lookup(3, 98);
    expect(address).toHaveLength(240);
    expect(address).not.toContain("\n");
    expect(fetcher.mock.calls[0][0].pathname).toBe("/nominatim/reverse");
  });

  it("returns no address for invalid GPS, HTTP failures, malformed responses and network errors", async () => {
    const { lookup, fetcher } = await setup();
    expect(await lookup(91, 98)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce({ ok: false });
    expect(await lookup(3, 98)).toBeNull();
    vi.advanceTimersByTime(1100);
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ display_name: 123 }) });
    expect(await lookup(4, 98)).toBeNull();
    vi.advanceTimersByTime(1100);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    expect(await lookup(5, 98)).toBeNull();
  });
});
