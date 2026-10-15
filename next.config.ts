import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a self-contained server for the Docker image (docs/DEPLOY.md)
  output: "standalone",
  devIndicators: false,
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
