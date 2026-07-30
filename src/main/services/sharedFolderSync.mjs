import fs from "node:fs";
import path from "node:path";

const MANIFEST_FILE = "tasken-sync.json";
const DEVICE_DIRECTORY = "devices";
const SYNC_INTERVAL_MS = 10_000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function packetFileName(packet) {
  return `${String(packet.deviceSequence).padStart(12, "0")}-${packet.changeId}.json`;
}

function syncErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class SharedFolderSyncService {
  constructor(repository, notifyWorkspaceChanged = () => {}) {
    this.repository = repository;
    this.notifyWorkspaceChanged = notifyWorkspaceChanged;
    this.timer = null;
    this.running = null;
    this.state = "off";
  }

  start() {
    if (this.timer) return;
    if (this.repository.getPreference("sharedSyncEnabled")) {
      void this.syncNow().catch(() => {});
    }
    this.timer = setInterval(() => {
      if (this.repository.getPreference("sharedSyncEnabled")) {
        void this.syncNow().catch(() => {});
      }
    }, SYNC_INTERVAL_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  manifestPath(directory) {
    return path.join(directory, MANIFEST_FILE);
  }

  readManifest(directory) {
    const manifestPath = this.manifestPath(directory);
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJson(manifestPath);
    if (
      manifest?.format !== "tasken-shared-folder-sync"
      || manifest?.formatVersion !== 1
      || typeof manifest?.workspaceId !== "string"
    ) {
      throw new Error("選択したフォルダのTasken同期設定が壊れています。別のフォルダを選んでください。");
    }
    return manifest;
  }

  configure(directoryValue) {
    const directory = typeof directoryValue === "string" ? path.resolve(directoryValue) : "";
    if (!directory) throw new Error("同期フォルダを選択してください。");
    fs.mkdirSync(directory, { recursive: true });
    let manifest = this.readManifest(directory);
    if (!manifest) {
      manifest = {
        format: "tasken-shared-folder-sync",
        formatVersion: 1,
        workspaceId: this.repository.workspaceId,
        createdAt: new Date().toISOString(),
      };
      writeJsonAtomic(this.manifestPath(directory), manifest);
    } else if (manifest.workspaceId !== this.repository.workspaceId) {
      this.repository.adoptSyncWorkspace(manifest.workspaceId);
    }
    this.repository.setPreference("sharedSyncDirectory", directory);
    this.repository.setPreference("sharedSyncEnabled", true);
    this.repository.setPreference("sharedSyncLastError", "");
    this.repository.ensureSyncBaseline();
    return this.syncNow();
  }

  disable() {
    this.repository.setPreference("sharedSyncEnabled", false);
    this.state = "off";
    return this.status();
  }

  status() {
    const enabled = Boolean(this.repository.getPreference("sharedSyncEnabled"));
    return {
      enabled,
      directory: String(this.repository.getPreference("sharedSyncDirectory") || ""),
      workspaceId: this.repository.workspaceId,
      deviceId: this.repository.deviceId,
      state: enabled ? this.state === "off" ? "idle" : this.state : "off",
      lastSyncedAt: String(this.repository.getPreference("sharedSyncLastAt") || ""),
      lastError: String(this.repository.getPreference("sharedSyncLastError") || ""),
      pendingCount: this.repository.syncPendingCount(),
      conflictCount: this.repository.syncConflictCount(),
      conflicts: this.repository.listSyncConflicts(),
    };
  }

  async syncNow() {
    if (this.running) return this.running;
    this.running = this.runSync().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async runSync() {
    if (!this.repository.getPreference("sharedSyncEnabled")) return this.status();
    const directory = String(this.repository.getPreference("sharedSyncDirectory") || "");
    if (!directory) throw new Error("同期フォルダが設定されていません。");
    this.state = "syncing";
    try {
      const manifest = this.readManifest(directory);
      if (!manifest) throw new Error("同期フォルダのTasken設定が見つかりません。");
      if (manifest.workspaceId !== this.repository.workspaceId) {
        throw new Error("選択した同期フォルダは別のWorkspace用です。");
      }
      this.repository.ensureSyncBaseline();
      this.publishPending(directory);
      const incoming = this.receiveChanges(directory);
      const timestamp = new Date().toISOString();
      this.repository.setPreference("sharedSyncLastAt", timestamp);
      this.repository.setPreference("sharedSyncLastError", "");
      this.state = this.repository.syncConflictCount() ? "conflict" : "idle";
      if (incoming.applied || incoming.conflicts) this.notifyWorkspaceChanged();
      return this.status();
    } catch (error) {
      this.state = "error";
      this.repository.setPreference("sharedSyncLastError", syncErrorMessage(error));
      throw error;
    }
  }

  publishPending(directory) {
    const deviceDirectory = path.join(directory, DEVICE_DIRECTORY, this.repository.deviceId);
    fs.mkdirSync(deviceDirectory, { recursive: true });
    for (const pending of this.repository.pendingSyncChanges()) {
      const filePath = path.join(deviceDirectory, packetFileName(pending.packet));
      if (!fs.existsSync(filePath)) writeJsonAtomic(filePath, pending.packet);
      this.repository.markSyncPublished(pending.changeId);
    }
  }

  receiveChanges(directory) {
    const devicesRoot = path.join(directory, DEVICE_DIRECTORY);
    if (!fs.existsSync(devicesRoot)) return { applied: 0, conflicts: 0 };
    let applied = 0;
    let conflicts = 0;
    const deviceDirectories = fs.readdirSync(devicesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== this.repository.deviceId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const deviceEntry of deviceDirectories) {
      const deviceId = deviceEntry.name;
      let cursor = this.repository.syncCursor(deviceId);
      const files = fs.readdirSync(path.join(devicesRoot, deviceId))
        .filter((name) => /^\d{12}-[0-9a-f-]+\.json$/i.test(name))
        .sort();
      for (const fileName of files) {
        const sequence = Number(fileName.slice(0, 12));
        if (!Number.isFinite(sequence) || sequence <= cursor) continue;
        if (sequence !== cursor + 1) {
          throw new Error(
            `${deviceId} の同期差分 ${String(cursor + 1).padStart(12, "0")} を待っています。共有フォルダの同期完了後に再試行します。`,
          );
        }
        const packet = readJson(path.join(devicesRoot, deviceId, fileName));
        if (packet.deviceId !== deviceId || Number(packet.deviceSequence) !== sequence) {
          throw new Error(`同期差分 ${fileName} の端末情報が一致しません。`);
        }
        const result = this.repository.applySyncPacket(packet);
        this.repository.setSyncCursor(deviceId, sequence);
        cursor = sequence;
        if (result.status === "applied") applied += 1;
        if (result.status === "conflict") conflicts += 1;
      }
    }
    return { applied, conflicts };
  }

  resolveConflict(conflictId, choice) {
    const result = this.repository.resolveSyncConflict(conflictId, choice);
    this.state = this.repository.syncConflictCount() ? "conflict" : "idle";
    this.notifyWorkspaceChanged();
    void this.syncNow().catch(() => {});
    return { result, status: this.status() };
  }
}

export const sharedFolderSyncManifestFile = MANIFEST_FILE;
