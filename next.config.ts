import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // ガイドの章（Markdown）は実行時に fs で読むので、サーバー用の出力に含める。
  // PDF の帳票（react-pdf）は public/fonts/ の Noto Sans JP を実行時に fs で読む。
  outputFileTracingIncludes: {
    "/guide/*": ["./src/content/guide/**/*.md"],
    "/api/reports/*": ["./public/fonts/**"],
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
