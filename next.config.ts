import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // ガイドの章（Markdown）は実行時に fs で読むので、サーバー用の出力に含める。
  outputFileTracingIncludes: {
    "/guide/*": ["./src/content/guide/**/*.md"],
  },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
