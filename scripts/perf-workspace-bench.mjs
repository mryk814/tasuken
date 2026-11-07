// Main側の読み込み・保存・Snapshotの所要時間を、実データの写しで測る。
//
//   npm run bench:workspace -- --db <写しのsqlite> [--runs 5] [--work-dir D:/scratch] [--json out.json]
//
// --db に渡したファイルは開かない。SQLiteのbackup APIで一時フォルダへもう一度写し、
// その写しだけを読み書きする（保存の計測は写しに行を足す）。本人の実プロファイルを直接渡さない。
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import { performance } from "node:perf_hooks";

import {
  WorkspaceDatabase,
  workspaceEntityTypes,
} from "../src/main/repositories/workspaceRepository.mjs";
import { createSnapshot, readSnapshot } from "../src/main/services/snapshotService.mjs";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const sourcePath = argument("--db");
if (!sourcePath) {
  console.error("--db <sqlite> を指定してください（実プロファイルではなく写し）。");
  process.exit(2);
}
const runs = Math.max(1, Number(argument("--runs", "5")) || 5);
const jsonOut = argument("--json");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function time(fn) {
  const started = performance.now();
  const value = fn();
  return { ms: performance.now() - started, value };
}

function repeat(fn, count = runs) {
  const samples = [];
  let value;
  for (let index = 0; index < count; index += 1) {
    const result = time(fn);
    samples.push(result.ms);
    value = result.value;
  }
  return {
    medianMs: Number(median(samples).toFixed(1)),
    maxMs: Number(Math.max(...samples).toFixed(1)),
    value,
  };
}

const workDirectory = fs.mkdtempSync(
  path.join(argument("--work-dir", os.tmpdir()), "tasken-perf-bench-"),
);
const dbPath = path.join(workDirectory, "research-desk.sqlite");
const results = { source: path.basename(sourcePath), runs, measuredAt: new Date().toISOString() };

