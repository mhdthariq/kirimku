import type { NextConfig } from "next";

const goApiOrigin = process.env.GO_API_ORIGIN?.trim();
if (goApiOrigin) {
  const url = new URL(goApiOrigin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('GO_API_ORIGIN must be an HTTP(S) origin without credentials, a path, query or fragment.');
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  // beforeFiles takes precedence over the legacy app/api handlers.
  async rewrites() {
    return {
      beforeFiles: goApiOrigin ? [
        { source: '/api', destination: `${new URL(goApiOrigin).origin}/api` },
        { source: '/api/v1/:path*', destination: `${new URL(goApiOrigin).origin}/api/v1/:path*` },
      ] : [],
      afterFiles: [],
      fallback: [],
    };
  },
  reactStrictMode: false,

  allowedDevOrigins: [
    "gully-crummy-footnote.ngrok-free.dev",
    "100.83.151.31",
    "unclasp-zestfully-catnap.ngrok-free.dev",
    "logistik.kaminova.id"
  ],
};

export default nextConfig;
