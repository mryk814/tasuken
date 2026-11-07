import path from "node:path";

import { build } from "vite";

/** @param {string} input @param {string} entryFileName @param {boolean} emptyOutDir */
function headlessBuild(input, entryFileName, emptyOutDir) {
  return build({
    configFile: false,
    resolve: { alias: { electron: path.resolve("src/main/headless/electronUnavailable.ts") } },
    build: {
      emptyOutDir,
      minify: false,
      outDir: path.resolve("core-dist"),
      rollupOptions: {
        input: path.resolve(input),
        external: ["better-sqlite3"],
        output: {
          entryFileNames: entryFileName,
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

await headlessBuild("src/main/headless/main.ts", "headless.mjs", true);
// NASのreplicaを入れ替えるときの検査（deploy/synology/tasken-update-image.sh が呼ぶ）。
await headlessBuild("src/main/headless/replicaCheck.ts", "replica-check.mjs", false);