let repository = null;
try {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  await source.backup(dbPath);
  source.close();

  const opened = time(() => new WorkspaceDatabase(dbPath));
  repository = opened.value;
  results.openMs = Number(opened.ms.toFixed(1));

  const counts = repository.db
    .prepare(
      "SELECT entity_type, COUNT(*) AS n, SUM(LENGTH(data_json)) AS bytes FROM entities GROUP BY entity_type ORDER BY bytes DESC",
    )
    .all();
  results.entities = counts.slice(0, 6).map((row) => ({
    type: row.entity_type,
    rows: row.n,
    mb: Number((row.bytes / 1e6).toFixed(1)),
  }));
  const outbox = repository.db
    .prepare("SELECT COUNT(*) AS n, SUM(LENGTH(payload_json)) AS bytes FROM sync_outbox")
    .get();
  results.syncOutbox = { rows: outbox.n, mb: Number(((outbox.bytes || 0) / 1e6).toFixed(1)) };

  const perType = [];
  for (const type of workspaceEntityTypes) {
    const measured = repeat(() => repository.list(type, false), Math.min(runs, 3));
    if (measured.medianMs >= 1)
      perType.push({ type, medianMs: measured.medianMs, rows: measured.value.length });
  }
  results.listByType = perType.sort((a, b) => b.medianMs - a.medianMs).slice(0, 6);

  const load = repeat(() => repository.loadWorkspace(false));
  results.loadWorkspaceMs = load.medianMs;
  const workspace = load.value;
  const collectionBytes = Object.entries(workspace)
    .map(([key, value]) => [key, Array.isArray(value) ? JSON.stringify(value).length : 0])
    .filter(([, bytes]) => bytes > 0)
    .sort((a, b) => b[1] - a[1]);
  results.workspaceJsonMb = Number(
    (collectionBytes.reduce((sum, [, b]) => sum + b, 0) / 1e6).toFixed(1),
  );
  results.workspaceTopCollections = collectionBytes
    .slice(0, 4)
    .map(([key, bytes]) => ({ key, mb: Number((bytes / 1e6).toFixed(1)) }));

  // IPCはstructured clone（V8 serializer）で運ぶ。main側のserializeとrenderer側のdeserializeの目安。
  const serialized = repeat(() => v8.serialize(workspace), Math.min(runs, 3));
  results.ipcSerializeMs = serialized.medianMs;
  results.ipcPayloadMb = Number((serialized.value.length / 1e6).toFixed(1));
  results.ipcDeserializeMs = repeat(
    () => v8.deserialize(serialized.value),
    Math.min(runs, 3),
  ).medianMs;

  // 共有フォルダ同期は10秒ごとに動く。フォルダI/Oを除いた、DB側の1回分の仕事。
  results.syncTick = {
    ensureSyncBaselineMs: repeat(() => repository.ensureSyncBaseline(), Math.min(runs, 3)).medianMs,
    syncPacketHeadersMs: repeat(() => repository.syncPacketHeaders(), Math.min(runs, 3)).medianMs,
    photoManifestListMs: repeat(
      () => [...repository.list("capture_entry"), ...repository.list("task")],
      Math.min(runs, 3),
    ).medianMs,
  };
  results.syncTick.totalMs = Number(
    (
      results.syncTick.ensureSyncBaselineMs +
      results.syncTick.syncPacketHeadersMs +
      results.syncTick.photoManifestListMs
    ).toFixed(1),
  );

  // Rendererの保存1回（Note本文の編集）。entity本体と活動記録をsaveManyでまとめて書く。
  const note =
    repository.list("note", false)[0] || repository.save("note", { title: "perf", body: "x" });
  const saveSamples = [];
  for (let index = 0; index < runs; index += 1) {
    const sessionId = `perf-session-${index}`;
    const started = performance.now();
    repository.saveMany([
      {
        action: "save",
        type: "note",
        entity: { ...note, body: `${note.body || ""}\nperf ${index}` },
      },
      {
        action: "save",
        type: "change_event",
        // Rendererの buildChangeEventOperation と同じ形。
        entity: buildActivityEvent({
          id: crypto.randomUUID(),
          entityType: "note",
          entityId: note.id,
          occurredAt: new Date().toISOString(),
          changeType: "updated",
          after: note,
          after_json: note,
          source: "manual",
          actor: { kind: "user" },
          origin: { kind: "renderer_save", session_id: sessionId },
          reason: null,
          metadata: { session_id: sessionId, source: "manual" },
        }),
      },
    ]);
    saveSamples.push(performance.now() - started);
  }
  results.saveNoteWithActivityMs = Number(median(saveSamples).toFixed(1));

  const snapshotWorkspace = time(() => repository.loadWorkspace(true));
  const zip = time(() => createSnapshot(snapshotWorkspace.value));
  const zipPath = path.join(workDirectory, "snapshot.zip");
  const written = time(() => zip.value.writeZip(zipPath));
  results.snapshot = {
    loadMs: Number(snapshotWorkspace.ms.toFixed(1)),
    buildMs: Number(zip.ms.toFixed(1)),
    writeMs: Number(written.ms.toFixed(1)),
    zipMb: Number((fs.statSync(zipPath).size / 1e6).toFixed(1)),
  };
  const largestEntry = zip.value
    .getEntries()
    .map((entry) => ({ name: entry.entryName, mb: Number((entry.header.size / 1e6).toFixed(1)) }))
    .sort((a, b) => b.mb - a.mb)[0];
  results.snapshot.largestEntry = largestEntry;
  try {
    const verified = time(() => readSnapshot(zipPath));
    results.snapshot.verifyMs = Number(verified.ms.toFixed(1));
    results.snapshot.verify = "ok";
  } catch (error) {
    results.snapshot.verify = `failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  const sqliteBackupPath = path.join(workDirectory, "backup.sqlite");
  const backupStarted = performance.now();
  await repository.db.backup(sqliteBackupPath);
  results.sqliteBackupMs = Number((performance.now() - backupStarted).toFixed(1));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  repository?.db.close();
  fs.rmSync(workDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 2));
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
