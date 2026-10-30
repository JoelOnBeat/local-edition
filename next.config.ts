import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` would otherwise write an AGENTS.md into the repo root; this product keeps no AGENTS.md.
  agentRules: false,
  // next 16.4.3 dev reloads pages in a loop when its MCP server rewrites .next/dev/logs; off until fixed upstream.
  experimental: { mcpServer: false },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
