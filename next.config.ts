import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },

  reactStrictMode: false,

  allowedDevOrigins: [
    "gully-crummy-footnote.ngrok-free.dev",
    "100.83.151.31",
    "unclasp-zestfully-catnap.ngrok-free.dev",
  ],
};

export default nextConfig;
