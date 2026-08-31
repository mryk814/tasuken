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
import {
  buildPersonalDefaultTheme,
  PERSONAL_DEFAULT_THEME_ID,
} from "../src/shared/personalTheme.mjs";
import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";

async function importWorkspaceService() {
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "tasken-canonical-service-bundle-"));
  const outputFile = path.join(outputDirectory, "workspaceService.mjs");
  const electronMock = {
    name: "electron-mock",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^electron$/ }, () => ({
        path: "electron-mock",
        namespace: "electron-mock",
      }));
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
      buildApi.onResolve({ filter: /^adm-zip$/ }, () => ({
        path: "adm-zip-mock",
        namespace: "adm-zip-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "adm-zip-mock" }, () => ({
        contents:
          "export default class AdmZip { constructor() { throw new Error('adm-zip is not used by canonical workspace behavior tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /^better-sqlite3$/ }, () => ({
        path: "better-sqlite3-mock",
        namespace: "better-sqlite3-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "better-sqlite3-mock" }, () => ({
        contents:
          "export default class Database { constructor() { throw new Error('database path is not used by canonical Markdown tests'); } }",
        loader: "js",
      }));
      buildApi.onResolve({ filter: /workspaceRepository\.mjs$/ }, () => ({
        path: "workspace-repository-mock",
        namespace: "workspace-repository-mock",
      }));
      buildApi.onLoad({ filter: /.*/, namespace: "workspace-repository-mock" }, () => ({
        contents:
          "export const workspaceEntityTypes = []; export const workspaceSchemaVersion = 1;",
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
const { ApplicationCommandService } = await (async () => {
  const result = await build({
    entryPoints: [path.resolve("src/main/services/applicationCommandService.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
})();

function createFixture(prefix) {
  const userDataPath = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const syncRoot = path.join(userDataPath, "TaskenSync");
  const database = new WorkspaceDatabase(path.join(userDataPath, "workspace.sqlite"));
  database.setPreference("artifactDirectory", syncRoot);
  database.save("theme", buildPersonalDefaultTheme());
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
    themeName: note.project_id === PERSONAL_DEFAULT_THEME_ID ? "個人業務" : "",
    updatedAt: note.updated_at || note.created_at,
    body: note.body_markdown,
  });
}

function applyProposalEnvelope(proposal, note, body, commandId = "note-ai-apply") {
  return {
    commandId,
    name: "ApplyAiProposal",
    payload: {
      proposal: { ...proposal, status: "accepted" },
      candidates: [{ type: "note", entity: { ...note, body_markdown: body } }],
    },
    actor: { kind: "user" },
    source: "main_ui",
    expectedVersions: [
      { type: "ai_proposal", id: proposal.id, version: Number(proposal.version || 0) },
      { type: "note", id: note.id, version: Number(note.version || 0) },
    ],
    issuedAt: "2026-08-09T00:00:00.000Z",
  };
}

function expectedCommandFingerprint(command) {
  return JSON.stringify({
    name: command.name,
    payload: command.payload,
    actor: command.actor,
    source: command.source,
    windowId: command.windowId || null,
    sessionId: command.sessionId || null,
    expectedVersions: command.expectedVersions || [],
    issuedAt: command.issuedAt,
  });
}

function artifactForThemeSync(overrides = {}) {
  return {
    id: "artifact-theme-sync",
    title: "Theme sync artifact",
    filename: "theme-sync.txt",
    file_type: "txt",
    mime_type: "text/plain",
    file_size: 1,
    stored_path: "C:/artifacts/theme-sync.txt",
    original_path: "C:/downloads/theme-sync.txt",
    source_type: "note",
    source_id: "note-artifact-theme-sync",
    ...overrides,
  };
}

test("Document保存はTheme未指定のNote・Report・日報を個人業務へ保存し、既存の無所属Noteは保存まで変えない", () => {
  const fixture = createFixture("tasken-canonical-personal-theme");
  try {
    fixture.database.save("note", {
      id: "legacy-unassigned",
      title: "既存の無所属",
      body_markdown: "既存本文",
      project_id: null,
    });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    // 既存データをmigrationや起動で一括更新しない。
    assert.equal(fixture.database.get("note", "legacy-unassigned").project_id, null);

    fixture.database.save("note", {
      id: "personal-note",
      title: "Theme未指定のNote",
      body_markdown: "本文",
    });
    const savedNote = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "personal-note"), "保存した本文"),
    );
    assert.equal(savedNote.project_id, PERSONAL_DEFAULT_THEME_ID);

    fixture.database.save("note", {
      id: "personal-report",
      title: "日報",
      note_type: "report",
      body_markdown: "日報本文",
    });
    const savedReport = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "personal-report"), "保存した日報本文"),
    );
    assert.equal(savedReport.note_type, "report");
    assert.equal(savedReport.project_id, PERSONAL_DEFAULT_THEME_ID);

    fixture.database.save("theme", { id: "theme-research", name: "調査" });
    fixture.database.save("note", {
      id: "explicit-theme",
      title: "明示Theme",
      body_markdown: "本文",
      project_id: "theme-research",
    });
    const savedExplicit = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "explicit-theme"), "保存した本文"),
    );
    assert.equal(savedExplicit.project_id, "theme-research");
  } finally {
    closeFixture(fixture);
  }
});

