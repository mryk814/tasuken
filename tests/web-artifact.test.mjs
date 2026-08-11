import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";

import { build } from "esbuild";

import { validateArtifactProposal } from "../src/shared/proposalMedia.mjs";
import {
  buildWebArtifactDocument,
  isWebArtifact,
  webArtifactCsp,
  webArtifactPreviewUrl,
} from "../src/shared/webArtifact.mjs";

async function importWorkspaceService() {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "tasken-web-artifact-service-bundle-"));
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  await build({
    entryPoints: [path.resolve("src/main/services/workspaceService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
    plugins: [{
      name: "electron-mock",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron-mock", namespace: "electron-mock" }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-mock" }, () => ({ contents: "export const app={getPath:()=>\"\"}; export class BrowserWindow{}; export const clipboard={}; export const dialog={}; export const nativeImage={}; export const shell={openPath:async()=>\"\"};", loader: "js" }));
        buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({ path: "adm-zip-mock", namespace: "adm-zip-mock" }));
        buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({ contents: "export default class AdmZip {}", loader: "js" }));
        buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: "better-sqlite3-mock", namespace: "better-sqlite3-mock" }));
        buildApi.onLoad({ filter: /.*/, namespace: "better-sqlite3-mock" }, () => ({ contents: "export default class Database { constructor() { throw new Error('database path is not used by Web Artifact preview'); } }", loader: "js" }));
      },
    }],
  });
  return import(pathToFileURL(outputFile).href);
}

const { WorkspaceService } = await importWorkspaceService();

const contracts = readFileSync("src/shared/ipc/contracts.ts", "utf8");
const preload = readFileSync("src/preload/index.ts", "utf8");
const registerIpc = readFileSync("src/main/ipc/registerIpc.ts", "utf8");
const webArtifactProtocol = readFileSync("src/main/webArtifactProtocol.ts", "utf8");
const rendererIndex = readFileSync("src/renderer/index.html", "utf8");
const workspaceService = readFileSync("src/main/services/workspaceService.ts", "utf8");
const workspaceApi = readFileSync("src/renderer/src/services/workspaceApi.ts", "utf8");
const viewer = readFileSync("src/renderer/src/features/workspace/components/ContentViewer.tsx", "utf8");
const artifacts = readFileSync("src/renderer/src/features/workspace/components/artifacts.tsx", "utf8");
const artifactEntities = readFileSync("src/renderer/src/features/workspace/lib/artifactEntities.ts", "utf8");

test("Web Artifactは拡張子またはtext/html MIMEで識別する", () => {
  assert.equal(isWebArtifact({ filename: "index.html" }), true);
  assert.equal(isWebArtifact({ file_type: "htm" }), true);
  assert.equal(isWebArtifact({ mime_type: "text/html; charset=utf-8", filename: "report.bin" }), true);
  assert.equal(isWebArtifact({ filename: "report.md", mime_type: "text/markdown" }), false);
});

test("Static Previewはscript/event/network/navigationの実行経路を除去する", () => {
  const document = buildWebArtifactDocument(`<!doctype html><html><head><style>.x{background:url(https://example.com/x)}</style></head><body>
    <button onclick="alert('x')">確認</button><img src="https://example.com/pixel.png">
    <a href="https://example.com">外部</a><script>window.__executed = true</script>
  </body></html>`, "static");
  assert.doesNotMatch(document, /<script|onclick|https:\/\/example\.com|window\.__executed/);
  assert.match(document, /script-src 'none'/);
  assert.match(document, /connect-src 'none'/);
  assert.match(document, /form-action 'none'/);
});

test("Interactive Previewはinline JSだけを明示操作後にsandboxへ渡す", () => {
  const document = buildWebArtifactDocument("<button onclick=\"window.clicked = true\">x</button><script>window.ready = true</script>", "sandboxed_interactive");
  assert.match(document, /window\.ready/);
  assert.match(document, /window\.clicked/);
  assert.match(document, /script-src 'unsafe-inline'/);
  assert.match(webArtifactCsp("sandboxed_interactive"), /connect-src 'none'/);
  assert.match(webArtifactCsp("sandboxed_interactive"), /object-src 'none'/);
});

test("Electron親CSP下でもPreviewは専用protocolのID URLとして独立して動かせる", () => {
  assert.equal(webArtifactPreviewUrl("web-1", "sandboxed_interactive"), "tasken-web://preview/web-1?policy=sandboxed_interactive");
});

