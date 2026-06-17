import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs";

import { workspaceEntityTypes, workspaceSchemaVersion } from "../repositories/workspaceRepository.mjs";

const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;

function readEntryText(entry, name) {
  if (entry.header.size > MAX_ENTRY_BYTES) {
    throw new Error(`${name}が大きすぎます。Snapshotを分割するか、不要なデータを削除してください。`);
  }
  return entry.getData().toString("utf8");
}

function summaryMarkdown(workspace) {
  const themes = workspace.themes || [];
  const items = (workspace.items || []).filter((item) => !item.deleted_at);
  const notes = (workspace.notes || []).filter((note) => !note.deleted_at);
  return [
    "# Tasken Workspace",
    "",
    `Exported: ${new Date().toISOString()}`,
    "",
    ...themes.flatMap((theme) => {
      const related = items.filter((item) => item.theme_id === theme.id && item.status !== "done");
      const milestones = related.filter((item) => item.kind === "milestone");
      const waiting = related.filter((item) => item.kind === "waiting" || item.status === "waiting");
      const recentNotes = notes.filter((note) => note.theme_id === theme.id).slice(0, 5);
      return [
        `## ${theme.name}`,
        theme.description || "",
        "",
        "### Milestones",
        ...(milestones.length ? milestones.map((item) => `- ${item.planned_end || "予定なし"} ${item.title}`) : ["- なし"]),
        "",
        "### Open Items",
        ...(related.length ? related.map((item) => `- [ ] ${item.planned_end || "予定なし"} ${item.title}`) : ["- なし"]),
        "",
        "### Waiting",
        ...(waiting.length ? waiting.map((item) => `- ${item.title}`) : ["- なし"]),
        "",
        "### Recent Notes",
        ...(recentNotes.length ? recentNotes.map((note) => `- ${note.title}`) : ["- なし"]),
        "",
      ];
    }),
  ].join("\n");
}

export function createSnapshot(workspace) {
  const zip = new AdmZip();
  const files = {};
  for (const type of workspaceEntityTypes) {
    const name = `${type}s.json`;
    const content = JSON.stringify(workspace[`${type}s`] || [], null, 2);
    zip.addFile(name, Buffer.from(content, "utf8"));
    files[name] = checksum(content);
  }
  const revisions = JSON.stringify(workspace.plan_revisions || [], null, 2);
  zip.addFile("plan_revisions.json", Buffer.from(revisions, "utf8"));
  files["plan_revisions.json"] = checksum(revisions);

  const summary = summaryMarkdown(workspace);
  zip.addFile("summary.md", Buffer.from(summary, "utf8"));
  files["summary.md"] = checksum(summary);

  const manifest = {
    format: "research-desk-workspace",
    snapshotVersion: 2,
    schemaVersion: workspaceSchemaVersion,
    workspaceId: workspace.meta?.workspaceId,
    deviceId: workspace.meta?.deviceId,
    exportedAt: new Date().toISOString(),
    files,
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
  return zip;
}

export function readSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_SNAPSHOT_BYTES) {
    throw new Error("Snapshotファイルが大きすぎます。50MB以下のファイルを選択してください。");
  }
  const zip = new AdmZip(filePath);
  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) throw new Error("manifest.jsonがないため、TaskenのSnapshotとして読み込めません。");
  const manifest = JSON.parse(readEntryText(manifestEntry, "manifest.json"));
  if (manifest.format !== "research-desk-workspace") throw new Error("対応していないSnapshot形式です。");
  if (manifest.schemaVersion > workspaceSchemaVersion) {
    throw new Error("このSnapshotは新しいバージョンで作成されています。アプリを更新してください。");
  }

  const workspace = { meta: { workspaceId: manifest.workspaceId, deviceId: manifest.deviceId } };
  for (const type of workspaceEntityTypes) {
    const name = `${type}s.json`;
    const entry = zip.getEntry(name);
    if (!entry) {
      workspace[`${type}s`] = [];
      continue;
    }
    const text = readEntryText(entry, name);
    if (manifest.files?.[name] && checksum(text) !== manifest.files[name]) {
      throw new Error(`${name}のチェックサムが一致しません。Snapshotが破損している可能性があります。`);
    }
    workspace[`${type}s`] = JSON.parse(text);
  }
  const revisionsEntry = zip.getEntry("plan_revisions.json");
  if (revisionsEntry) {
    const text = readEntryText(revisionsEntry, "plan_revisions.json");
    if (manifest.files?.["plan_revisions.json"] && checksum(text) !== manifest.files["plan_revisions.json"]) {
      throw new Error("plan_revisions.jsonのチェックサムが一致しません。Snapshotが破損している可能性があります。");
    }
    workspace.plan_revisions = JSON.parse(text);
  } else {
    workspace.plan_revisions = [];
  }
  return { manifest, workspace };
}
