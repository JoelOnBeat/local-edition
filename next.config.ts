import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` would otherwise write an AGENTS.md into the repo root; this product keeps no AGENTS.md.
  agentRules: false,
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
