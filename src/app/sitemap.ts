import type { MetadataRoute } from "next";
import { publicIndexingEnabled, siteUrl } from "@/shared/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicIndexingEnabled()) return [];
  return ["/", "/tracking-paket"].map((path) => ({ url: new URL(path, siteUrl()!).href }));
}
