import { clipboard, dialog, type WebContents } from "electron";

import type { Workspace } from "../../shared/types/workspace";
import { createSnapshot, readSnapshot } from "./snapshotService.mjs";

type SnapshotDecisions = Record<string, string>;

interface WorkspaceRepository {
  loadWorkspace(includeDeleted?: boolean): unknown;
  previewSnapshot(workspace: unknown): unknown[];
  applySnapshot(workspace: unknown, decisions: SnapshotDecisions, revisions: unknown[]): unknown;
}

export class WorkspaceService {
  private readonly pendingSnapshots = new Map<string, Workspace>();

  constructor(private readonly repository: WorkspaceRepository) {}

  writeClipboard(text: unknown): boolean {
    clipboard.writeText(String(text));
    return true;
  }

  reload(sender: WebContents): boolean {
    sender.reload();
    return true;
  }

  async exportSnapshot(): Promise<{ canceled: boolean; filePath?: string }> {
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: "Workspace Snapshotを書き出す",
      defaultPath: `workspace_export_${date}.zip`,
      filters: [{ name: "Research Desk Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    createSnapshot(this.repository.loadWorkspace(true)).writeZip(result.filePath);
    return { canceled: false, filePath: result.filePath };
  }

  async inspectSnapshot() {
    const result = await dialog.showOpenDialog({
      title: "Workspace Snapshotを読み込む",
      properties: ["openFile"],
      filters: [{ name: "Research Desk Snapshot", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const parsed = readSnapshot(result.filePaths[0]) as {
      manifest: Record<string, unknown>;
      workspace: Workspace;
    };
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.pendingSnapshots.set(token, parsed.workspace);
    return {
      canceled: false,
      token,
      manifest: parsed.manifest,
      changes: this.repository.previewSnapshot(parsed.workspace),
    };
  }

  applySnapshot(token: string, decisions: SnapshotDecisions): Workspace {
    const snapshot = this.pendingSnapshots.get(token);
    if (!snapshot) {
      throw new Error("Importプレビューの有効期限が切れました。もう一度Snapshotを選択してください。");
    }
    const result = this.repository.applySnapshot(snapshot, decisions, snapshot.plan_revisions || []);
    this.pendingSnapshots.delete(token);
    return result as Workspace;
  }
}
