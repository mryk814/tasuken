import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const designTokens = readFileSync(resolve(__dirname, "design-standard/tokens.css"), "utf8");

function sharedDesignTokensPlugin() {
  return {
    name: "tasken-shared-design-tokens",
    transformIndexHtml(html: string, ctx: { path: string }) {
      if (ctx.path.endsWith("/index.html") || ctx.path === "/") return html;
      return html.replace(
        "</head>",
        `<style data-tasken-design-tokens>\n${designTokens}\n</style>\n</head>`,
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          capture: resolve(__dirname, "src/preload/capture.ts"),
          todayMini: resolve(__dirname, "src/preload/todayMini.ts"),
          recordingIndicator: resolve(__dirname, "src/preload/recordingIndicator.ts"),
          regionSelector: resolve(__dirname, "src/preload/regionSelector.ts"),
          memoSticky: resolve(__dirname, "src/preload/memoSticky.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [sharedDesignTokensPlugin(), react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          capture: resolve(__dirname, "src/renderer/capture.html"),
          todayMini: resolve(__dirname, "src/renderer/today-mini.html"),
          recordingIndicator: resolve(__dirname, "src/renderer/recording-indicator.html"),
          regionSelector: resolve(__dirname, "src/renderer/region-selector.html"),
          memoSticky: resolve(__dirname, "src/renderer/memo-sticky.html"),
        },
      },
    },
  },
});
