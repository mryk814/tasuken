import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

// 文字起こしの履歴の表示を外す版（#755 束4）の起動で、完了済みの文字起こしを
// 1 件ずつ Markdown に書き出す（束8 の Knowledge の書き出しと同じ形と印）。

async function loadExport() {
  const output = await build({
    entryPoints: ["src/main/services/transcriptionRetirementExport.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
  );
}

const { runTranscriptionRetirementExportOnce, buildTranscriptionExport } = await loadExport();

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tasken-transcription-export-"));
  const userData = path.join(root, "userData");
  const syncRoot = path.join(root, "sync");
  fs.mkdirSync(userData, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  // WorkspaceDatabase と同じ形の手元の記録。印が DB に残ることは transcription-migration-sqlite で見る。
  const records = [];
  const marks = new Map();
  const database = {
    save: (type, entity) => records.push({ type, entity: { ...entity } }),
    find: (type, id) =>
      records.find((entry) => entry.type === type && entry.entity.id === id)?.entity,
    list: (type, includeDeleted = false) =>
      records
        .filter((entry) => entry.type === type)
        .map((entry) => entry.entity)
        .filter((entity) => includeDeleted || !entity.deleted_at),
    readRetiredExportMark: (name) => marks.get(name) ?? null,
    markRetiredExportDone: (name, value) => marks.set(name, value),
  };
  return {
    userData,
    syncRoot,
    database,
    userDataExports: path.join(userData, "Exports", "retired", "transcriptions"),
    syncExports: path.join(syncRoot, "Exports", "retired", "transcriptions"),
  };
}

function revision(id, status, rawText, completedAt = "2026-08-09T10:05:00.000Z") {
  return {
    id,
    operation_id: id,
    source_artifact_id: "artifact-1",
    source_content_hash: `sha256:${"a".repeat(64)}`,
    provider_profile_id: "legacy-provider",
    model_profile_id: "legacy-model-profile",
    model_id: "legacy-model",
    language: "ja",
    processing_mode: "cloud",
    status,
    raw_text: rawText,
    started_at: "2026-08-09T10:00:00.000Z",
    completed_at: status === "completed" || status === "failed" ? completedAt : null,
    error_code: status === "failed" ? "provider_failure" : null,
  };
}

/** 前の版と同じく、同じ文字起こしを付箋と添付の両方に持たせる。 */
function seedVoice(database, { captureId, artifactId, title, revisions, deleted = false }) {
  database.save("capture_entry", {
    id: captureId,
    title,
    text: `${title}.webm`,
    kind: "voice_memo",
    content_type: "audio",
    transcription_revisions: revisions,
    created_at: "2026-08-09T09:00:00.000Z",
    updated_at: "2026-08-09T10:05:00.000Z",
    ...(deleted ? { deleted_at: "2026-10-01T00:00:00.000Z" } : {}),
  });
  database.save("artifact", {
    id: artifactId,
    title,
    filename: `${title}.webm`,
    source_type: "capture_entry",
    source_id: captureId,
    media_kind: "audio",
    transcription_revisions: revisions,
    created_at: "2026-08-09T09:00:00.000Z",
    updated_at: "2026-08-09T10:05:00.000Z",
  });
}

function seed(database) {
  seedVoice(database, {
    captureId: "capture-1",
    artifactId: "artifact-1",
    title: "週次の打ち合わせ",
    revisions: [
      revision("rev-failed", "failed", ""),
      revision("rev-1", "completed", "一行目\r\n二行目の本文"),
      revision("rev-2", "completed", "やり直した文字起こし", "2026-08-10T08:00:00.000Z"),
    ],
  });
  seedVoice(database, {
    captureId: "capture-gone",
    artifactId: "artifact-gone",
    title: "消した録音",
    revisions: [revision("rev-gone", "completed", "出てはいけない本文")],
    deleted: true,
  });
}

function run(context, overrides = {}) {
  const logs = [];
  const result = runTranscriptionRetirementExportOnce({
    repository: context.database,
    userDataDirectory: context.userData,
    syncRoot: context.syncRoot,
    log: (level, message) => logs.push({ level, message }),
    now: () => "2026-11-16T00:00:00.000Z",
    ...overrides,
  });
  return { result, logs };
}

const names = (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []);

test("完了済みの文字起こしを 1 件ずつ、userData と同期ルートの両方へ書く", async (t) => {
  const context = await setup(t);
  seed(context.database);

  const { result, logs } = run(context);

  assert.equal(result.state, "done");
  assert.equal(result.documents, 2);
  // 付箋と添付の両方にある同じ文字起こしは 1 件。失敗した物と、削除した付箋の物は出ない。
  const expected = [
    "文字起こし - 週次の打ち合わせ - 2026-08-09.md",
    "文字起こし - 週次の打ち合わせ - 2026-08-10.md",
  ];
  assert.deepEqual(names(context.userDataExports), expected);
  assert.deepEqual(names(context.syncExports), expected);
  const first = fs.readFileSync(path.join(context.userDataExports, expected[0]), "utf8");
  assert.match(first, /^# 文字起こし - 週次の打ち合わせ\n/u);
  assert.match(first, /- 付箋: 「週次の打ち合わせ」（capture-1）/u);
  assert.match(first, /- 添付: artifact-1/u);
  assert.match(first, /- モデル: legacy-model \/ legacy-model-profile \/ legacy-provider/u);
  assert.match(first, /- Tasken の ID: rev-1/u);
  assert.match(first, /## 本文\n\n一行目\n二行目の本文\n$/u);
  // 書き出した時刻は中身に入れない。
  assert.doesNotMatch(first, /2026-11-16/u);
  const all = [context.userDataExports, context.syncExports]
    .flatMap((directory) => names(directory).map((name) => path.join(directory, name)))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(all, /出てはいけない本文|消した録音/u);
  // ログは数だけ。題名も本文も出さない。
  assert.doesNotMatch(JSON.stringify(logs), /週次|一行目/u);
  const mark = JSON.parse(context.database.readRetiredExportMark("transcriptions"));
  assert.deepEqual(mark, {
    at: "2026-11-16T00:00:00.000Z",
    count: 2,
    latest: "2026-10-01T00:00:00.000Z",
  });
});

test("0 件なら何も書かず、済んだ印も付けない", async (t) => {
  const context = await setup(t);
  seedVoice(context.database, {
    captureId: "capture-1",
    artifactId: "artifact-1",
    title: "文字起こししていない音声",
    revisions: [revision("rev-failed", "failed", "")],
  });

  assert.deepEqual(run(context).result, { state: "nothing" });
  assert.equal(fs.existsSync(context.userDataExports), false);
  assert.equal(context.database.readRetiredExportMark("transcriptions"), null);
});

test("二度目の起動では書き出さない（本人がファイルを消していても作り直さない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  assert.equal(run(context).result.state, "done");
  fs.rmSync(context.userDataExports, { recursive: true });

  const { result, logs } = run(context);

  assert.deepEqual(result, { state: "already_done" });
  assert.equal(fs.existsSync(context.userDataExports), false);
  assert.deepEqual(logs, []);
});

test("書き出しに失敗しても例外にせず、次の起動でやり直す（書けた置き場は増えない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  fs.mkdirSync(context.syncRoot, { recursive: true });
  fs.writeFileSync(path.join(context.syncRoot, "Exports"), "not a directory");

  const first = run(context);

  assert.equal(first.result.state, "retry");
  assert.equal(names(context.userDataExports).length, 2);
  assert.equal(context.database.readRetiredExportMark("transcriptions"), null);
  assert.equal(
    first.logs.some((entry) => entry.level === "warn"),
    true,
  );

  fs.rmSync(path.join(context.syncRoot, "Exports"));
  const second = run(context);

  assert.equal(second.result.state, "done");
  assert.equal(names(context.syncExports).length, 2);
  assert.equal(names(context.userDataExports).length, 2);
});

test("同期ルートが無ければ userData だけに書く。既にある別の中身は上書きせず番号を付ける", async (t) => {
  const context = await setup(t);
  seed(context.database);
  fs.mkdirSync(context.userDataExports, { recursive: true });
  const taken = path.join(context.userDataExports, "文字起こし - 週次の打ち合わせ - 2026-08-09.md");
  fs.writeFileSync(taken, "本人が書き換えた控え");

  const { result } = run(context, { syncRoot: "" });

  assert.equal(result.state, "done");
  assert.deepEqual(result.directories, [context.userDataExports]);
  assert.equal(fs.readFileSync(taken, "utf8"), "本人が書き換えた控え");
  assert.deepEqual(names(context.userDataExports), [
    "文字起こし - 週次の打ち合わせ - 2026-08-09 (2).md",
    "文字起こし - 週次の打ち合わせ - 2026-08-09.md",
    "文字起こし - 週次の打ち合わせ - 2026-08-10.md",
  ]);
  assert.equal(fs.existsSync(context.syncRoot), false);
});

test("印の後に文字起こしが同期で届いたら、次の起動で書き出し直す（既にある分は増えない）", async (t) => {
  const context = await setup(t);
  seed(context.database);
  assert.equal(run(context).result.state, "done");

  seedVoice(context.database, {
    captureId: "capture-2",
    artifactId: "artifact-2",
    title: "別の端末の録音",
    revisions: [revision("rev-3", "completed", "あとから届いた本文")],
  });
  const added = context.database.find("capture_entry", "capture-2");
  added.updated_at = "2026-11-20T00:00:00.000Z";

  const { result } = run(context);

  assert.equal(result.state, "done");
  assert.equal(result.documents, 3);
  assert.equal(names(context.userDataExports).length, 3);
  assert.equal(JSON.parse(context.database.readRetiredExportMark("transcriptions")).count, 3);
});

test("同じ題名と日付の文字起こしも、1 件ずつ別のファイルにする", () => {
  const records = [];
  const database = {
    list: (type) => records.filter((entry) => entry.type === type).map((entry) => entry.entity),
  };
  for (const [index, id] of ["rev-a", "rev-b"].entries()) {
    records.push({
      type: "capture_entry",
      entity: {
        id: `capture-${index}`,
        title: "同じ題名",
        transcription_revisions: [revision(id, "completed", `本文 ${id}`)],
      },
    });
  }
  assert.deepEqual(
    buildTranscriptionExport(database).map((document) => document.baseName),
    ["文字起こし - 同じ題名 - 2026-08-09", "文字起こし - 同じ題名 - 2026-08-09 [2]"],
  );
});
