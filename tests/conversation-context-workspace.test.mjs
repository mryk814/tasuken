import assert from "node:assert/strict";
import fs, { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { listConversationContextOperations } from "../src/main/services/conversationContextPublisher.mjs";

async function importWorkspaceService() {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "tasken-conversation-context-service-bundle-"));
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  const electronMock = {
    name: "electron-mock",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: "electron-mock", namespace: "electron-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "electron-mock" }, () => ({
        contents: `
          export const app = { getPath: () => "" };
          export class BrowserWindow {}
          export const clipboard = {};
          export const dialog = {};
          export const nativeImage = {};
          export const shell = { openPath: async () => "" };
        `,
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({ path: "adm-zip-mock", namespace: "adm-zip-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({
        contents: "export default class AdmZip { constructor() { throw new Error('adm-zip is not used by Conversation Context tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: "better-sqlite3-mock", namespace: "better-sqlite3-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "better-sqlite3-mock" }, () => ({
        contents: "export default class Database { constructor() { throw new Error('database path is not used by in-memory Context Preview'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({ path: "workspace-repository-mock", namespace: "workspace-repository-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "workspace-repository-mock" }, () => ({
        contents: "export const workspaceEntityTypes = []; export const workspaceSchemaVersion = 1;",
        loader: "js",
      }));
    },
  };
  await build({
    entryPoints: [path.resolve("src/main/services/workspaceService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    logLevel: "silent",
    plugins: [electronMock],
  });
  return import(pathToFileURL(outputFile).href);
}

const { WorkspaceService } = await importWorkspaceService();

function createFixture(prefix) {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const syncRoot = path.join(userDataPath, "TaskenSync");
  fs.mkdirSync(syncRoot);
  const databasePath = path.join(userDataPath, "workspace.sqlite");
  const database = new WorkspaceDatabase(databasePath);
  database.setPreference("artifactDirectory", syncRoot);
  database.save("theme", {
    id: "theme-context",
    name: "Conversation Theme",
    code: "CONV",
    default_ai_visibility: ["m365", "coding_agent"],
    ai_visibility: ["m365"],
    ai_freshness: "current",
    ai_authority: "user_confirmed",
    ai_summary: "Conversation publication test",
    ai_summary_authority: "user_confirmed",
  });
  database.save("resource", {
    id: "conversation-context",
    title: "Original title",
    url: "https://chat.example.test/thread?secret=query",
    link_type: "chatgpt",
    theme_id: "theme-context",
    resource_scope: "chat_ref",
    captured_at: "2026-08-01T10:00:00.000Z",
    body_markdown: [
      "## User",
      "Question one",
      "## Assistant",
      "Answer one",
      "## User",
      "Question two",
      "## Tool",
      "raw output must stay local",
      "## Assistant",
      "Answer two",
    ].join("\n\n"),
    ai_visibility: ["m365", "coding_agent"],
    ai_summary: "Conversation summary",
    ai_summary_authority: "user_confirmed",
    ai_freshness: "current",
    ai_authority: "imported",
  });
  return {
    userDataPath,
    syncRoot,
    databasePath,
    database,
    close() {
      try { database.db.close(); } catch {}
      fs.rmSync(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

function publishRequest(preview) {
  return {
    conversationId: preview.conversationId,
    scope: preview.scope,
    selectedMessageIndexes: preview.selectedMessageIndexes,
    expectedContentHash: preview.contentHash,
    plannedPublishedAt: preview.plannedPublishedAt,
  };
}

test("Viewer previewから明示公開し、stable path・selected turns・AI Pack参照・unchanged skipを保つ", () => {
  const item = createFixture("tasken-conversation-context-publish");
  try {
    const now = "2026-08-09T03:00:00.000Z";
    const service = new WorkspaceService(item.database, item.userDataPath, () => now);
    const before = item.database.get("resource", "conversation-context");
    const preview = service.getConversationContextPreview({ conversationId: "conversation-context", scope: "selected_turns", selectedMessageIndexes: [0, 4] });
    assert.equal(preview.publicationState, "not_published");
    assert.equal(preview.allowed, true);
    assert.match(preview.relativePath, /^AI Context\/Conversations\//);
    assert.doesNotMatch(preview.content, /Answer one|Question two|raw output/);
    assert.match(preview.content, /Question one/);
    assert.match(preview.content, /Answer two/);
    assert.equal(fs.existsSync(path.join(item.syncRoot, "Themes")), false, "preview must not publish");

    const published = service.publishConversationContext(publishRequest(preview));
    assert.equal(published.publicationState, "published");
    assert.equal(published.written, true);
    const saved = item.database.get("resource", "conversation-context");
    const publication = saved.conversation_context_publication;
    assert.equal(saved.body_markdown, before.body_markdown, "Conversation body is not rewritten");
    assert.equal(item.database.list("artifact").length, 0, "raw Artifact collection is untouched");
    assert.equal(publication.published_at, now);
    const filePath = path.join(item.syncRoot, "Themes", "CONV", ...publication.relative_path.split("/"));
    assert.equal(fs.existsSync(filePath), true);
    const fileBody = fs.readFileSync(filePath, "utf8");
    assert.match(fileBody, /schema: tasken-conversation-context\/v1/);
    assert.doesNotMatch(fileBody, /raw output must stay local/);

    const meetingsPath = path.join(item.syncRoot, "Themes", "CONV", "AI Pack", "03 Meetings.md");
    const meetings = fs.readFileSync(meetingsPath, "utf8");
    assert.match(meetings, /theme:theme-context:AI Context\/Conversations\//);
    assert.doesNotMatch(meetings, /Question one|Answer two|raw output/);

    const mtime = fs.statSync(filePath).mtimeMs;
    const current = service.getConversationContextPreview({ conversationId: "conversation-context" });
    assert.equal(current.publicationState, "published");
    assert.equal(current.dirty, false);
    const skipped = service.publishConversationContext(publishRequest(current));
    assert.equal(skipped.written, false);
    assert.equal(fs.statSync(filePath).mtimeMs, mtime);
    assert.equal(item.database.get("resource", "conversation-context").conversation_context_publication.published_at, now);
  } finally {
    item.close();
  }
});

test("title変更でbindingを動かさず更新し、visibility解除後はhard blockしてPack参照を外す", () => {
  const item = createFixture("tasken-conversation-context-dirty");
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    const initial = service.getConversationContextPreview({ conversationId: "conversation-context" });
    service.publishConversationContext(publishRequest(initial));
    const firstPublication = item.database.get("resource", "conversation-context").conversation_context_publication;
    const current = item.database.get("resource", "conversation-context");
    item.database.save("resource", { ...current, title: "Renamed title", body_markdown: `${current.body_markdown}\n\nMore detail` });
    const dirty = service.getConversationContextPreview({ conversationId: "conversation-context" });
    assert.equal(dirty.publicationState, "dirty");
    assert.equal(dirty.relativePath, firstPublication.relative_path);
    service.publishConversationContext(publishRequest(dirty));
    assert.equal(item.database.get("resource", "conversation-context").conversation_context_publication.relative_path, firstPublication.relative_path);

    const visible = item.database.get("resource", "conversation-context");
    item.database.save("resource", { ...visible, ai_visibility: ["coding_agent"] });
    const blocked = service.getConversationContextPreview({ conversationId: "conversation-context" });
    assert.equal(blocked.publicationState, "published_but_blocked");
    assert.equal(blocked.allowed, false);
    assert.throws(() => service.publishConversationContext(publishRequest(blocked)), /公開|M365/);
    const packPreview = service.getThemeAiPackPreview("theme-context");
    const meetings = packPreview.files.find((file) => file.name === "03 Meetings.md").content;
    assert.doesNotMatch(meetings, /AI Context\/Conversations/);

    const originalBody = visible.body_markdown;
    const removed = service.removeConversationContext({ conversationId: "conversation-context" });
    assert.equal(removed.publicationState, "removed");
    const after = item.database.get("resource", "conversation-context");
    assert.equal(after.body_markdown, originalBody);
    assert.equal(after.conversation_context_publication.status, "removed");
  } finally {
    item.close();
  }
});

test("Theme folder rename後もID markerで再発見し、AI Context bindingを保つ", () => {
  const item = createFixture("tasken-conversation-context-theme-rename");
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    const initial = service.getConversationContextPreview({ conversationId: "conversation-context" });
    service.publishConversationContext(publishRequest(initial));
    const originalFolder = path.join(item.syncRoot, "Themes", "CONV");
    const renamedFolder = path.join(item.syncRoot, "Themes", "RENAMED");
    fs.renameSync(originalFolder, renamedFolder);
    const theme = item.database.get("theme", "theme-context");
    item.database.save("theme", { ...theme, code: "NEW", name: "Renamed Theme" });

    const restarted = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T04:00:00.000Z");
    const current = restarted.getConversationContextPreview({ conversationId: "conversation-context" });
    assert.equal(current.publicationState, "dirty", "Theme display metadata changed but the same file is rediscovered");
    assert.equal(current.relativePath, initial.relativePath);
    restarted.publishConversationContext(publishRequest(current));
    assert.equal(fs.existsSync(path.join(renamedFolder, ...current.relativePath.split("/"))), true);
    assert.equal(fs.existsSync(path.join(item.syncRoot, "Themes", "NEW")), false);
  } finally {
    item.close();
  }
});

test("AI Context child junctionを拒否し、raw pathを返さずreceiptを残さない", () => {
  const item = createFixture("tasken-conversation-context-junction");
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    const packPreview = service.getThemeAiPackPreview("theme-context");
    service.publishThemeAiPack({ themeId: "theme-context", expectedContentHash: packPreview.contentHash });
    const themeFolder = path.join(item.syncRoot, "Themes", "CONV");
    const outside = path.join(item.userDataPath, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(themeFolder, "AI Context"), "junction");
    const preview = service.getConversationContextPreview({ conversationId: "conversation-context" });
    assert.throws(
      () => service.publishConversationContext(publishRequest(preview)),
      (error) => /AI Contextファイルを更新できませんでした/.test(error.message) && !error.message.includes(item.userDataPath),
    );
    assert.deepEqual(fs.readdirSync(outside), []);
    const failed = item.database.get("resource", "conversation-context").conversation_context_publication;
    assert.equal(failed.status, "publish_failed");
    assert.equal(failed.operation_id, null);
    const recoveryDirectory = path.join(item.userDataPath, "conversation-context-recovery");
    assert.equal(fs.existsSync(recoveryDirectory) ? fs.readdirSync(recoveryDirectory).length : 0, 0);
  } finally {
    item.close();
  }
});

function failResourceFinalSave(database) {
  let resourceSaves = 0;
  return new Proxy(database, {
    get(target, property) {
      if (property === "save") {
        return (type, entity, options) => {
          if (type === "resource") {
            resourceSaves += 1;
            if (resourceSaves >= 2) throw new Error("injected final resource save failure");
          }
          return target.save(type, entity, options);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("file成功・DB失敗はreceiptから再起動復旧しConversation本文を保つ", () => {
  const item = createFixture("tasken-conversation-context-publish-recovery");
  try {
    const previewService = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    const preview = previewService.getConversationContextPreview({ conversationId: "conversation-context" });
    const failing = new WorkspaceService(failResourceFinalSave(item.database), item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    assert.throws(() => failing.publishConversationContext(publishRequest(preview)), /AI Contextファイルを更新できませんでした/);
    const pending = item.database.get("resource", "conversation-context");
    assert.equal(pending.conversation_context_publication.status, "publishing");
    const body = pending.body_markdown;
    item.database.db.close();

    const restarted = new WorkspaceDatabase(item.databasePath);
    new WorkspaceService(restarted, item.userDataPath, () => "2026-08-09T03:05:00.000Z").loadWorkspace();
    const recovered = restarted.get("resource", "conversation-context");
    assert.equal(recovered.conversation_context_publication.status, "published");
    assert.equal(recovered.body_markdown, body);
    assert.equal(fs.readdirSync(path.join(item.userDataPath, "conversation-context-recovery")).length, 0);
    restarted.db.close();
  } finally {
    item.close();
  }
});

test("削除成功・DB失敗はreceiptから再起動復旧しConversationを削除しない", () => {
  const item = createFixture("tasken-conversation-context-remove-recovery");
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    const preview = service.getConversationContextPreview({ conversationId: "conversation-context" });
    service.publishConversationContext(publishRequest(preview));
    const body = item.database.get("resource", "conversation-context").body_markdown;
    const failing = new WorkspaceService(failResourceFinalSave(item.database), item.userDataPath, () => "2026-08-09T04:00:00.000Z");
    assert.throws(() => failing.removeConversationContext({ conversationId: "conversation-context" }), /AI Contextファイルを解除できませんでした/);
    assert.equal(item.database.get("resource", "conversation-context").conversation_context_publication.status, "removing");
    item.database.db.close();

    const restarted = new WorkspaceDatabase(item.databasePath);
    new WorkspaceService(restarted, item.userDataPath, () => "2026-08-09T04:05:00.000Z").loadWorkspace();
    const recovered = restarted.get("resource", "conversation-context");
    assert.equal(recovered.conversation_context_publication.status, "removed");
    assert.equal(recovered.deleted_at, null);
    assert.equal(recovered.body_markdown, body);
    restarted.db.close();
  } finally {
    item.close();
  }
});

test("planned receiptはfile未完了をfailedへ確定し、再起動ごとの永久retryを残さない", () => {
  const item = createFixture("tasken-conversation-context-planned-recovery");
  try {
    const service = new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T03:00:00.000Z");
    const preview = service.getConversationContextPreview({ conversationId: "conversation-context" });
    service.publishConversationContext(publishRequest(preview));
    const resource = item.database.get("resource", "conversation-context");
    const publication = resource.conversation_context_publication;
    const filePath = path.join(item.syncRoot, "Themes", "CONV", ...publication.relative_path.split("/"));
    fs.unlinkSync(filePath);
    const operationId = "planned-incomplete";
    item.database.save("resource", {
      ...resource,
      conversation_context_publication: { ...publication, status: "publishing", operation_id: operationId },
    });
    const recovery = path.join(item.userDataPath, "conversation-context-recovery");
    fs.mkdirSync(recovery, { recursive: true });
    fs.writeFileSync(path.join(recovery, `${operationId}.json`), `${JSON.stringify({
      schema: "tasken-conversation-context-operation/v1",
      operationId,
      action: "publish",
      phase: "planned",
      conversationId: "conversation-context",
      themeId: "theme-context",
      relativePath: publication.relative_path,
      contentHash: publication.content_hash,
    })}\n`);

    new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T04:00:00.000Z").loadWorkspace();
    const failed = item.database.get("resource", "conversation-context").conversation_context_publication;
    assert.equal(failed.status, "publish_failed");
    assert.equal(failed.operation_id, null);
    assert.equal(fs.readdirSync(recovery).length, 0);
    new WorkspaceService(item.database, item.userDataPath, () => "2026-08-09T05:00:00.000Z").loadWorkspace();
    assert.equal(fs.readdirSync(recovery).length, 0);
  } finally {
    item.close();
  }
});

test("recovery directory/receipt symlinkと不正identity/pathをfollowしない", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-conversation-receipt-boundary-"));
  try {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    const linkedRecovery = path.join(root, "linked-recovery");
    fs.symlinkSync(outside, linkedRecovery, "junction");
    const linked = listConversationContextOperations(linkedRecovery);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].receipt, null);

    const recovery = path.join(root, "recovery");
    fs.mkdirSync(recovery);
    fs.writeFileSync(path.join(recovery, "bad.json"), JSON.stringify({
      schema: "tasken-conversation-context-operation/v1",
      operationId: "bad",
      action: "publish",
      phase: "planned",
      conversationId: "../conversation",
      themeId: "theme",
      relativePath: "../../outside.md",
      contentHash: `sha256:1:${"0".repeat(64)}`,
    }));
    const invalid = listConversationContextOperations(recovery);
    assert.equal(invalid[0].receipt, null);
    assert.equal(fs.existsSync(path.join(outside, "outside.md")), false);

    fs.unlinkSync(path.join(recovery, "bad.json"));
    fs.symlinkSync(path.join(outside, "missing.json"), path.join(recovery, "receipt-link.json"));
    const receiptLink = listConversationContextOperations(recovery);
    assert.equal(receiptLink[0].receipt, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