test("Document保存はNote/Report由来の未削除ArtifactのThemeを同期する", () => {
  const fixture = createFixture("tasken-document-artifact-theme-sync");
  try {
    fixture.database.save("project", { id: "theme-before", name: "Before", state: "active" });
    fixture.database.save("project", { id: "theme-after", name: "After", state: "active" });
    fixture.database.save("theme", { id: "theme-before", name: "Before" });
    fixture.database.save("theme", { id: "theme-after", name: "After" });
    fixture.database.save("note", {
      id: "note-artifact-theme-sync",
      title: "Artifact Theme Sync",
      body_markdown: "before",
      project_id: "theme-before",
    });
    fixture.database.save(
      "artifact",
      artifactForThemeSync({
        id: "artifact-owned-note",
        title: "Owned note artifact",
        source_type: "note",
        source_id: "note-artifact-theme-sync",
        theme_id: "theme-before",
      }),
    );
    fixture.database.save(
      "artifact",
      artifactForThemeSync({
        id: "artifact-owned-report",
        title: "Owned report artifact",
        source_type: "report",
        source_id: "note-artifact-theme-sync",
        theme_id: "theme-before",
      }),
    );
    fixture.database.save("note", {
      id: "another-note",
      title: "Unrelated owner",
      body_markdown: "unrelated",
    });
    fixture.database.save(
      "artifact",
      artifactForThemeSync({
        id: "artifact-unrelated",
        title: "Unrelated artifact",
        source_type: "note",
        source_id: "another-note",
        theme_id: "theme-before",
      }),
    );
    fixture.database.save(
      "artifact",
      artifactForThemeSync({
        id: "artifact-deleted",
        title: "Deleted artifact",
        source_type: "note",
        source_id: "note-artifact-theme-sync",
        theme_id: "theme-before",
      }),
    );
    fixture.database.remove("artifact", "artifact-deleted");

    const workspace = new WorkspaceService(fixture.database, fixture.userDataPath);
    const initial = fixture.database.get("note", "note-artifact-theme-sync");
    const ownedNote = fixture.database.get("artifact", "artifact-owned-note");
    const ownedReport = fixture.database.get("artifact", "artifact-owned-report");
    const saved = workspace.saveCanonicalNote(
      saveRequest({ ...initial, project_id: "theme-after" }, "after"),
    );

    assert.equal(saved.project_id, "theme-after");
    assert.equal(fixture.database.get("artifact", ownedNote.id).theme_id, "theme-after");
    assert.equal(fixture.database.get("artifact", ownedReport.id).theme_id, "theme-after");
    assert.equal(
      fixture.database.get("artifact", ownedNote.id).version,
      Number(ownedNote.version || 0) + 1,
    );
    assert.equal(
      fixture.database.get("artifact", ownedReport.id).version,
      Number(ownedReport.version || 0) + 1,
    );
    const savedWithoutTheme = workspace.saveCanonicalNote(
      saveRequest({ ...saved, project_id: null }, "after"),
    );
    assert.equal(savedWithoutTheme.project_id, PERSONAL_DEFAULT_THEME_ID);
    assert.equal(
      fixture.database.get("artifact", ownedNote.id).theme_id,
      PERSONAL_DEFAULT_THEME_ID,
    );
    assert.equal(
      fixture.database.get("artifact", ownedReport.id).theme_id,
      PERSONAL_DEFAULT_THEME_ID,
    );
    assert.equal(
      fixture.database.get("artifact", ownedNote.id).version,
      Number(ownedNote.version || 0) + 2,
    );
    assert.equal(
      fixture.database.get("artifact", ownedReport.id).version,
      Number(ownedReport.version || 0) + 2,
    );
    workspace.saveCanonicalNote(saveRequest(savedWithoutTheme, "after"));
    assert.equal(
      fixture.database.get("artifact", ownedNote.id).version,
      Number(ownedNote.version || 0) + 2,
    );
    assert.equal(
      fixture.database.get("artifact", ownedReport.id).version,
      Number(ownedReport.version || 0) + 2,
    );
    assert.equal(fixture.database.get("artifact", "artifact-unrelated").theme_id, "theme-before");
    const deleted = fixture.database.get("artifact", "artifact-deleted", true);
    assert.equal(deleted.theme_id, "theme-before");
    assert.ok(deleted.deleted_at);
  } finally {
    closeFixture(fixture);
  }
});

test("Document保存はArtifact更新失敗時にNote・Artifact・stable linkをtransaction rollbackする", () => {
  const fixture = createFixture("tasken-document-artifact-theme-rollback");
  try {
    fixture.database.save("project", { id: "theme-before", name: "Before", state: "active" });
    fixture.database.save("project", { id: "theme-after", name: "After", state: "active" });
    fixture.database.save("theme", { id: "theme-before", name: "Before" });
    fixture.database.save("theme", { id: "theme-after", name: "After" });
    fixture.database.save("note", {
      id: "note-artifact-theme-rollback",
      title: "Artifact Theme Rollback",
      body_markdown: "[[task:stable-task-rollback|before]]",
      project_id: "theme-before",
    });
    fixture.database.save("task", {
      id: "stable-task-rollback",
      title: "Stable target",
      state: "todo",
    });
    fixture.database.save(
      "artifact",
      artifactForThemeSync({
        id: "artifact-theme-rollback",
        title: "Rollback artifact",
        source_type: "note",
        source_id: "note-artifact-theme-rollback",
        theme_id: "theme-before",
      }),
    );
    const workspace = new WorkspaceService(fixture.database, fixture.userDataPath);
    const initial = workspace.saveCanonicalNote(
      saveRequest(
        fixture.database.get("note", "note-artifact-theme-rollback"),
        "[[task:stable-task-rollback|before]]",
      ),
    );
    const stableReference = fixture.database
      .list("reference", true)
      .find((reference) => reference.metadata?.syntax === "typed-stable-link/v1");
    assert.ok(stableReference);
    const beforeArtifact = fixture.database.get("artifact", "artifact-theme-rollback");
    fixture.database.db.exec(`
      CREATE TRIGGER fail_artifact_theme_sync
      BEFORE UPDATE ON entities
      WHEN NEW.entity_type = 'artifact' AND NEW.id = 'artifact-theme-rollback'
      BEGIN
        SELECT RAISE(ABORT, 'injected artifact theme update failure');
      END;
    `);

    assert.throws(
      () =>
        workspace.saveCanonicalNote(
          saveRequest({ ...initial, project_id: "theme-after" }, "after"),
        ),
      /Tasken内部への保存に失敗/,
    );
    const afterNote = fixture.database.get("note", initial.id);
    const afterArtifact = fixture.database.get("artifact", beforeArtifact.id);
    const afterReference = fixture.database.get("reference", stableReference.id, true);
    assert.equal(afterNote.project_id, "theme-before");
    assert.equal(afterNote.body_markdown, "[[task:stable-task-rollback|before]]");
    assert.equal(afterNote.version, initial.version);
    assert.equal(afterArtifact.theme_id, "theme-before");
    assert.equal(afterArtifact.version, beforeArtifact.version);
    assert.equal(afterReference.deleted_at, null);
    assert.equal(afterReference.version, stableReference.version);
  } finally {
    closeFixture(fixture);
  }
});

