import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { currentSyncShape } from "../../shared/contracts/sync/aiItemPacketContract.mjs";
import {
  countMarkdownImageAttachments,
  syncMarkdownImageAttachments,
  syncCaptureImageAttachments,
} from "./sharedFolderAttachments.mjs";

const MANIFEST_FILE = "tasken-sync.json";
const DEVICE_DIRECTORY = "devices";
/** 共有フォルダの差分のファイル名（<12桁の連番>-<change id>.json）。replica-checkも同じものを使う。 */
export const SYNC_PACKET_FILE_PATTERN = /^\d{12}-[0-9a-f-]+\.json$/i;
const SYNC_PACKET_WAITING = "SYNC_PACKET_WAITING";
const SYNC_SEQUENCE_ROLLBACK = "SYNC_SEQUENCE_ROLLBACK";
// syncPacketContract（repositories）と同じ値。application層からinfrastructureを読まないよう文字列で比べる。
const SYNC_PACKET_REJECTED = "SYNC_PACKET_REJECTED";
const SYNC_INTERVAL_MS = 10_000;
/**
 * 各端末が自分のディレクトリへ置く公開の進み具合。差分ではないので連番のファイル名にしない。
 * 古い版は SYNC_PACKET_FILE_PATTERN に当たらないこのファイルを読み飛ばす。
 */
export const DEVICE_STATUS_FILE = "status.json";
// OneDrive経由の共有フォルダもあるため、進みが無いのに頻繁には書き直さない。
const DEVICE_STATUS_REWRITE_MS = 10 * 60_000;
const DEVICE_STATUS_RETRY_MS = 60_000;
// これより長く status.json が更新されていない端末は「Desktop」として数えない（使われなくなった端末）。
const DEVICE_ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60_000;

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

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

/** 同期の失敗を、AIへ返す状態名に分ける。文言ではなく code で判定する。 */
function failureState(error) {
  switch (error?.code) {
    case SYNC_PACKET_REJECTED:
      return "blocked";
    case SYNC_SEQUENCE_ROLLBACK:
      return "blocked";
    case SYNC_PACKET_WAITING:
      return "waiting_packet";
    case "SYNC_IMAGE_WAITING":
      return "waiting_image";
    default:
      return "io_error";
  }
}

