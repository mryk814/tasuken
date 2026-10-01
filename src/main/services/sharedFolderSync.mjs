import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  countMarkdownImageAttachments,
  syncMarkdownImageAttachments,
  syncCaptureImageAttachments,
} from "./sharedFolderAttachments.mjs";

const MANIFEST_FILE = "tasken-sync.json";
const DEVICE_DIRECTORY = "devices";
const SYNC_INTERVAL_MS = 10_000;

// 同期フォルダはNAS(SMB)上にあることが多く、数千件のreaddirだけで1秒前後かかる。
// 同期FSは10秒ごとにMainのevent loopを止めて画面操作まで固まるため、
// 共有フォルダへの読み書きは必ず fs.promises で行う。
async function exists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.promises.rename(temporaryPath, filePath);
}

function packetFileName(packet) {
  return `${String(packet.deviceSequence).padStart(12, "0")}-${packet.changeId}.json`;
}

async function publishPacket(filePath, packet, pending) {
  if (!(await exists(filePath))) {
    await writeJsonAtomic(filePath, packet);
    return true;
  }
  if (pending) {
    const existing = await readJson(filePath);
    // 参加前のWorkspace IDだけを持つ旧版の自端末ファイルを修復する。
    // 本文・Revision・連番が異なるファイルは上書きしない。
    if (
      existing.workspaceId !== packet.workspaceId &&
      isDeepStrictEqual({ ...existing, workspaceId: packet.workspaceId }, packet)
    ) {
      await writeJsonAtomic(filePath, packet);
      return true;
    }
    if (!isDeepStrictEqual(existing, packet)) {
      throw new Error(
        "送信済みの同期差分がローカル履歴と一致しません。同期フォルダを確認してください。",
      );
    }
  }
  return false;
}

function syncErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function referencedMarkdownImageFiles(repository) {
  const fileNames = new Set();
  const pattern =
    /tasken-attachment:\/\/local\/([0-9a-f-]+\.(?:png|jpg|gif|webp|bmp))(?:\/|[)\s"'<>]|$)/gi;
  for (const type of ["note", "resource"]) {
    for (const entity of repository.list(type)) {
      const markdown = typeof entity.body_markdown === "string" ? entity.body_markdown : "";
      for (const match of markdown.matchAll(pattern)) fileNames.add(match[1]);
    }
  }
  return fileNames;
}

export class SharedFolderSyncService {
  constructor(
    repository,
    notifyWorkspaceChanged = () => {},
    attachmentDirectory = "",
    captureImageDirectory = "",
  ) {
    this.repository = repository;
    this.notifyWorkspaceChanged = notifyWorkspaceChanged;
    this.attachmentDirectory = attachmentDirectory;
    this.captureImageDirectory = captureImageDirectory;
    this.timer = null;
    this.running = null;
    this.state = "off";
    this.attachmentStats = { published: 0, received: 0 };
    this.waitingFor = null;
    this.waitingImage = null;
    this.healStats = { republished: 0 };
    this.lastReportedError = null;
    this.checkedWorkspaceId = null;
    this.relayCheckedKey = null;
    // 照合済み画像のstat署名。再起動で消えてよい派生キャッシュ。
    this.verifiedImages = new Map();
  }

  start() {
    if (this.timer) return;
    if (this.repository.getPreference("sharedSyncEnabled")) {
      void this.syncNow().catch((error) => this.reportSyncError(error));
    }
    this.timer = setInterval(() => {
      if (this.repository.getPreference("sharedSyncEnabled")) {
        void this.syncNow().catch((error) => this.reportSyncError(error));
      }
    }, SYNC_INTERVAL_MS);
  }

  /** 実行中の同期はawait境界で進行中のまま残るため、DBを閉じる側は戻り値を待つ。 */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.running
      ? this.running.then(
          () => {},
          () => {},
        )
      : Promise.resolve();
  }

  /**
   * 定期同期の失敗を1回だけ出す。10秒ごとの再試行でログを溢れさせず、
   * 黙って止まったまま気づけない状態（#588の実機NAS）を作らない。
   */
  reportSyncError(error) {
    const message = syncErrorMessage(error);
    if (message === this.lastReportedError) return;
    this.lastReportedError = message;
    console.error(`[tasken-sync] ${message}`);
  }

  manifestPath(directory) {
    return path.join(directory, MANIFEST_FILE);
  }

  async readManifest(directory) {
    const manifestPath = this.manifestPath(directory);
    if (!(await exists(manifestPath))) return null;
    const manifest = await readJson(manifestPath);
    if (
      manifest?.format !== "tasken-shared-folder-sync" ||
      manifest?.formatVersion !== 1 ||
      typeof manifest?.workspaceId !== "string"
    ) {
      throw new Error(
        "選択したフォルダのTasken同期設定が壊れています。別のフォルダを選んでください。",
      );
    }
    return manifest;
  }

  async configure(directoryValue) {
    const directory = typeof directoryValue === "string" ? path.resolve(directoryValue) : "";
    if (!directory) throw new Error("同期フォルダを選択してください。");
    // 非同期化で定期同期と交互に進みうる。旧設定の同期が終わってから切り替える。
    await this.running?.catch(() => {});
    await fs.promises.mkdir(directory, { recursive: true });
    let manifest = await this.readManifest(directory);
    if (!manifest) {
      manifest = {
        format: "tasken-shared-folder-sync",
        formatVersion: 1,
        workspaceId: this.repository.workspaceId,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(this.manifestPath(directory), manifest);
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
      state: enabled ? (this.state === "off" ? "idle" : this.state) : "off",
      lastSyncedAt: String(this.repository.getPreference("sharedSyncLastAt") || ""),
      lastError: String(this.repository.getPreference("sharedSyncLastError") || ""),
      pendingCount: this.repository.syncPendingCount(),
      conflictCount: this.repository.syncConflictCount(),
      conflicts: this.repository.listSyncConflicts(),
      markdownImageCount: countMarkdownImageAttachments(this.attachmentDirectory),
      lastMarkdownImagesPublished: this.attachmentStats.published,
      lastMarkdownImagesReceived: this.attachmentStats.received,
      waitingFor: this.waitingFor,
      waitingImage: this.waitingImage,
      lastAutoRepublished: this.healStats.republished,
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
      this.waitingFor = null;
      this.waitingImage = null;
      const manifest = await this.readManifest(directory);
      if (!manifest) throw new Error("同期フォルダのTasken設定が見つかりません。");
      if (manifest.workspaceId !== this.repository.workspaceId) {
        throw new Error("選択した同期フォルダは別のWorkspace用です。");
      }
      this.repository.ensureSyncBaseline();
      const attachments = await syncMarkdownImageAttachments({
        sharedDirectory: directory,
        localDirectory: this.attachmentDirectory,
        deviceId: this.repository.deviceId,
        publishFileNames: referencedMarkdownImageFiles(this.repository),
        verified: this.verifiedImages,
      });
      this.attachmentStats = {
        published: attachments.published,
        received: attachments.received,
      };
      await this.publishPending(directory);
      const incoming = await this.receiveChanges(directory);
      // Database changes are already committed, even if a photo arrives later.
      if (incoming.applied || incoming.conflicts || attachments.received)
        this.notifyWorkspaceChanged();
      const photoManifests = new Map();
      for (const type of ["capture_entry", "task"]) {
        for (const entity of this.repository.list(type)) {
          for (const image of Array.isArray(entity.images) ? entity.images : []) {
            const previous = photoManifests.get(image.file_name);
            if (previous && JSON.stringify(previous) !== JSON.stringify(image))
              throw new Error("写真の同期manifestが競合しています。");
            photoManifests.set(image.file_name, image);
          }
        }
      }
      await syncCaptureImageAttachments({
        sharedDirectory: directory,
        localDirectory: this.captureImageDirectory,
        deviceId: this.repository.deviceId,
        photoManifests,
        onReceived: () => this.notifyWorkspaceChanged(),
        verified: this.verifiedImages,
      });
      const timestamp = new Date().toISOString();
      this.repository.setPreference("sharedSyncLastAt", timestamp);
      this.repository.setPreference("sharedSyncLastError", "");
      this.lastReportedError = null;
      this.state = this.repository.syncConflictCount() ? "conflict" : "idle";
      return this.status();
    } catch (error) {
      this.state = "error";
      if (error && error.code === "SYNC_IMAGE_WAITING") {
        this.waitingImage = error.details ?? null;
      }
      this.repository.setPreference("sharedSyncLastError", syncErrorMessage(error));
      throw error;
    }
  }

  async publishPending(directory) {
    if (this.checkedWorkspaceId !== this.repository.workspaceId) {
      this.repository.repairSyncWorkspacePackets();
      this.checkedWorkspaceId = this.repository.workspaceId;
    }
    const deviceDirectory = path.join(directory, DEVICE_DIRECTORY, this.repository.deviceId);
    await fs.promises.mkdir(deviceDirectory, { recursive: true });
    await this.relayOrphanedChanges(directory);
    const present = new Set(
      (await fs.promises.readdir(deviceDirectory)).filter((name) => name.endsWith(".json")),
    );
    let republished = 0;
    for (const header of this.repository.syncPacketHeaders()) {
      const fileName = packetFileName({
        deviceSequence: header.deviceSequence,
        changeId: header.changeId,
      });
      if (!present.has(fileName) || !header.published) {
        const entry = this.repository.syncPacket(header.changeId);
        const filePath = path.join(deviceDirectory, packetFileName(entry.packet));
        const written = await publishPacket(filePath, entry.packet, !header.published);
        present.add(path.basename(filePath));
        if (written) republished += 1;
      }
      if (!header.published) this.repository.markSyncPublished(header.changeId);
    }
    this.healStats = { republished };
  }

  /**
   * 作成端末のディレクトリが消えた記録を中継する。全Entityの走査になるため、
   * 共有フォルダ内の端末ディレクトリの顔ぶれが変わったときだけ確認する。
   */
  async relayOrphanedChanges(directory) {
    const deviceIds = (
      await fs.promises.readdir(path.join(directory, DEVICE_DIRECTORY), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const key = JSON.stringify([this.repository.workspaceId, deviceIds]);
    if (key === this.relayCheckedKey) return 0;
    const relayed = this.repository.enqueueOrphanSyncRelays(new Set(deviceIds));
    this.relayCheckedKey = key;
    return relayed;
  }

  async republishMissing(directoryValue) {
    const directory =
      typeof directoryValue === "string" && directoryValue
        ? path.resolve(directoryValue)
        : String(this.repository.getPreference("sharedSyncDirectory") || "");
    if (!directory) throw new Error("同期フォルダが設定されていません。");
    const manifest = await this.readManifest(directory);
    if (!manifest) throw new Error("同期フォルダのTasken設定が見つかりません。");
    if (manifest.workspaceId !== this.repository.workspaceId) {
      throw new Error("選択した同期フォルダは別のWorkspace用です。");
    }
    this.repository.repairSyncWorkspacePackets();
    const deviceDirectory = path.join(directory, DEVICE_DIRECTORY, this.repository.deviceId);
    await fs.promises.mkdir(deviceDirectory, { recursive: true });
    this.relayCheckedKey = null;
    await this.relayOrphanedChanges(directory);
    let republished = 0;
    for (const entry of this.repository.allSyncPackets()) {
      const filePath = path.join(deviceDirectory, packetFileName(entry.packet));
      if (await publishPacket(filePath, entry.packet, true)) {
        republished += 1;
      }
      this.repository.markSyncPublished(entry.changeId);
    }
    return { republished, status: this.status() };
  }

  async receiveChanges(directory) {
    const devicesRoot = path.join(directory, DEVICE_DIRECTORY);
    if (!(await exists(devicesRoot))) return { applied: 0, conflicts: 0 };
    let applied = 0;
    let conflicts = 0;
    const deviceDirectories = (await fs.promises.readdir(devicesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== this.repository.deviceId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const deviceEntry of deviceDirectories) {
      const deviceId = deviceEntry.name;
      let cursor = this.repository.syncCursor(deviceId);
      const files = (await fs.promises.readdir(path.join(devicesRoot, deviceId)))
        .filter((name) => /^\d{12}-[0-9a-f-]+\.json$/i.test(name))
        .sort();
      for (const fileName of files) {
        const sequence = Number(fileName.slice(0, 12));
        if (!Number.isFinite(sequence) || sequence <= cursor) continue;
        if (sequence !== cursor + 1) {
          this.waitingFor = { deviceId, sequence: cursor + 1 };
          throw new Error(
            `${deviceId} の同期差分 ${String(cursor + 1).padStart(12, "0")} を待っています。共有フォルダの同期完了後に再試行します。解消しない場合は送信側の端末で差分の再公開を実行してください。`,
          );
        }
        let packet = null;
        try {
          packet = await readJson(path.join(devicesRoot, deviceId, fileName));
        } catch {
          this.waitingFor = { deviceId, sequence };
          throw new Error(
            `${deviceId} の同期差分 ${String(sequence).padStart(12, "0")} の到着を待っています。共有フォルダの同期完了後に再試行します。解消しない場合は送信側の端末で差分の再公開を実行してください。`,
          );
        }
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
