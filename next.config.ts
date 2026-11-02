import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { cpus: 2 },
  // Development access from other devices on the same private LAN.
  // Wildcards keep HMR working when DHCP changes this machine's final octets.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.*.*",
  ],
};

export default nextConfig;