test("AI Artifact Proposalはself-contained HTMLを保存候補として受け付ける", () => {
  assert.deepEqual(validateArtifactProposal({
    title: "Dashboard",
    file_name: "index.html",
    media_type: "text/html",
    content: "<!doctype html><html><body>ok</body></html>",
  }), {
    title: "Dashboard",
    fileName: "index.html",
    mediaType: "text/html",
    content: "<!doctype html><html><body>ok</body></html>",
  });
});

test("Web PreviewはArtifact ID-onlyのMain/Preload/Renderer経路へ接続される", () => {
  assert.match(contracts, /artifactWebPreview:\s*"artifact:web-preview"/);
  assert.match(contracts, /WebArtifactPreviewResult/);
  assert.match(contracts, /readWebPreview\(artifactId: string\)/);
  assert.match(preload, /readWebPreview:\s*\(artifactId\)\s*=>\s*ipcRenderer\.invoke\(IPC\.artifactWebPreview, artifactId\)/);
  assert.match(registerIpc, /IPC\.artifactWebPreview[\s\S]*service\.getWebArtifactPreview\(requireId\(artifactId\)\)/);
  assert.match(webArtifactProtocol, /registerWebArtifactProtocol/);
  assert.match(webArtifactProtocol, /readWebArtifactPreviewDocument/);
  assert.match(webArtifactProtocol, /content-security-policy/);
  assert.match(rendererIndex, /frame-src 'self' tasken-web:/);
  const serviceBlock = workspaceService.slice(workspaceService.indexOf("private resolveWebArtifact("), workspaceService.indexOf("async chooseDirectory", workspaceService.indexOf("private resolveWebArtifact(")));
  assert.match(serviceBlock, /repository\.get\("artifact"/);
  assert.match(serviceBlock, /isWebArtifact\(artifact\)/);
  assert.doesNotMatch(serviceBlock, /stored_path\s*:/);
  assert.match(workspaceApi, /readWebArtifactPreview\(artifactId: string\)/);
});

test("WorkspaceServiceはArtifact IDから専用protocol URLを返し、MainだけがHTML本文を読む", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-web-artifact-preview-"));
  const htmlPath = path.join(root, "index.html");
  const html = "<!doctype html><html><body><h1>safe</h1></body></html>";
  writeFileSync(htmlPath, html, "utf8");
  const artifact = {
    id: "web-1",
    filename: "index.html",
    file_type: "html",
    mime_type: "text/html",
    storage_mode: "managed",
    stored_path: htmlPath,
    web_execution_policy: "static",
  };
  const repository = {
    get: (type, id) => type === "artifact" && id === artifact.id ? artifact : null,
  };
  const service = new WorkspaceService(repository, root, () => "2026-08-11T00:00:00.000Z");
  const result = service.getWebArtifactPreview("web-1");
  assert.deepEqual(result, { ok: true, url: "tasken-web://preview/web-1?policy=static", mimeType: "text/html", executionPolicy: "static" });
  const document = service.readWebArtifactPreviewDocument("web-1", "sandboxed_interactive");
  assert.deepEqual(document, { ok: true, html, executionPolicy: "sandboxed_interactive" });
  assert.equal(Object.hasOwn(result, "filePath"), false);
  assert.equal(Object.hasOwn(result, "stored_path"), false);

  repository.get = () => ({ ...artifact, storage_mode: "linked", target: "https://example.com/index.html", stored_path: "" });
  const external = service.getWebArtifactPreview("web-1");
  assert.equal(external.ok, false);
  assert.match(external.error, /ブラウザで開いてください/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("ContentViewerはStaticを既定にし、Interactiveだけallow-scriptsへ切り替える", () => {
  assert.match(viewer, /readWebArtifactPreview\(artifact\.id\)/);
  assert.match(viewer, /setWebMode\("static"\)/);
  assert.match(viewer, /Static Preview/);
  assert.match(viewer, /Interactive Preview/);
  assert.match(viewer, /sandbox=\{webMode === "static" \? "" : "allow-scripts"\}/);
  assert.match(viewer, /src=\{webPreviewUrl\}/);
  assert.doesNotMatch(viewer, /srcDoc=/);
  assert.match(viewer, /allow=""/);
  assert.match(viewer, /referrerPolicy="no-referrer"/);
  assert.match(viewer, /Taskenデータ・OSファイル・ネットワークにはアクセスできません/);
  assert.match(artifacts, /isWebArtifact/);
  assert.match(artifacts, /category === "web"/);
  assert.match(artifactEntities, /web_kind: isWeb \? "self_contained_html"/);
});
