import type { Metadata } from "next";
import { COMPANY_NAME } from "@/shared/company";

/** The public production origin, never inferred from an untrusted request host. */
export function siteUrl(): URL | undefined {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) URL");
  return new URL(url.origin);
}

export function publicIndexingEnabled(): boolean {
  return Boolean(siteUrl()) && process.env.NODE_ENV === "production" &&
    process.env.PREVIEW_MODE !== "true" && process.env.NEXT_PUBLIC_PREVIEW_MODE !== "true" &&
    process.env.NEXT_PUBLIC_RUNTIME_MODE !== "preview";
}

export function publicPageMetadata(title: string, description: string, path: string): Metadata {
  const origin = siteUrl();
  const url = origin ? new URL(path, origin).href : undefined;
  const index = publicIndexingEnabled();
  return {
    title, description,
    alternates: url ? { canonical: url } : undefined,
    robots: { index, follow: true },
    openGraph: { title, description, url, siteName: COMPANY_NAME, locale: "id_ID", type: "website" },
    twitter: { card: "summary", title, description },
  };
}
