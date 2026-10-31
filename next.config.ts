import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development startup from creating or changing repository instructions.
  agentRules: false,
};

export default nextConfig;
