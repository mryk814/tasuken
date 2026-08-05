import path from "node:path";

import { build } from "vite";

const esmPolyfill = [
  'import { createRequire as __mcpCreateRequire } from "node:module";',
  'import { fileURLToPath as __mcpFileURLToPath } from "node:url";',
  'import { dirname as __mcpDirname } from "node:path";',
  "const __filename = __mcpFileURLToPath(import.meta.url);",
  "const __dirname = __mcpDirname(__filename);",
  "const require = __mcpCreateRequire(import.meta.url);",
].join("\n");

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
        banner: esmPolyfill,
      },
    },
    ssr: true,
    target: "node20",
  },
  ssr: {
    noExternal: true,
    external: ["better-sqlite3"],
  },
});
