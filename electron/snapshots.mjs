import AdmZip from "adm-zip";
import crypto from "node:crypto";

import { workspaceEntityTypes, workspaceSchemaVersion } from "./database.mjs";

const checksum = (text) => crypto.createHash("sha256").update(text).digest("hex");

function summaryMarkdown(workspace) {
  const themes = workspace.themes || [];
  const items = (workspace.items || []).filter((item) => !item.deleted_at);
  const notes = (workspace.notes || []).filter((note) => !note.deleted_at);
  return [
    "# Research Desk Workspace",
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
        ...(milestones.length ? milestones.map((item) => `- ${item.due_date || item.planned_end || "日程未確定"} ${item.title}`) : ["- なし"]),
        "",
        "### Open Items",
        ...(related.length ? related.map((item) => `- [ ] ${item.due_date || "日程未確定"} ${item.title}`) : ["- なし"]),
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
    snapshotVersion: 1,
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
  const zip = new AdmZip(filePath);
  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) throw new Error("manifest.jsonがないため、Research DeskのSnapshotとして読み込めません。");
  const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
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
    const text = entry.getData().toString("utf8");
    if (manifest.files?.[name] && checksum(text) !== manifest.files[name]) {
      throw new Error(`${name}のチェックサムが一致しません。Snapshotが破損している可能性があります。`);
    }
    workspace[`${type}s`] = JSON.parse(text);
  }
  return { manifest, workspace };
}
