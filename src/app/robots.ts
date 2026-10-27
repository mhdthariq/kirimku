import type { MetadataRoute } from "next";
import { publicIndexingEnabled, siteUrl } from "@/shared/seo";

export default function robots(): MetadataRoute.Robots {
  if (!publicIndexingEnabled()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: new URL("/sitemap.xml", siteUrl()!).href,
  };
}