test("Note AI accept couples canonical file, Note, Proposal, and command receipt", () => {
  const fixture = createFixture("tasken-note-ai-canonical-apply");
  try {
    fixture.database.save("note", {
      id: "note-ai-canonical",
      title: "AI Note",
      body_markdown: "before",
      ai_visibility: ["external_ai"],
    });
    const workspace = new WorkspaceService(fixture.database, fixture.userDataPath);
    const initial = workspace.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-ai-canonical"), "before"),
    );
    const proposal = fixture.database.save("ai_proposal", {
      id: "proposal-canonical",
      source: "embedded_llm",
      payload_type: "notes",
      status: "pending",
      payload: { notes: [{ target_id: initial.id, body: "after" }] },
      request: { target: { type: "note", id: initial.id } },
    });
    const command = new ApplicationCommandService(fixture.database);
    const receipt = command.executeCanonicalNoteAiProposal(
      applyProposalEnvelope(proposal, initial, "after"),
      (candidate, operations) =>
        workspace.saveCanonicalNote(saveRequest(candidate, "after"), operations),
    );
    const saved = fixture.database.get("note", initial.id);
    assert.equal(saved.body_markdown, "after");
    assert.equal(fixture.database.get("ai_proposal", proposal.id).status, "accepted");
    assert.equal(
      readFileSync(canonicalBinding(saved).canonical_path, "utf8"),
      canonicalContent(saved),
    );
    assert.deepEqual(
      receipt.changes.map(({ type }) => type),
      ["note", "ai_proposal"],
    );
    assert.equal(receipt.events.length, 1);
    assert.equal(
      JSON.parse(fixture.database.get("change_event", receipt.events[0], true).receipt_json)
        .commandId,
      "note-ai-apply",
    );
  } finally {
    closeFixture(fixture);
  }
});

