import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicPageMetadata } from "@/shared/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://logistics.example");
  vi.stubEnv("PREVIEW_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_PREVIEW_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_RUNTIME_MODE", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("public search discovery", () => {
  it("advertises only public canonical pages and the same sitemap origin", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://logistics.example/", "https://logistics.example/tracking-paket",
    ]);
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: "https://logistics.example/sitemap.xml" });
    expect(publicPageMetadata("Tracking", "Check a shipment", "/tracking-paket")).toMatchObject({
      alternates: { canonical: "https://logistics.example/tracking-paket" },
      robots: { index: true, follow: true },
    });
  });
  it.each([
    ["PREVIEW_MODE", "true"], ["NEXT_PUBLIC_PREVIEW_MODE", "true"],
    ["NEXT_PUBLIC_RUNTIME_MODE", "preview"], ["NODE_ENV", "development"],
    ["NEXT_PUBLIC_SITE_URL", ""],
  ])("disables discovery for %s=%s", (name, value) => {
    vi.stubEnv(name, value);
    expect(sitemap()).toEqual([]);
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(publicPageMetadata("Title", "Description", "/").robots).toMatchObject({ index: false });
  });
});
