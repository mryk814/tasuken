import path from "node:path";

import { build } from "vite";

await build({
  configFile: false,
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.resolve("mcp-dist"),
    rollupOptions: {
      input: path.resolve("scripts/mcp-server.mjs"),
      output: {
        entryFileNames: "server.mjs",
        format: "es",
        inlineDynamicImports: true,
      },
    },
    ssr: true,
    target: "node20",
  },
  ssr: { noExternal: true },
});
