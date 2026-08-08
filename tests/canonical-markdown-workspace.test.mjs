import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

import {
  buildCanonicalMarkdownContent,
  canonicalMarkdownBindingFromProperties,
  markdownSignature,
} from "../src/shared/canonicalMarkdown.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function importWorkspaceService() {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-service-bundle-"));
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
          export const shell = {};
        `,
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({ path: "adm-zip-mock", namespace: "adm-zip-mock" }));
      buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({
        contents: "export default class AdmZip { constructor() { throw new Error('adm-zip is not used by canonical workspace behavior tests'); } }",
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
  const database = new WorkspaceDatabase(path.join(userDataPath, "workspace.sqlite"));
  database.setPreference("artifactDirectory", syncRoot);
  return { userDataPath, syncRoot, database };
}

function closeFixture(fixture) {
  fixture.database.db.close();
  rmSync(fixture.userDataPath, { recursive: true, force: true });
}

function saveRequest(note, body, options = {}) {
  return {
    entity: { ...note, body_markdown: body },
    snapshot: {
      owner: { recordType: "note", entityId: note.id },
      body,
      expectedRevision: Number(note.version || 0),
    },
    options,
  };
}

function canonicalBinding(note) {
  return canonicalMarkdownBindingFromProperties(note.properties_json, { noteId: note.id });
}

function canonicalContent(note) {
  return buildCanonicalMarkdownContent({
    title: note.title,
    updatedAt: note.updated_at || note.created_at,
    body: note.body_markdown,
  });
}

test("WorkspaceServiceのowner/revision付き保存はDB・同一pathの実ファイル・in_syncを揃え、title変更でpathを動かさない", () => {
  const fixture = createFixture("tasken-canonical-save");
  try {
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    fixture.database.save("note", {
      id: "note-canonical-save",
      title: "Original title",
      body_markdown: "初期本文",
      content_format: "markdown",
    });
    const initial = fixture.database.get("note", "note-canonical-save");
    const first = service.saveCanonicalNote(saveRequest(initial, "Tasken本文 1"));
    const firstBinding = canonicalBinding(first);
    assert.equal(first.body_markdown, "Tasken本文 1");
    assert.equal(firstBinding.sync_state, "in_sync");
    assert.equal(firstBinding.canonical_path.endsWith(".md"), true);
    assert.equal(readFileSync(firstBinding.canonical_path, "utf8"), canonicalContent(first));
    assert.equal(fixture.database.list("artifact").length, 0);

    const second = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-canonical-save"),
      "Tasken本文 2",
    ));
    const secondBinding = canonicalBinding(second);
    assert.equal(second.title, "Original title");
    assert.equal(secondBinding.canonical_path, firstBinding.canonical_path);
    assert.equal(secondBinding.sync_state, "in_sync");
    assert.equal(readFileSync(secondBinding.canonical_path, "utf8"), canonicalContent(second));

    const renamed = service.saveCanonicalNote({
      ...saveRequest(fixture.database.get("note", "note-canonical-save"), "Tasken本文 3"),
      entity: { ...fixture.database.get("note", "note-canonical-save"), title: "Renamed title", body_markdown: "Tasken本文 3" },
    });
    const renamedBinding = canonicalBinding(renamed);
    assert.equal(renamed.title, "Renamed title");
    assert.equal(renamedBinding.canonical_path, firstBinding.canonical_path);
    assert.match(readFileSync(renamedBinding.canonical_path, "utf8"), /title: "Renamed title"/);
    assert.equal(fixture.database.list("artifact").length, 0);
  } finally {
    closeFixture(fixture);
  }
});

test("metadata-only canonical saveはversion/propertiesだけを更新し、本文と正本Markdownを保つ", () => {
  const fixture = createFixture("tasken-canonical-metadata");
  try {
    const operationAt = "2026-08-08T12:34:56.000Z";
    const service = new WorkspaceService(fixture.database, fixture.userDataPath, () => operationAt);
    fixture.database.save("note", { id: "note-metadata", title: "Metadata", body_markdown: "本文" });
    const first = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-metadata"),
      "本文",
    ));
    const filePath = canonicalBinding(first).canonical_path;
    const beforeContent = readFileSync(filePath, "utf8");
    const metadata = service.saveCanonicalNote({
      ...saveRequest(fixture.database.get("note", "note-metadata"), "本文"),
      entity: {
        ...fixture.database.get("note", "note-metadata"),
        body_markdown: "本文",
        properties_json: { heading_numbers: true, heading_number_levels: [2, 3] },
      },
    });
    assert.equal(metadata.body_markdown, "本文");
    assert.equal(metadata.version, first.version + 1);
    assert.deepEqual(metadata.properties_json, { heading_numbers: true, heading_number_levels: [2, 3], canonical_markdown: canonicalBinding(metadata) });
    assert.equal(readFileSync(filePath, "utf8"), beforeContent);
  } finally {
    closeFixture(fixture);
  }
});

test("WorkspaceServiceはstale revisionを拒否し、DB本文と正本Markdownを古いsnapshotで上書きしない", () => {
  const fixture = createFixture("tasken-canonical-stale");
  try {
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    fixture.database.save("note", { id: "note-stale", title: "Stale", body_markdown: "本文" });
    const initial = fixture.database.get("note", "note-stale");
    const saved = service.saveCanonicalNote(saveRequest(initial, "新本文"));
    const before = fixture.database.get("note", "note-stale");
    const binding = canonicalBinding(saved);
    assert.throws(
      () => service.saveCanonicalNote(saveRequest({ ...before, version: before.version - 1 }, "古い編集")),
      /expected revision|古い編集画面/,
    );
    assert.equal(fixture.database.get("note", "note-stale").body_markdown, before.body_markdown);
    assert.equal(readFileSync(binding.canonical_path, "utf8"), canonicalContent(before));
  } finally {
    closeFixture(fixture);
  }
});

test("外部変更時はdraftをDBへ保持してconflictにし、明示overwriteだけが実ファイルを更新する", () => {
  const fixture = createFixture("tasken-canonical-conflict");
  try {
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    fixture.database.save("note", { id: "note-conflict", title: "Conflict", body_markdown: "本文" });
    const initial = fixture.database.get("note", "note-conflict");
    const first = service.saveCanonicalNote(saveRequest(initial, "初回Tasken本文"));
    const filePath = canonicalBinding(first).canonical_path;
    writeFileSync(filePath, "外部エディタの本文", "utf8");

    const conflicted = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-conflict"),
      "Tasken draft",
    ));
    assert.equal(conflicted.body_markdown, "Tasken draft");
    assert.equal(readFileSync(filePath, "utf8"), "外部エディタの本文");
    assert.equal(canonicalBinding(conflicted).sync_state, "conflict");

    const overwritten = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-conflict"),
      "Tasken overwrite",
      { canonicalMarkdown: "overwrite" },
    ));
    assert.equal(canonicalBinding(overwritten).sync_state, "in_sync");
    assert.equal(readFileSync(filePath, "utf8"), canonicalContent(overwritten));
    assert.equal(canonicalBinding(overwritten).file_signature, markdownSignature(readFileSync(filePath, "utf8")));
  } finally {
    closeFixture(fixture);
  }
});

test("file成功後DB失敗のreceiptは再起動で実ファイルhashを照合して復旧し、再外部変更ならconflictとreceiptを保持する", () => {
  const successfulFixture = createFixture("tasken-canonical-recovery-success");
  const successfulDatabases = [successfulFixture.database];
  const successfulClosedDatabases = new Set();
  const closeSuccessfulDatabase = (database) => {
    if (successfulClosedDatabases.has(database)) return;
    try { database.db.close(); } catch { /* already closed */ }
    successfulClosedDatabases.add(database);
  };
  try {
    successfulFixture.database.save("note", { id: "note-recovery-success", title: "Recovery", body_markdown: "旧本文" });
    const service = new WorkspaceService(successfulFixture.database, successfulFixture.userDataPath);
    const first = service.saveCanonicalNote(saveRequest(
      successfulFixture.database.get("note", "note-recovery-success"),
      "初回本文",
    ));
    const targetPath = canonicalBinding(first).canonical_path;
    const current = successfulFixture.database.get("note", "note-recovery-success");
    const failingRepository = new Proxy(successfulFixture.database, {
      get(target, property, receiver) {
        if (property === "save") return () => { throw new Error("injected DB failure"); };
        return Reflect.get(target, property, receiver);
      },
    });
    const failingService = new WorkspaceService(failingRepository, successfulFixture.userDataPath);
    assert.throws(
      () => failingService.saveCanonicalNote(saveRequest(current, "DB失敗後の本文")),
      /Tasken内部への保存に失敗/,
    );
    const receiptPath = path.join(successfulFixture.userDataPath, "canonical-markdown-recovery.json");
    assert.equal(fs.existsSync(receiptPath), true);
    closeSuccessfulDatabase(successfulFixture.database);

    const recoveredDatabase = new WorkspaceDatabase(path.join(successfulFixture.userDataPath, "workspace.sqlite"));
    successfulDatabases.push(recoveredDatabase);
    const recoveredService = new WorkspaceService(recoveredDatabase, successfulFixture.userDataPath);
    recoveredService.loadWorkspace();
    const recovered = recoveredDatabase.get("note", "note-recovery-success");
    const recoveredBinding = canonicalBinding(recovered);
    assert.equal(recovered.body_markdown, "DB失敗後の本文");
    assert.equal(recoveredBinding.sync_state, "in_sync");
    assert.equal(recoveredBinding.file_signature, markdownSignature(readFileSync(targetPath, "utf8")));
    assert.equal(fs.existsSync(receiptPath), false);
    closeSuccessfulDatabase(recoveredDatabase);
    successfulFixture.database = recoveredDatabase;
  } finally {
    for (const database of successfulDatabases) closeSuccessfulDatabase(database);
    rmSync(successfulFixture.userDataPath, { recursive: true, force: true });
  }

  const conflictFixture = createFixture("tasken-canonical-recovery-conflict");
  const conflictDatabases = [conflictFixture.database];
  const conflictClosedDatabases = new Set();
  const closeConflictDatabase = (database) => {
    if (conflictClosedDatabases.has(database)) return;
    try { database.db.close(); } catch { /* already closed */ }
    conflictClosedDatabases.add(database);
  };
  try {
    conflictFixture.database.save("note", { id: "note-recovery-conflict", title: "Recovery conflict", body_markdown: "旧本文" });
    const service = new WorkspaceService(conflictFixture.database, conflictFixture.userDataPath);
    const first = service.saveCanonicalNote(saveRequest(
      conflictFixture.database.get("note", "note-recovery-conflict"),
      "初回本文",
    ));
    const targetPath = canonicalBinding(first).canonical_path;
    const current = conflictFixture.database.get("note", "note-recovery-conflict");
    const failingRepository = new Proxy(conflictFixture.database, {
      get(target, property, receiver) {
        if (property === "save") return () => { throw new Error("injected DB failure"); };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () => new WorkspaceService(failingRepository, conflictFixture.userDataPath)
        .saveCanonicalNote(saveRequest(current, "復旧前の本文")),
      /Tasken内部への保存に失敗/,
    );
    writeFileSync(targetPath, "復旧前に外部変更された本文", "utf8");
    const receiptPath = path.join(conflictFixture.userDataPath, "canonical-markdown-recovery.json");
    closeConflictDatabase(conflictFixture.database);
    const recoveredDatabase = new WorkspaceDatabase(path.join(conflictFixture.userDataPath, "workspace.sqlite"));
    conflictDatabases.push(recoveredDatabase);
    new WorkspaceService(recoveredDatabase, conflictFixture.userDataPath).loadWorkspace();
    const recovered = recoveredDatabase.get("note", "note-recovery-conflict");
    assert.equal(recovered.body_markdown, "復旧前の本文");
    assert.equal(canonicalBinding(recovered).sync_state, "conflict");
    assert.equal(fs.existsSync(receiptPath), true);
    closeConflictDatabase(recoveredDatabase);
    conflictFixture.database = recoveredDatabase;
  } finally {
    for (const database of conflictDatabases) closeConflictDatabase(database);
    rmSync(conflictFixture.userDataPath, { recursive: true, force: true });
  }
});

test("即時read verification mismatchでDBへinternal_aheadを残した同一receiptは後続編集扱いせず復旧する", () => {
  const fixture = createFixture("tasken-canonical-recovery-verification-mismatch");
  try {
    fixture.database.save("note", { id: "note-recovery-verification", title: "Verification", body_markdown: "旧本文" });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-recovery-verification"),
      "初回本文",
    ));
    const current = fixture.database.get("note", "note-recovery-verification");
    const originalRead = service.readCanonicalFile.bind(service);
    let readCount = 0;
    Object.defineProperty(service, "readCanonicalFile", {
      configurable: true,
      value(filePath) {
        readCount += 1;
        const snapshot = originalRead(filePath);
        return readCount === 2 ? { ...snapshot, signature: "verification-mismatch" } : snapshot;
      },
    });
    const saved = service.saveCanonicalNote(saveRequest(current, "verification intended本文"));
    const savedBinding = canonicalBinding(saved);
    assert.equal(savedBinding.sync_state, "internal_ahead");
    assert.equal(saved.body_markdown, "verification intended本文");
    const receiptPath = path.join(fixture.userDataPath, "canonical-markdown-recovery.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))[0];
    assert.equal(savedBinding.last_operation_id, receipt.operationId);
    assert.equal(saved.version, Number(receipt.baseRevision) + 1);

    fixture.database.db.close();
    const recoveredDatabase = new WorkspaceDatabase(path.join(fixture.userDataPath, "workspace.sqlite"));
    const recoveredService = new WorkspaceService(recoveredDatabase, fixture.userDataPath);
    recoveredService.loadWorkspace();
    const recovered = recoveredDatabase.get("note", "note-recovery-verification");
    const recoveredBinding = canonicalBinding(recovered);
    assert.equal(recovered.body_markdown, "verification intended本文");
    assert.equal(recoveredBinding.sync_state, "in_sync");
    assert.equal(recoveredBinding.last_operation_id, receipt.operationId);
    assert.equal(fs.existsSync(receiptPath), false);
    recoveredDatabase.db.close();
    fixture.database = recoveredDatabase;
  } finally {
    try { fixture.database.db.close(); } catch { /* already closed */ }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("receiptより新しいDB本文・titleを再起動復旧で巻き戻さずconflictとして保持する", () => {
  const fixture = createFixture("tasken-canonical-recovery-newer-db");
  try {
    fixture.database.save("note", { id: "note-recovery-newer", title: "旧title", body_markdown: "旧本文" });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-recovery-newer"),
      "初回本文",
    ));
    const current = fixture.database.get("note", "note-recovery-newer");
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "save") return () => { throw new Error("injected DB failure"); };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () => new WorkspaceService(failingRepository, fixture.userDataPath)
        .saveCanonicalNote(saveRequest(current, "receipt本文")),
      /Tasken内部への保存に失敗/,
    );
    const receiptPath = path.join(fixture.userDataPath, "canonical-markdown-recovery.json");
    assert.equal(fs.existsSync(receiptPath), true);

    // fileはreceipt本文のまま、DBだけ先に別経路で更新された状態を作る。
    fixture.database.save("note", {
      ...fixture.database.get("note", "note-recovery-newer"),
      title: "新title",
      body_markdown: "新DB本文",
    });
    fixture.database.db.close();
    const restartedDatabase = new WorkspaceDatabase(path.join(fixture.userDataPath, "workspace.sqlite"));
    new WorkspaceService(restartedDatabase, fixture.userDataPath).loadWorkspace();
    const recovered = restartedDatabase.get("note", "note-recovery-newer");
    assert.equal(recovered.title, "新title");
    assert.equal(recovered.body_markdown, "新DB本文");
    assert.equal(canonicalBinding(recovered).sync_state, "conflict");
    assert.equal(fs.existsSync(receiptPath), true);
    const recoveredVersion = recovered.version;
    const recoveredUpdatedAt = recovered.updated_at;
    restartedDatabase.db.close();
    const secondRestartDatabase = new WorkspaceDatabase(path.join(fixture.userDataPath, "workspace.sqlite"));
    new WorkspaceService(secondRestartDatabase, fixture.userDataPath).loadWorkspace();
    const recoveredAgain = secondRestartDatabase.get("note", "note-recovery-newer");
    assert.equal(recoveredAgain.title, "新title");
    assert.equal(recoveredAgain.body_markdown, "新DB本文");
    assert.equal(recoveredAgain.version, recoveredVersion);
    assert.equal(recoveredAgain.updated_at, recoveredUpdatedAt);
    assert.equal(canonicalBinding(recoveredAgain).sync_state, "conflict");
    assert.equal(fs.existsSync(receiptPath), true);
    secondRestartDatabase.db.close();
    fixture.database = secondRestartDatabase;
  } finally {
    try { fixture.database.db.close(); } catch { /* already closed */ }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("旧receiptのconflict後に明示overwriteが成功したら同Noteのreceiptを解決し、再起動後はin_syncを保つ", () => {
  const fixture = createFixture("tasken-canonical-recovery-resolve");
  try {
    fixture.database.save("note", { id: "note-recovery-resolve", title: "Resolve", body_markdown: "旧本文" });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(saveRequest(
      fixture.database.get("note", "note-recovery-resolve"),
      "初回本文",
    ));
    const targetPath = canonicalBinding(first).canonical_path;
    const current = fixture.database.get("note", "note-recovery-resolve");
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "save") return () => { throw new Error("injected DB failure"); };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () => new WorkspaceService(failingRepository, fixture.userDataPath)
        .saveCanonicalNote(saveRequest(current, "receipt本文")),
      /Tasken内部への保存に失敗/,
    );
    writeFileSync(targetPath, "外部変更後の本文", "utf8");
    const receiptPath = path.join(fixture.userDataPath, "canonical-markdown-recovery.json");
    fixture.database.db.close();
    const conflictedDatabase = new WorkspaceDatabase(path.join(fixture.userDataPath, "workspace.sqlite"));
    new WorkspaceService(conflictedDatabase, fixture.userDataPath).loadWorkspace();
    const conflicted = conflictedDatabase.get("note", "note-recovery-resolve");
    assert.equal(canonicalBinding(conflicted).sync_state, "conflict");
    assert.equal(fs.existsSync(receiptPath), true);

    const overwritten = new WorkspaceService(conflictedDatabase, fixture.userDataPath).saveCanonicalNote(saveRequest(
      conflicted,
      "明示overwrite本文",
      { canonicalMarkdown: "overwrite" },
    ));
    assert.equal(canonicalBinding(overwritten).sync_state, "in_sync");
    assert.equal(readFileSync(targetPath, "utf8"), canonicalContent(overwritten));
    assert.equal(fs.existsSync(receiptPath), false);
    conflictedDatabase.db.close();

    const restartedDatabase = new WorkspaceDatabase(path.join(fixture.userDataPath, "workspace.sqlite"));
    new WorkspaceService(restartedDatabase, fixture.userDataPath).loadWorkspace();
    const restarted = restartedDatabase.get("note", "note-recovery-resolve");
    assert.equal(restarted.body_markdown, "明示overwrite本文");
    assert.equal(canonicalBinding(restarted).sync_state, "in_sync");
    assert.equal(fs.existsSync(receiptPath), false);
    restartedDatabase.db.close();
    fixture.database = restartedDatabase;
  } finally {
    try { fixture.database.db.close(); } catch { /* already closed */ }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("legacy Markdown bindingの起動migrationを2回行っても同一path・同一ファイルを保つ", () => {
  const fixture = createFixture("tasken-canonical-migration");
  try {
    const migrationAt = "2026-08-08T00:00:00.000Z";
    const legacyPath = path.join(fixture.userDataPath, "legacy-note.md");
    fixture.database.save("note", {
      id: "note-legacy",
      title: "Legacy note",
      body_markdown: "Legacy body",
      properties_json: {
        markdown_export: {
          filePath: legacyPath,
          directory: path.dirname(legacyPath),
          storageMode: "linked",
        },
      },
    });
    const legacySeed = fixture.database.get("note", "note-legacy");
    writeFileSync(legacyPath, canonicalContent(legacySeed), "utf8");
    const conflictPath = path.join(fixture.userDataPath, "legacy-conflict.md");
    writeFileSync(conflictPath, "外部で作られたMarkdown", "utf8");
    fixture.database.save("note", {
      id: "note-legacy-conflict",
      title: "Legacy conflict",
      body_markdown: "Legacy conflict body",
      properties_json: {
        markdown_export: {
          filePath: conflictPath,
          directory: path.dirname(conflictPath),
          storageMode: "linked",
        },
      },
    });
    fixture.database.save("note", {
      id: "note-legacy-relative",
      title: "Legacy relative",
      body_markdown: "Relative body",
      properties_json: {
        markdown_export: {
          filePath: "legacy-relative.md",
          directory: ".",
          storageMode: "linked",
        },
      },
    });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath, () => migrationAt);
    service.loadWorkspace();
    const first = fixture.database.get("note", "note-legacy");
    const firstBinding = canonicalBinding(first);
    const firstContent = readFileSync(legacyPath, "utf8");
    assert.equal(firstBinding.sync_state, "in_sync");
    assert.equal(first.updated_at, migrationAt);
    service.loadWorkspace();
    const second = fixture.database.get("note", "note-legacy");
    const secondBinding = canonicalBinding(second);
    assert.equal(firstBinding.canonical_path, legacyPath);
    assert.equal(secondBinding.canonical_path, firstBinding.canonical_path);
    assert.equal(readFileSync(legacyPath, "utf8"), firstContent);
    const conflicted = fixture.database.get("note", "note-legacy-conflict");
    assert.equal(canonicalBinding(conflicted).sync_state, "conflict");
    assert.equal(readFileSync(conflictPath, "utf8"), "外部で作られたMarkdown");
    assert.match(canonicalBinding(conflicted).last_error, /canonical本文と一致しません/);
    const relative = fixture.database.get("note", "note-legacy-relative");
    assert.equal(canonicalBinding(relative).sync_state, "unavailable");
    assert.match(canonicalBinding(relative).last_error, /absolute path/);
    assert.equal(readdirSync(fixture.userDataPath).filter((name) => name.endsWith(".md")).length, 2);
  } finally {
    closeFixture(fixture);
  }
});
