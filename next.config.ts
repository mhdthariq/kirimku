import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["gully-crummy-footnote.ngrok-free.dev", "100.83.151.31"],
};

export default nextConfig;
