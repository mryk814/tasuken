import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "vite";

/** Use the production bundle configuration for isolated stdio integration tests too. */
export async function buildMcpBridge({ outDir = path.resolve("mcp-dist") } = {}) {
  await build({
    configFile: false,
    build: {
      emptyOutDir: true,
      minify: false,
      outDir,
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

  await build({
    configFile: false,
    build: {
      emptyOutDir: false,
      minify: false,
      outDir,
      rollupOptions: {
        input: path.resolve("scripts/agent-session-hook.mjs"),
        output: {
          entryFileNames: "agent-session-hook.mjs",
          format: "es",
          inlineDynamicImports: true,
        },
      },
      ssr: true,
      target: "node20",
    },
    ssr: { noExternal: true },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildMcpBridge();
}
