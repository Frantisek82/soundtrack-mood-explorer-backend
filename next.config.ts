import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  logging: {
    incomingRequests: false,
  },
};

export default nextConfig;