function isDeviceStatus(value, deviceId) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    value.format === "tasken-device-status" &&
    value.formatVersion === 1 &&
    value.deviceId === deviceId &&
    (value.role === "desktop" || value.role === "replica") &&
    Number.isInteger(value.publishedThrough) &&
    value.publishedThrough >= 0 &&
    typeof value.at === "string" &&
    Number.isFinite(Date.parse(value.at)) &&
    // Desktop は取り込める差分の形を必ず出す。replica が書き込みを断るかの判定に使う。
    (value.role !== "desktop" ||
      (typeof value.syncShape === "string" && /^[0-9a-f]{64}$/.test(value.syncShape)))
  );
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
    options = {},
  ) {
    // 試験で時刻を差し替える。
    this.clock = options.now || (() => Date.now());
    // 他端末のstatus.jsonを読んで鮮度を出すのはNAS replicaだけ。Desktopは自分の分を書くだけで、
    // 10秒ごとの共有フォルダ(SMB)の読み込みを増やさない。
    this.role = options.role === "replica" ? "replica" : "desktop";
    this.repository = repository;
    this.notifyWorkspaceChanged = notifyWorkspaceChanged;
    this.attachmentDirectory = attachmentDirectory;
    this.captureImageDirectory = captureImageDirectory;
    this.timer = null;
    this.running = null;
    this.queued = null;
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
    // 以下は共有フォルダの読み書きを減らすための派生値。再起動で消えてよい。
    this.hasSynced = false;
    this.lastFailure = null;
    this.publishedStatus = null;
    // 公開済みの連番より古いDBを見つけて止めている間はtrue（assertOwnSequenceNotRolledBack）。
    this.sequenceRolledBack = false;
    this.lastStatusError = null;
    this.statusRetryAt = 0;
    // 端末ごとの「最後に読めた正しいstatus.json」。その回に読めなくても前の値で遅れを判定する。
    this.knownStatuses = new Map();
    this.deviceAsOf = new Map();
    this.freshness = { asOf: null, desktopSeenAt: null };
    this.countedDesktops = [];
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
    if (this.running) {
      // 走っている回は、呼ばれる前に保存された変更をもう公開し終えているかもしれない。
      // その回を待つだけだと、呼び出し側が「同期した」と思った変更が共有フォルダに出ないので、
      // 終わった後にもう一回だけ回す（重ねて呼ばれても、待ちの回は一つにまとめる）。
      this.queued ??= this.running
        .catch(() => {})
        .then(() => {
          this.queued = null;
          return this.syncNow();
        });
      return this.queued;
    }
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
      // status.jsonの`at`。ensureSyncBaseline（まだ送信キューに無い記録をこの回で入れる）や
      // 画像の同期より前に取る。後ろで取ると、その間に確定した変更の時刻が`at`より前なのに
      // 連番は publishedThrough より後になり、「at より前の変更は全部入っている」が偽になる。
      const passStartedAt = this.clock();
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
      const publishedThrough = await this.publishPending(directory);
      await this.publishDeviceStatus(directory, publishedThrough, passStartedAt);
      // 取り込みが途中で失敗しても鮮度は出せるよう、取り込みとは別に読んでおく。
      const deviceScan = this.role === "replica" ? await this.scanDevices(directory) : null;
      const incoming = await this.receiveChanges(directory).finally(() =>
        this.updateFreshness(deviceScan),
      );
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
      this.hasSynced = true;
      this.lastFailure = null;
      this.state = this.repository.syncConflictCount() ? "conflict" : "idle";
      return this.status();
    } catch (error) {
      this.state = "error";
      this.lastFailure = failureState(error);
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
    let publishedThrough = 0;
    const headers = this.repository.syncPacketHeaders();
    this.assertOwnSequenceNotRolledBack(present, headers);
    for (const header of headers) {
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
      publishedThrough = Math.max(publishedThrough, header.deviceSequence);
    }
    this.healStats = { republished };
    return publishedThrough;
  }

  /**
   * 自端末のDBが古い写しに戻されていないかを、公開の前に確かめる。
   * 共有フォルダに、自端末のDBが知らない差分（連番が先、または同じ連番で別のchange ID）が
   * 既にあるなら、DBは公開した後の状態より古い。そのまま続けると、同じ連番を別の内容で使い直し、
   * 受信した端末は「その連番は取り込み済み」として新しい変更を黙って読み飛ばす。
   * 公開も取り込みも止め、本人が新しい写しから戻すまで進めない（blocked）。
   */
  assertOwnSequenceNotRolledBack(presentFileNames, headers) {
    this.sequenceRolledBack = false;
    const localSequence = this.repository.syncDeviceSequence();
    const known = new Map(headers.map((header) => [header.changeId, header.deviceSequence]));
    for (const name of presentFileNames) {
      if (!SYNC_PACKET_FILE_PATTERN.test(name)) continue;
      const sequence = Number(name.slice(0, 12));
      const changeId = name.slice(13, -".json".length);
      if (sequence > localSequence || known.get(changeId) !== sequence) {
        this.sequenceRolledBack = true;
        throw codedError(
          "この端末のDBが、共有フォルダに公開済みの状態より古くなっています（古いバックアップへ戻した可能性）。" +
            "続けると連番が重なり、他の端末へ変更が届かなくなるため、公開を止めました。" +
            (this.role === "replica"
              ? "止めて、DBを脇へ退け（消さない）、空のnodeとして共有フォルダへ参加し直してください（docs/synology-headless-node.md）。"
              : "同期を再開するには、空の端末として同期フォルダへ参加し直してください（READMEの「同期している端末で控えから戻した時」）。"),
          SYNC_SEQUENCE_ROLLBACK,
        );
      }
    }
  }

  /**
   * 自端末の公開の進み（devices/<id>/status.json）。他端末はこれと自分のカーソルを比べて、
   * 「この端末の変更がどの時刻まで入っているか」を知る。進んだときと、前回から一定時間たったときだけ書く。
   */
  async publishDeviceStatus(directory, publishedThrough, at) {
    const now = this.clock();
    const previous = this.publishedStatus;
    // 書けない状態が続くとき（OneDrive等が掴んでいる）に、10秒ごとに叩かない。
    if (now < this.statusRetryAt) return;
    if (
      previous &&
      previous.publishedThrough === publishedThrough &&
      now - previous.writtenAt < DEVICE_STATUS_REWRITE_MS
    )
      return;
    const filePath = path.join(
      directory,
      DEVICE_DIRECTORY,
      this.repository.deviceId,
      DEVICE_STATUS_FILE,
    );
    const temporaryPath = `${filePath}.${process.pid}.${now}.tmp`;
    const value = {
      format: "tasken-device-status",
      formatVersion: 1,
      deviceId: this.repository.deviceId,
      role: this.role,
      publishedThrough,
      at: new Date(at).toISOString(),
      // この版の Desktop が取り込める AI 作成の差分の形。replica はこれより後に
      // desktop_first の印があると書き込みを断る。replica 自身は取り込む側ではないので付けない。
      ...(this.role === "desktop" ? { syncShape: currentSyncShape } : {}),
    };
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await fs.promises.rename(temporaryPath, filePath);
      this.publishedStatus = { publishedThrough, writtenAt: now };
      this.statusRetryAt = 0;
    } catch (error) {
      this.statusRetryAt = now + DEVICE_STATUS_RETRY_MS;
      // 差分と違い、このファイルは同じ名前へ何度も置き直す。Windowsでは OneDrive やウイルス対策が
      // 掴んでいると上書きの rename が EPERM/EBUSY で失敗する。鮮度は補助の情報なので、
      // ここで差分の同期まで止めない。publishedStatus を進めず、次の同期でもう一度書く。
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      // 同期が成功するとreportSyncErrorの重複抑止が戻るため、こちらは別に一度だけ出す。
      // 文言は一時ファイル名（時刻入り）を含んで毎回変わるので、codeで同じ失敗かを見る。
      const key = error?.code || syncErrorMessage(error);
      if (key !== this.lastStatusError)
        console.error(`[tasken-sync] status.json を書けませんでした: ${syncErrorMessage(error)}`);
      this.lastStatusError = key;
      return;
    }
    this.lastStatusError = null;
  }

  /**
   * 他端末のディレクトリを見て、status.jsonを読み直す。読めた正しいものは端末ごとに覚える。
   * 一度も読めていない端末（旧版・壊れた・書き込みが失敗し続ける）だけ、差分の連番を調べる。
   * 共有フォルダのdevices自体が読めなければ null（前の鮮度を保つ）。
   */
  async scanDevices(directory) {
    try {
      const devicesRoot = path.join(directory, DEVICE_DIRECTORY);
      if (!(await exists(devicesRoot))) return { ids: [], packetMax: new Map() };
      const ids = [];
      const packetMax = new Map();
      for (const entry of await fs.promises.readdir(devicesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === this.repository.deviceId) continue;
        ids.push(entry.name);
        try {
          const value = await readJson(path.join(devicesRoot, entry.name, DEVICE_STATUS_FILE));
          if (isDeviceStatus(value, entry.name)) this.knownStatuses.set(entry.name, value);
        } catch {
          // 古い版の端末にはない。壊れていても差分の取り込みには影響させない。
        }
        if (this.knownStatuses.has(entry.name)) continue;
        try {
          const names = await fs.promises.readdir(path.join(devicesRoot, entry.name));
          packetMax.set(
            entry.name,
            names
              .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
              .reduce((max, name) => Math.max(max, Number(name.slice(0, 12))), 0),
          );
        } catch {
          // 読めない端末は遅れを判定できない。取り込み側の失敗として扱われる。
        }
      }
      return { ids, packetMax };
    } catch {
      return null;
    }
  }

  /**
   * as_of は「この時刻より前に確定したDesktopの変更は全部入っている」でなければならない。
   * そのため、追いついていないDesktopや、遅れているかもしれない端末を数え落とさない。
   * 端末ごとの追いついた時刻は、カーソルが公開の進みに届いた時のstatusの`at`を保つ
   * （その時刻までの変更が入っているのは、後で遅れても真のまま）。
   */
  updateFreshness(scan) {
    if (!scan) return;
    const horizon = this.clock() - DEVICE_ACTIVE_WINDOW_MS;
    let unknownBehind = false;
    const counted = [];
    for (const id of scan.ids) {
      const cursor = this.repository.syncCursor(id);
      const status = this.knownStatuses.get(id);
      if (!status) {
        if ((scan.packetMax.get(id) ?? 0) > cursor) unknownBehind = true;
        continue;
      }
      // replicaが出すstatusは数えない（replicaはDesktopの変更の出どころではない）。
      if (status.role !== "desktop") continue;
      if (cursor >= status.publishedThrough) this.deviceAsOf.set(id, status.at);
      if (Date.parse(status.at) >= horizon || cursor < status.publishedThrough)
        counted.push(status);
    }
    const asOfs = counted.map((status) => this.deviceAsOf.get(status.deviceId) ?? null);
    const times = (values) => values.map((value) => Date.parse(value));
    this.countedDesktops = counted;
    this.freshness = {
      asOf:
        unknownBehind || counted.length === 0 || asOfs.includes(null)
          ? null
          : new Date(Math.min(...times(asOfs))).toISOString(),
      desktopSeenAt: counted.length
        ? new Date(Math.max(...times(counted.map((status) => status.at)))).toISOString()
        : null,
    };
  }

  /** DBが公開済みの状態より古いと分かり、公開を止めている間はtrue。新しい書き込みも受けない方がよい。 */
  isPublishBlocked() {
    return this.sequenceRolledBack;
  }

  /**
   * replica が数えている Desktop の status（同期のたびに計算した値）。共有フォルダは読まない。
   * 書き込みを断るかの判定に使う。
   */
  desktopStatuses() {
    return this.countedDesktops;
  }

  /**
   * 読み取り側のAIへ返す、同期の状態と鮮度。要求のたびに共有フォルダを読まないよう、
   * 同期のたびに計算した値を返すだけにする。端末ID・パス・エラー文は含めない。
   */
  sourceStatus(node = "replica") {
    let state;
    if (!this.repository.getPreference("sharedSyncEnabled")) state = "off";
    else if (this.lastFailure) state = this.lastFailure;
    else if (!this.hasSynced) state = "starting";
    else state = this.repository.syncConflictCount() > 0 ? "conflict" : "ok";
    return {
      node,
      state,
      as_of: this.freshness.asOf,
      desktop_seen_at: this.freshness.desktopSeenAt,
    };
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
        .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
        .sort();
      for (const fileName of files) {
        const sequence = Number(fileName.slice(0, 12));
        if (!Number.isFinite(sequence) || sequence <= cursor) continue;
        if (sequence !== cursor + 1) {
          this.waitingFor = { deviceId, sequence: cursor + 1 };
          throw codedError(
            `${deviceId} の同期差分 ${String(cursor + 1).padStart(12, "0")} を待っています。共有フォルダの同期完了後に再試行します。解消しない場合は送信側の端末で差分の再公開を実行してください。`,
            SYNC_PACKET_WAITING,
          );
        }
        let packet = null;
        try {
          packet = await readJson(path.join(devicesRoot, deviceId, fileName));
        } catch {
          this.waitingFor = { deviceId, sequence };
          throw codedError(
            `${deviceId} の同期差分 ${String(sequence).padStart(12, "0")} の到着を待っています。共有フォルダの同期完了後に再試行します。解消しない場合は送信側の端末で差分の再公開を実行してください。`,
            SYNC_PACKET_WAITING,
          );
        }
        if (packet.deviceId !== deviceId || Number(packet.deviceSequence) !== sequence) {
          throw codedError(`同期差分 ${fileName} の端末情報が一致しません。`, SYNC_PACKET_REJECTED);
        }
        let result;
        try {
          result = this.repository.applySyncPacket(packet);
        } catch (error) {
          // codeを持たない失敗は、この版では取り込めない差分（検査や保存規則の違反）。
          // SQLITE_BUSYなどcodeのある失敗は通信・DBの失敗なのでそのまま投げる。
          if (error?.code) throw error;
          throw Object.assign(new Error(syncErrorMessage(error), { cause: error }), {
            code: SYNC_PACKET_REJECTED,
          });
        }
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
export const sharedFolderSyncDeviceDirectory = DEVICE_DIRECTORY;
