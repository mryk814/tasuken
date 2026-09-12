import path from "node:path";

import { build } from "vite";

await build({
  configFile: false,
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: path.resolve("core-dist"),
    rollupOptions: {
      input: path.resolve("src/main/headless/main.ts"),
      external: ["better-sqlite3"],
      output: {
        entryFileNames: "headless.mjs",
        format: "es",
        inlineDynamicImports: true,
      },
    },
    ssr: true,
    target: "node20",
  },
  ssr: { noExternal: true },
});
