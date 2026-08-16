import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Buffer } from "node:buffer";

import { build } from "esbuild";

const result = await build({
  entryPoints: [path.resolve("src/main/services/screenRecordingService.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  write: false,
  logLevel: "silent",
});
const { ScreenRecordingService } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const TOKENS = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174000",
  "323e4567-e89b-42d3-a456-426614174000",
];
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XK4PPwAAAABJRU5ErkJggg==";
const CONTEXT = {
  senderWebContentsId: 7,
  frameTreeNodeId: 11,
  isMainFrame: true,
  detached: false,
  securityOrigin: "file://",
};

test("Windows source列挙ではthumbnail生成を0x0で無効化する", () => {
  const sourceText = readFileSync("src/main/services/screenRecordingService.ts", "utf8");
  assert.match(sourceText, /THUMBNAIL_SIZE = Object\.freeze\(\{ width: 0, height: 0 \}\)/);
});

function source(id, name, thumbnailDataUrl = PNG) {
  return {
    id,
    name,
    display_id: "raw-display-id",
    appIcon: null,
    thumbnail: {
      isEmpty: () => false,
      toDataURL: () => thumbnailDataUrl,
      resize: () => ({ isEmpty: () => false, toDataURL: () => thumbnailDataUrl }),
    },
  };
}

test("Main source adapterはraw IDを投影せず、oversize thumbnailをbounded placeholderへ落とす", async () => {
  let tokenIndex = 0;
  const screen = source("screen:8441034:0", "Lab\nScreen", `data:image/png;base64,${"A".repeat(600_000)}`);
  const window = source("window:991:0", "Editor");
  const calls = [];
  const service = new ScreenRecordingService({
    platform: "win32",
    idFactory: () => TOKENS[tokenIndex++],
    nowMs: () => Date.parse("2026-08-09T00:00:00.000Z"),
    getSources: async (types) => {
      calls.push(types);
      return [screen, window];
    },
  });

  const projections = await service.listSources(CONTEXT);
  assert.equal(projections.length, 2);
  assert.equal(projections[0].label, "Lab Screen");
  assert.equal(projections[0].thumbnailDataUrl, PNG);
  assert.equal(projections[0].thumbnailDataUrl.length < 512 * 1024, true);
  assert.equal(JSON.stringify(projections).includes("screen:8441034:0"), false);
  assert.equal(JSON.stringify(projections).includes("raw-display-id"), false);
  assert.deepEqual(calls, [["screen", "window"]]);

  service.arm({ sourceToken: projections[0].sourceToken, audioMode: "off", includePointer: false }, CONTEXT);
  const grant = await service.consumePermissionRequest({
    senderWebContentsId: 7,
    frameTreeNodeId: 11,
    frameIsMain: true,
    frameDetached: false,
    securityOrigin: "file://",
    userGesture: true,
    videoRequested: true,
    audioRequested: false,
  });
  assert.equal(grant.source, screen);
  assert.equal(grant.includePointer, false);
  assert.equal(grant.displayAudio, null);
  assert.deepEqual(calls, [["screen", "window"], ["screen", "window"]]);
});

test("permission時にsourceが消えたgrantは消費済みとなり再利用できない", async () => {
  let available = true;
  const screen = source("screen:8441034:0", "Lab Screen");
  const service = new ScreenRecordingService({
    platform: "win32",
    idFactory: () => TOKENS[0],
    nowMs: () => Date.parse("2026-08-09T00:00:00.000Z"),
    getSources: async () => available ? [screen] : [],
  });
  const [projection] = await service.listSources(CONTEXT);
  service.arm({ sourceToken: projection.sourceToken, audioMode: "off", includePointer: true }, CONTEXT);
  available = false;
  const request = {
    senderWebContentsId: 7,
    frameTreeNodeId: 11,
    frameIsMain: true,
    frameDetached: false,
    securityOrigin: "file://",
    userGesture: true,
    videoRequested: true,
    audioRequested: false,
  };
  await assert.rejects(() => service.consumePermissionRequest(request), /閉じられました/);
  await assert.rejects(() => service.consumePermissionRequest(request), /sourceを選択/);
});

test("Electronが未知のsource IDを返した場合はkindを推測せず拒否する", async () => {
  const service = new ScreenRecordingService({
    platform: "win32",
    idFactory: () => TOKENS[0],
    nowMs: () => Date.parse("2026-08-09T00:00:00.000Z"),
    getSources: async () => [source("unknown:8441034:0", "Unknown")],
  });
  await assert.rejects(() => service.listSources(CONTEXT), /source kind/);
});
