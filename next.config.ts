import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", "[::1]", "192.168.1.38", "frq", "fan", "frq.ts.net", "fan.ts.net"],
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
  ],
};

export default nextConfig;