test("legacy draft_workspace data survives canonical Note read and save without an active AI route", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tasken-legacy-draft-"));
  const database = new WorkspaceDatabase(path.join(root, "workspace.sqlite"));
  try {
    const legacyDraft = {
      sources: [{ id: "source-1", body: "# old draft", ai_service: "legacy" }],
      snapshots: [{ id: "snapshot-1", body: "# edited" }],
    };
    const note = database.save("note", {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Legacy note",
      body: "# Canonical",
      properties_json: { draft_workspace: legacyDraft, retained: true },
    });
    database.save("note", { ...note, title: "Legacy note updated" });
    assert.deepEqual(database.get("note", note.id).properties_json.draft_workspace, legacyDraft);

    const notes = readFileSync("src/renderer/src/features/workspace/pages/NotesPage.tsx", "utf8");
    const app = readFileSync("src/renderer/src/features/workspace/WorkspaceApp.tsx", "utf8");
    assert.doesNotMatch(notes, /NoteAiDrawer|Note AI|selection-ai/);
    assert.doesNotMatch(app, /notes:note-ai|notes:selection-ai|Note AI/);
  } finally {
    database.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Note AI receipt後書き失敗後もdurable markerから同commandを再生する", () => {
  const fixture = createFixture("tasken-note-ai-command-marker");
  let initialClosed = false;
  let restartedDatabase = null;
  try {
    fixture.database.save("note", {
      id: "note-ai-marker",
      title: "AI Marker",
      body_markdown: "before",
    });
    const workspace = new WorkspaceService(fixture.database, fixture.userDataPath);
    const initial = workspace.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-ai-marker"), "before"),
    );
    const proposal = fixture.database.save("ai_proposal", {
      id: "proposal-marker",
      source: "embedded_llm",
      payload_type: "notes",
      status: "pending",
      payload: { notes: [{ target_id: initial.id, body: "after marker" }] },
      request: { target: { type: "note", id: initial.id } },
    });
    const envelope = applyProposalEnvelope(
      proposal,
      initial,
      "after marker",
      "note-ai-marker-command",
    );
    const retryEnvelope = structuredClone(envelope);
    const receiptWriteFailure = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "save")
          return (type, entity, options) => {
            if (type === "change_event" && typeof entity?.receipt_json === "string")
              throw new Error("injected receipt write failure");
            return target.save(type, entity, options);
          };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () =>
        new ApplicationCommandService(receiptWriteFailure).executeCanonicalNoteAiProposal(
          structuredClone(envelope),
          (candidate, companion) =>
            workspace.saveCanonicalNote(saveRequest(candidate, "after marker"), companion),
        ),
      /receipt write failure/,
    );
    assert.equal(fixture.database.get("note", initial.id).body_markdown, "after marker");
    assert.equal(fixture.database.get("ai_proposal", proposal.id).status, "accepted");
    fixture.database.db.close();
    initialClosed = true;
    restartedDatabase = new WorkspaceDatabase(path.join(fixture.userDataPath, "workspace.sqlite"));
    const durableEvent = restartedDatabase
      .list("change_event", true)
      .find((entry) => entry.command_id === envelope.commandId);
    const durableMarker = durableEvent.metadata.note_ai_command_marker;
    assert.equal(durableEvent.command_fingerprint, durableMarker.commandFingerprint);
    assert.equal(durableEvent.command_fingerprint, expectedCommandFingerprint(retryEnvelope));
    const replay = new ApplicationCommandService(restartedDatabase).executeCanonicalNoteAiProposal(
      retryEnvelope,
      () => {
        throw new Error("replay must not save again");
      },
    );
    assert.equal(replay.commandId, envelope.commandId);
    assert.equal(replay.status, "applied");
    assert.equal(replay.replayed, true);
    const event = restartedDatabase
      .list("change_event", true)
      .find((entry) => entry.command_id === envelope.commandId);
    assert.equal(JSON.parse(event.receipt_json).commandId, envelope.commandId);
  } finally {
    if (restartedDatabase) restartedDatabase.db.close();
    if (!initialClosed) fixture.database.db.close();
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("Note AI canonical DB failure recovery restores Proposal with the Note", () => {
  const fixture = createFixture("tasken-note-ai-canonical-recovery");
  const databases = [fixture.database];
  try {
    fixture.database.save("note", {
      id: "note-ai-recovery",
      title: "AI Recovery",
      body_markdown: "before",
    });
    const workspace = new WorkspaceService(fixture.database, fixture.userDataPath);
    const initial = workspace.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-ai-recovery"), "before"),
    );
    const proposal = fixture.database.save("ai_proposal", {
      id: "proposal-recovery",
      source: "embedded_llm",
      payload_type: "notes",
      status: "pending",
      payload: { notes: [{ target_id: initial.id, body: "after recovery" }] },
      request: { target: { type: "note", id: initial.id } },
    });
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "saveMany")
          return () => {
            throw new Error("injected Note AI transaction failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const failingWorkspace = new WorkspaceService(failingRepository, fixture.userDataPath);
    const command = new ApplicationCommandService(fixture.database);
    assert.throws(
      () =>
        command.executeCanonicalNoteAiProposal(
          applyProposalEnvelope(proposal, initial, "after recovery", "note-ai-recovery-command"),
          (candidate, operations) =>
            failingWorkspace.saveCanonicalNote(
              saveRequest(candidate, "after recovery"),
              operations,
            ),
        ),
      /Tasken内部への保存に失敗/,
    );
    assert.equal(fixture.database.get("ai_proposal", proposal.id).status, "pending");
    fixture.database.db.close();
    const recoveredDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
    databases.push(recoveredDatabase);
    new WorkspaceService(recoveredDatabase, fixture.userDataPath).loadWorkspace();
    assert.equal(recoveredDatabase.get("note", initial.id).body_markdown, "after recovery");
    assert.equal(recoveredDatabase.get("ai_proposal", proposal.id).status, "accepted");
    recoveredDatabase.db.close();
  } finally {
    for (const database of databases) {
      try {
        database.db.close();
      } catch {
        /* closed */
      }
    }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("改ざんされたNote AI recovery companionは任意Entityへ適用せず隔離する", () => {
  const fixture = createFixture("tasken-note-ai-recovery-quarantine");
  try {
    fixture.database.save("note", {
      id: "note-ai-quarantine",
      title: "AI Quarantine",
      body_markdown: "before",
    });
    const workspace = new WorkspaceService(fixture.database, fixture.userDataPath);
    const initial = workspace.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-ai-quarantine"), "before"),
    );
    const proposal = fixture.database.save("ai_proposal", {
      id: "proposal-quarantine",
      source: "embedded_llm",
      payload_type: "notes",
      status: "pending",
      payload: { notes: [{ target_id: initial.id, body: "after quarantine" }] },
      request: { target: { type: "note", id: initial.id } },
    });
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "saveMany")
          return () => {
            throw new Error("injected quarantine transaction failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () =>
        new ApplicationCommandService(fixture.database).executeCanonicalNoteAiProposal(
          applyProposalEnvelope(
            proposal,
            initial,
            "after quarantine",
            "note-ai-quarantine-command",
          ),
          (candidate, companion) =>
            new WorkspaceService(failingRepository, fixture.userDataPath).saveCanonicalNote(
              saveRequest(candidate, "after quarantine"),
              companion,
            ),
        ),
      /Tasken内部への保存に失敗/,
    );
    const recoveryPath = path.join(fixture.userDataPath, "canonical-markdown-recovery.json");
    const receipts = JSON.parse(readFileSync(recoveryPath, "utf8"));
    receipts[0].noteAiCompanion.event.entity_id = "another-note";
    receipts[0].additionalOperations = [
      { action: "save", type: "resource", entity: { id: "forged-resource", title: "forged" } },
    ];
    writeFileSync(recoveryPath, `${JSON.stringify(receipts, null, 2)}\n`, "utf8");

    new WorkspaceService(fixture.database, fixture.userDataPath).loadWorkspace();
    assert.equal(fixture.database.get("note", initial.id).body_markdown, "before");
    assert.equal(fixture.database.get("ai_proposal", proposal.id).status, "pending");
    assert.equal(fixture.database.get("resource", "forged-resource", true), null);
    assert.equal(fs.existsSync(recoveryPath), false);
    assert.ok(
      readdirSync(fixture.userDataPath).some((name) =>
        name.startsWith("canonical-markdown-recovery.json.corrupt-"),
      ),
    );
    assert.equal(
      fs.existsSync(path.join(fixture.userDataPath, "canonical-markdown-recovery-warning.json")),
      true,
    );
  } finally {
    closeFixture(fixture);
  }
});

function conversationLineageCompanion(noteId, resourceId, id = `reference-${noteId}`) {
  return {
    action: "save",
    type: "reference",
    entity: {
      id,
      source_type: "note",
      source_id: noteId,
      target_type: "resource",
      target_id: resourceId,
      relation_type: "derived_from",
      note: "Conversationの明示操作から作成",
      created_at: "2026-08-09T01:00:00.000Z",
    },
    options: { source: "manual", reason: "created_from_conversation" },
  };
}

test("Conversation起点Noteはdocument:saveで正本Markdownとderived_from Referenceを同時に確定する", () => {
  const fixture = createFixture("tasken-canonical-conversation-lineage");
  try {
    fixture.database.save("resource", {
      id: "conversation-canonical",
      title: "元Conversation",
      resource_scope: "chat_ref",
      url: "https://example.com/conversation",
    });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const note = { id: "note-from-conversation", title: "会話からのNote", version: 0 };
    const saved = service.saveCanonicalNote({
      ...saveRequest(note, "Conversationから保存した本文"),
      companions: [conversationLineageCompanion(note.id, "conversation-canonical")],
    });

    const binding = canonicalBinding(saved);
    const reference = fixture.database.get("reference", "reference-note-from-conversation");
    assert.equal(saved.body_markdown, "Conversationから保存した本文");
    assert.equal(binding.sync_state, "in_sync");
    assert.equal(readFileSync(binding.canonical_path, "utf8"), canonicalContent(saved));
    assert.deepEqual(
      {
        source_type: reference.source_type,
        source_id: reference.source_id,
        target_type: reference.target_type,
        target_id: reference.target_id,
        relation_type: reference.relation_type,
      },
      {
        source_type: "note",
        source_id: note.id,
        target_type: "resource",
        target_id: "conversation-canonical",
        relation_type: "derived_from",
      },
    );

    assert.throws(
      () =>
        service.saveCanonicalNote({
          ...saveRequest({ id: "note-invalid-companion", title: "Invalid", version: 0 }, "本文"),
          companions: [
            {
              ...conversationLineageCompanion("note-invalid-companion", "conversation-canonical"),
              entity: {
                ...conversationLineageCompanion("note-invalid-companion", "conversation-canonical")
                  .entity,
                relation_type: "mentions",
              },
            },
          ],
        }),
      /predicateはderived_from/,
    );
    assert.equal(fixture.database.get("note", "note-invalid-companion"), null);

    const missingTargetNote = {
      id: "note-missing-lineage-target",
      title: "Missing target",
      version: 0,
    };
    assert.throws(
      () =>
        service.saveCanonicalNote({
          ...saveRequest(missingTargetNote, "transaction rollback本文"),
          companions: [
            conversationLineageCompanion(
              missingTargetNote.id,
              "missing-conversation",
              "reference-missing-target",
            ),
          ],
        }),
      /Tasken内部への保存に失敗/,
    );
    // saveMany内ではNoteが先だが、Reference検証失敗時はtransaction全体を戻す。
    assert.equal(fixture.database.get("note", missingTargetNote.id), null);
    assert.equal(fixture.database.get("reference", "reference-missing-target"), null);
  } finally {
    closeFixture(fixture);
  }
});

test("Conversation起点Noteのfile成功・DB失敗receiptはNoteとReferenceを同じtransactionで復旧する", () => {
  const fixture = createFixture("tasken-canonical-conversation-recovery");
  const databases = [fixture.database];
  try {
    fixture.database.save("resource", {
      id: "conversation-recovery",
      title: "復旧元Conversation",
      resource_scope: "chat_ref",
      url: "https://example.com/recovery",
    });
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "saveMany")
          return () => {
            throw new Error("injected companion transaction failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const service = new WorkspaceService(failingRepository, fixture.userDataPath);
    const note = { id: "note-conversation-recovery", title: "復旧するNote", version: 0 };
    assert.throws(
      () =>
        service.saveCanonicalNote({
          ...saveRequest(note, "復旧対象本文"),
          companions: [
            conversationLineageCompanion(
              note.id,
              "conversation-recovery",
              "reference-conversation-recovery",
            ),
          ],
        }),
      /Tasken内部への保存に失敗/,
    );
    assert.equal(fixture.database.get("note", note.id), null);
    assert.equal(fixture.database.get("reference", "reference-conversation-recovery"), null);
    const receiptPath = path.join(fixture.userDataPath, "canonical-markdown-recovery.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))[0];
    assert.equal(receipt.companions[0].type, "reference");

    fixture.database.db.close();
    const recoveredDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
    databases.push(recoveredDatabase);
    new WorkspaceService(recoveredDatabase, fixture.userDataPath).loadWorkspace();
    const recovered = recoveredDatabase.get("note", note.id);
    const recoveredReference = recoveredDatabase.get(
      "reference",
      "reference-conversation-recovery",
    );
    assert.equal(recovered.body_markdown, "復旧対象本文");
    assert.equal(canonicalBinding(recovered).sync_state, "in_sync");
    assert.equal(recoveredReference.source_id, note.id);
    assert.equal(recoveredReference.target_id, "conversation-recovery");
    assert.equal(fs.existsSync(receiptPath), false);
    recoveredDatabase.db.close();
    fixture.database = recoveredDatabase;
  } finally {
    for (const database of databases) {
      try {
        database.db.close();
      } catch {
        /* already closed */
      }
    }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("canonical Markdown saveはstable links_toを同一transactionでreconcileする", () => {
  const fixture = createFixture("tasken-canonical-stable-links");
  try {
    fixture.database.save("task", { id: "stable-task-a", title: "旧title", state: "todo" });
    fixture.database.save("task", { id: "stable-task-b", title: "次のTask", state: "todo" });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(
      saveRequest(
        { id: "stable-note", title: "Stable Note", version: 0 },
        "[[task:stable-task-a|旧title]]",
      ),
    );
    const firstStable = fixture.database
      .list("reference", true)
      .find((reference) => reference.metadata?.syntax === "typed-stable-link/v1");
    assert.ok(firstStable);
    assert.equal(firstStable.target_id, "stable-task-a");
    const sameBody = service.saveCanonicalNote(
      saveRequest(first, "[[task:stable-task-a|旧title]]"),
    );
    assert.equal(fixture.database.get("reference", firstStable.id).version, firstStable.version);
    fixture.database.save("reference", {
      id: "manual-links-to",
      source_type: "note",
      source_id: "stable-note",
      target_type: "task",
      target_id: "stable-task-b",
      relation_type: "links_to",
    });

    const second = service.saveCanonicalNote(
      saveRequest(sameBody, "前方へ本文を追加\n[[task:stable-task-a|rename後も同じ接続]]"),
    );
    const afterRename = fixture.database
      .list("reference", true)
      .filter((reference) => reference.metadata?.syntax === "typed-stable-link/v1");
    assert.equal(afterRename.length, 1);
    assert.equal(afterRename[0].id, firstStable.id);
    assert.equal(afterRename[0].metadata.raw_alias, "rename後も同じ接続");

    const replaced = service.saveCanonicalNote(
      saveRequest(second, "[[task:stable-task-b|置換先]]"),
    );
    const allReferences = fixture.database.list("reference", true);
    const oldStable = allReferences.find((reference) => reference.id === firstStable.id);
    const activeStable = allReferences.filter(
      (reference) => reference.metadata?.syntax === "typed-stable-link/v1" && !reference.deleted_at,
    );
    assert.ok(oldStable.deleted_at);
    assert.equal(activeStable.length, 1);
    assert.equal(activeStable[0].target_id, "stable-task-b");
    assert.equal(fixture.database.get("reference", "manual-links-to").target_id, "stable-task-b");

    service.saveCanonicalNote(saveRequest(replaced, "[[task:stable-task-a|再追加]]"));
    const restoredReferences = fixture.database.list("reference", true);
    const restoredStable = restoredReferences.find((reference) => reference.id === firstStable.id);
    assert.equal(restoredStable.deleted_at, null);
    assert.equal(restoredStable.target_id, "stable-task-a");
    assert.equal(
      restoredReferences.filter(
        (reference) =>
          reference.metadata?.syntax === "typed-stable-link/v1" && !reference.deleted_at,
      ).length,
      1,
    );
  } finally {
    closeFixture(fixture);
  }
});

test("stable link Reference失敗時はNote更新と既存relation変更をtransaction rollbackする", () => {
  const fixture = createFixture("tasken-canonical-stable-link-rollback");
  try {
    fixture.database.save("task", { id: "rollback-task-a", title: "A", state: "todo" });
    fixture.database.save("task", { id: "rollback-task-b", title: "B", state: "todo" });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(
      saveRequest(
        { id: "rollback-note", title: "Rollback Note", version: 0 },
        "[[task:rollback-task-a|A]]",
      ),
    );
    const existingLink = fixture.database
      .list("reference")
      .find((reference) => reference.metadata?.syntax === "typed-stable-link/v1");
    assert.throws(
      () =>
        service.saveCanonicalNote({
          ...saveRequest(first, "[[task:rollback-task-b|B]]"),
          companions: [
            conversationLineageCompanion(
              first.id,
              "missing-conversation",
              "invalid-rollback-reference",
            ),
          ],
        }),
      /Tasken内部への保存に失敗/,
    );
    assert.equal(
      fixture.database.get("note", first.id).body_markdown,
      "[[task:rollback-task-a|A]]",
    );
    assert.equal(fixture.database.get("reference", existingLink.id).deleted_at, null);
    assert.equal(
      fixture.database
        .list("reference")
        .some(
          (reference) =>
            reference.target_id === "rollback-task-b" &&
            reference.metadata?.syntax === "typed-stable-link/v1",
        ),
      false,
    );
  } finally {
    closeFixture(fixture);
  }
});

test("stable links_toはfile成功・DB失敗receiptからNoteと同じtransactionで復旧する", () => {
  const fixture = createFixture("tasken-canonical-stable-link-recovery");
  try {
    fixture.database.save("task", {
      id: "stable-recovery-task",
      title: "Recovery Task",
      state: "todo",
    });
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "saveMany")
          return () => {
            throw new Error("injected stable-link transaction failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const note = { id: "stable-recovery-note", title: "Recovery Note", version: 0 };
    assert.throws(
      () =>
        new WorkspaceService(failingRepository, fixture.userDataPath).saveCanonicalNote(
          saveRequest(note, "[[task:stable-recovery-task|Recovery Task]]"),
        ),
      /Tasken内部への保存に失敗/,
    );
    assert.equal(fixture.database.get("note", note.id), null);
    assert.equal(
      fixture.database.list("reference").some((reference) => reference.source_id === note.id),
      false,
    );

    fixture.database.db.close();
    const recoveredDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
    fixture.database = recoveredDatabase;
    new WorkspaceService(recoveredDatabase, fixture.userDataPath).loadWorkspace();
    const recovered = recoveredDatabase.get("note", note.id);
    const recoveredLink = recoveredDatabase
      .list("reference")
      .find(
        (reference) => reference.source_id === note.id && reference.relation_type === "links_to",
      );
    assert.equal(recovered.body_markdown, "[[task:stable-recovery-task|Recovery Task]]");
    assert.equal(recoveredLink.target_id, "stable-recovery-task");
    assert.equal(
      fs.existsSync(path.join(fixture.userDataPath, "canonical-markdown-recovery.json")),
      false,
    );
  } finally {
    closeFixture(fixture);
  }
});

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

    const second = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-canonical-save"), "Tasken本文 2"),
    );
    const secondBinding = canonicalBinding(second);
    assert.equal(second.title, "Original title");
    assert.equal(secondBinding.canonical_path, firstBinding.canonical_path);
    assert.equal(secondBinding.sync_state, "in_sync");
    assert.equal(readFileSync(secondBinding.canonical_path, "utf8"), canonicalContent(second));

    const renamed = service.saveCanonicalNote({
      ...saveRequest(fixture.database.get("note", "note-canonical-save"), "Tasken本文 3"),
      entity: {
        ...fixture.database.get("note", "note-canonical-save"),
        title: "Renamed title",
        body_markdown: "Tasken本文 3",
      },
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
    fixture.database.save("note", {
      id: "note-metadata",
      title: "Metadata",
      body_markdown: "本文",
    });
    const first = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-metadata"), "本文"),
    );
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
    assert.deepEqual(metadata.properties_json, {
      heading_numbers: true,
      heading_number_levels: [2, 3],
      canonical_markdown: canonicalBinding(metadata),
    });
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
      () =>
        service.saveCanonicalNote(
          saveRequest({ ...before, version: before.version - 1 }, "古い編集"),
        ),
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
    fixture.database.save("note", {
      id: "note-conflict",
      title: "Conflict",
      body_markdown: "本文",
    });
    const initial = fixture.database.get("note", "note-conflict");
    const first = service.saveCanonicalNote(saveRequest(initial, "初回Tasken本文"));
    const filePath = canonicalBinding(first).canonical_path;
    writeFileSync(filePath, "外部エディタの本文", "utf8");

    const conflicted = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-conflict"), "Tasken draft"),
    );
    assert.equal(conflicted.body_markdown, "Tasken draft");
    assert.equal(readFileSync(filePath, "utf8"), "外部エディタの本文");
    assert.equal(canonicalBinding(conflicted).sync_state, "conflict");

    const overwritten = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-conflict"), "Tasken draft", {
        canonicalMarkdown: "overwrite",
      }),
    );
    assert.equal(overwritten.body_markdown, conflicted.body_markdown);
    assert.equal(canonicalBinding(overwritten).sync_state, "in_sync");
    assert.equal(readFileSync(filePath, "utf8"), canonicalContent(overwritten));
    assert.equal(
      canonicalBinding(overwritten).file_signature,
      markdownSignature(readFileSync(filePath, "utf8")),
    );
  } finally {
    closeFixture(fixture);
  }
});

test("正本Markdownの保存先復旧後は本文を変更せず再試行して同一pathへ同期する", () => {
  const fixture = createFixture("tasken-canonical-retry");
  try {
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    fixture.database.save("note", {
      id: "note-retry",
      title: "Retry",
      body_markdown: "初期本文",
    });
    const first = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-retry"), "保存済み本文"),
    );
    const filePath = canonicalBinding(first).canonical_path;
    assert.ok(filePath.startsWith(`${fixture.syncRoot}${path.sep}`));
    const backupPath = `${filePath}.fixture-backup`;
    fs.renameSync(filePath, backupPath);
    fs.mkdirSync(filePath);

    const unavailable = service.saveCanonicalNote(saveRequest(first, "Markdownだけ未同期の本文"));
    assert.equal(unavailable.body_markdown, "Markdownだけ未同期の本文");
    assert.equal(canonicalBinding(unavailable).sync_state, "unavailable");
    assert.equal(
      fixture.database.get("note", "note-retry").body_markdown,
      unavailable.body_markdown,
    );

    fs.rmdirSync(filePath);
    fs.renameSync(backupPath, filePath);
    const retried = service.saveCanonicalNote(saveRequest(unavailable, unavailable.body_markdown));
    assert.equal(retried.body_markdown, unavailable.body_markdown);
    assert.equal(canonicalBinding(retried).canonical_path, filePath);
    assert.equal(canonicalBinding(retried).sync_state, "in_sync");
    assert.equal(readFileSync(filePath, "utf8"), canonicalContent(retried));
    assert.equal(canonicalBinding(retried).last_synced_revision, retried.version);
    assert.equal(fixture.database.list("artifact").length, 0);
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
    try {
      database.db.close();
    } catch {
      /* already closed */
    }
    successfulClosedDatabases.add(database);
  };
  try {
    successfulFixture.database.save("note", {
      id: "note-recovery-success",
      title: "Recovery",
      body_markdown: "旧本文",
    });
    const service = new WorkspaceService(
      successfulFixture.database,
      successfulFixture.userDataPath,
    );
    const first = service.saveCanonicalNote(
      saveRequest(successfulFixture.database.get("note", "note-recovery-success"), "初回本文"),
    );
    const targetPath = canonicalBinding(first).canonical_path;
    const current = successfulFixture.database.get("note", "note-recovery-success");
    const failingRepository = new Proxy(successfulFixture.database, {
      get(target, property, receiver) {
        if (property === "save")
          return () => {
            throw new Error("injected DB failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    const failingService = new WorkspaceService(failingRepository, successfulFixture.userDataPath);
    assert.throws(
      () => failingService.saveCanonicalNote(saveRequest(current, "DB失敗後の本文")),
      /Tasken内部への保存に失敗/,
    );
    const receiptPath = path.join(
      successfulFixture.userDataPath,
      "canonical-markdown-recovery.json",
    );
    assert.equal(fs.existsSync(receiptPath), true);
    closeSuccessfulDatabase(successfulFixture.database);

    const recoveredDatabase = new WorkspaceDatabase(
      path.join(successfulFixture.userDataPath, "workspace.sqlite"),
    );
    successfulDatabases.push(recoveredDatabase);
    const recoveredService = new WorkspaceService(
      recoveredDatabase,
      successfulFixture.userDataPath,
    );
    recoveredService.loadWorkspace();
    const recovered = recoveredDatabase.get("note", "note-recovery-success");
    const recoveredBinding = canonicalBinding(recovered);
    assert.equal(recovered.body_markdown, "DB失敗後の本文");
    assert.equal(recoveredBinding.sync_state, "in_sync");
    assert.equal(
      recoveredBinding.file_signature,
      markdownSignature(readFileSync(targetPath, "utf8")),
    );
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
    try {
      database.db.close();
    } catch {
      /* already closed */
    }
    conflictClosedDatabases.add(database);
  };
  try {
    conflictFixture.database.save("note", {
      id: "note-recovery-conflict",
      title: "Recovery conflict",
      body_markdown: "旧本文",
    });
    const service = new WorkspaceService(conflictFixture.database, conflictFixture.userDataPath);
    const first = service.saveCanonicalNote(
      saveRequest(conflictFixture.database.get("note", "note-recovery-conflict"), "初回本文"),
    );
    const targetPath = canonicalBinding(first).canonical_path;
    const current = conflictFixture.database.get("note", "note-recovery-conflict");
    const failingRepository = new Proxy(conflictFixture.database, {
      get(target, property, receiver) {
        if (property === "save")
          return () => {
            throw new Error("injected DB failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () =>
        new WorkspaceService(failingRepository, conflictFixture.userDataPath).saveCanonicalNote(
          saveRequest(current, "復旧前の本文"),
        ),
      /Tasken内部への保存に失敗/,
    );
    writeFileSync(targetPath, "復旧前に外部変更された本文", "utf8");
    const receiptPath = path.join(conflictFixture.userDataPath, "canonical-markdown-recovery.json");
    closeConflictDatabase(conflictFixture.database);
    const recoveredDatabase = new WorkspaceDatabase(
      path.join(conflictFixture.userDataPath, "workspace.sqlite"),
    );
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
    fixture.database.save("note", {
      id: "note-recovery-verification",
      title: "Verification",
      body_markdown: "旧本文",
    });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-recovery-verification"), "初回本文"),
    );
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
    const recoveredDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
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
    try {
      fixture.database.db.close();
    } catch {
      /* already closed */
    }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("receiptより新しいDB本文・titleを再起動復旧で巻き戻さずconflictとして保持する", () => {
  const fixture = createFixture("tasken-canonical-recovery-newer-db");
  try {
    fixture.database.save("note", {
      id: "note-recovery-newer",
      title: "旧title",
      body_markdown: "旧本文",
    });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-recovery-newer"), "初回本文"),
    );
    const current = fixture.database.get("note", "note-recovery-newer");
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "save")
          return () => {
            throw new Error("injected DB failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () =>
        new WorkspaceService(failingRepository, fixture.userDataPath).saveCanonicalNote(
          saveRequest(current, "receipt本文"),
        ),
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
    const restartedDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
    new WorkspaceService(restartedDatabase, fixture.userDataPath).loadWorkspace();
    const recovered = restartedDatabase.get("note", "note-recovery-newer");
    assert.equal(recovered.title, "新title");
    assert.equal(recovered.body_markdown, "新DB本文");
    assert.equal(canonicalBinding(recovered).sync_state, "conflict");
    assert.equal(fs.existsSync(receiptPath), true);
    const recoveredVersion = recovered.version;
    const recoveredUpdatedAt = recovered.updated_at;
    restartedDatabase.db.close();
    const secondRestartDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
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
    try {
      fixture.database.db.close();
    } catch {
      /* already closed */
    }
    rmSync(fixture.userDataPath, { recursive: true, force: true });
  }
});

test("旧receiptのconflict後に明示overwriteが成功したら同Noteのreceiptを解決し、再起動後はin_syncを保つ", () => {
  const fixture = createFixture("tasken-canonical-recovery-resolve");
  try {
    fixture.database.save("note", {
      id: "note-recovery-resolve",
      title: "Resolve",
      body_markdown: "旧本文",
    });
    const service = new WorkspaceService(fixture.database, fixture.userDataPath);
    const first = service.saveCanonicalNote(
      saveRequest(fixture.database.get("note", "note-recovery-resolve"), "初回本文"),
    );
    const targetPath = canonicalBinding(first).canonical_path;
    const current = fixture.database.get("note", "note-recovery-resolve");
    const failingRepository = new Proxy(fixture.database, {
      get(target, property, receiver) {
        if (property === "save")
          return () => {
            throw new Error("injected DB failure");
          };
        return Reflect.get(target, property, receiver);
      },
    });
    assert.throws(
      () =>
        new WorkspaceService(failingRepository, fixture.userDataPath).saveCanonicalNote(
          saveRequest(current, "receipt本文"),
        ),
      /Tasken内部への保存に失敗/,
    );
    writeFileSync(targetPath, "外部変更後の本文", "utf8");
    const receiptPath = path.join(fixture.userDataPath, "canonical-markdown-recovery.json");
    fixture.database.db.close();
    const conflictedDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
    new WorkspaceService(conflictedDatabase, fixture.userDataPath).loadWorkspace();
    const conflicted = conflictedDatabase.get("note", "note-recovery-resolve");
    assert.equal(canonicalBinding(conflicted).sync_state, "conflict");
    assert.equal(fs.existsSync(receiptPath), true);

    const overwritten = new WorkspaceService(
      conflictedDatabase,
      fixture.userDataPath,
    ).saveCanonicalNote(
      saveRequest(conflicted, "明示overwrite本文", { canonicalMarkdown: "overwrite" }),
    );
    assert.equal(canonicalBinding(overwritten).sync_state, "in_sync");
    assert.equal(readFileSync(targetPath, "utf8"), canonicalContent(overwritten));
    assert.equal(fs.existsSync(receiptPath), false);
    conflictedDatabase.db.close();

    const restartedDatabase = new WorkspaceDatabase(
      path.join(fixture.userDataPath, "workspace.sqlite"),
    );
    new WorkspaceService(restartedDatabase, fixture.userDataPath).loadWorkspace();
    const restarted = restartedDatabase.get("note", "note-recovery-resolve");
    assert.equal(restarted.body_markdown, "明示overwrite本文");
    assert.equal(canonicalBinding(restarted).sync_state, "in_sync");
    assert.equal(fs.existsSync(receiptPath), false);
    restartedDatabase.db.close();
    fixture.database = restartedDatabase;
  } finally {
    try {
      fixture.database.db.close();
    } catch {
      /* already closed */
    }
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
    assert.equal(
      readdirSync(fixture.userDataPath).filter((name) => name.endsWith(".md")).length,
      2,
    );
  } finally {
    closeFixture(fixture);
  }
});
