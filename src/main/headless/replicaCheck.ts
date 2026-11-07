#!/usr/bin/env node
/**
 * NASのreplicaを新しい版へ入れ替えるときの検査。更新スクリプト
 * （deploy/synology/tasken-update-image.sh）が、新しいimageの中でこれを動かす。
 * 検査の中身はimageと一緒に変わり、更新スクリプトは最後の1行
 * （`TASKEN_REPLICA_CHECK {json}`）だけを読む。更新スクリプトはプル型の対象外で
 * 手で置き直すものなので、DBの作りや同期の規則をそちらに書かない。
 *
 * 版ずれをどう見るか: Desktop（正本の書き手）とreplicaの契約は共有フォルダの同期差分
 * （tasken-sync.json と devices/<端末>/<連番>-<id>.json）で、各端末のSQLite schemaは
 * 端末の中だけのもの。replicaのschemaが進んでもDesktopとの食い違いにはならない
 * （戻すときに古いimageが開けないだけで、それは更新スクリプトがDBを戻して扱う）。
 * 食い違いになるのは「この版がDesktopの書いた差分を取り込めない」ことなので、
 * 取り込みと同じ規則（repositories/syncPacketContract.mjs）で確かめる。
 *
 *   packets  共有フォルダの各端末の最近の差分を、この版で読めるか。DBは開かない
 *            （入れ替える前に、隔離したコンテナで流す）
 *   state    動いているreplicaのDBを読み取り専用で開き、起動の後に同期が通ったか、
 *            まだ取り込んでいない差分をこの版で読めるか
 *   mcp      この版のMCP bridgeが、この版のCoreにつながってtoolを出せるか（読み取り専用）
 *
 * replicaが書いた差分をDesktopが読めるか（逆向き）は、Desktopの版を共有フォルダから
 * 知る手段がまだ無いので、ここでは確かめない。
 *
 * 出力に本文・token・Entityの中身を出さない。端末IDは先頭8文字だけ。
 * 終了コード: 0 合格、3 不合格、2 使い方か読み取りの失敗。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// @ts-expect-error better-sqlite3 は型を持たない。Repository（.mjs）の推論を変えないよう、全体の宣言は足さない。
import BetterSqlite3 from "better-sqlite3";

import { assertSyncPacket } from "../repositories/syncPacketContract.mjs";
import {
  SYNC_PACKET_FILE_PATTERN,
  sharedFolderSyncDeviceDirectory,
  sharedFolderSyncManifestFile,
} from "../services/sharedFolderSync.mjs";

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
const Database = BetterSqlite3 as new (
  filename: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => { prepare(sql: string): SqliteStatement; close(): void };

export const REPLICA_CHECK_SCHEMA_VERSION = 1;
const OUTPUT_PREFIX = "TASKEN_REPLICA_CHECK";
const REASON_LIMIT = 160;
const SAMPLE_LIMIT = 3;
/** 入れ替えの前に見る、端末ごとの最近の差分の数。Desktopの今の版が書いた形を見る。 */
export const DEFAULT_RECENT_PACKETS = 300;
/** そのうち、読めなければ入れ替えを止める最新の差分の数（端末ごと）。 */
export const DEFAULT_BLOCKING_PACKETS = 20;
/** stateで中身まで確かめる未取り込みの差分の上限（端末をまたいだ合計）。 */
const PENDING_VALIDATE_LIMIT = 500;

export interface PacketRejection {
  device: string;
  sequence: number;
  entity_type: string;
  reason: string;
}

export interface PacketCheckResult {
  compatible: boolean;
  manifest_ok: boolean;
  reason?: string;
  devices: number;
  excluded_device?: string;
  checked: number;
  unreadable: number;
  /** 止める理由になった拒否（各端末の最新の数件）。 */
  rejected_total: number;
  /** それより古い差分の拒否。取り込み済みなので止めない。 */
  rejected_old: number;
  rejected: PacketRejection[];
}

export type ReplicaSyncVerdict =
  "synced" | "incompatible" | "waiting" | "error" | "pending" | "disabled";

export interface ReplicaStateResult {
  db_schema_version: number;
  sync: {
    enabled: boolean;
    directory_matches: boolean;
    last_at: string;
    synced_since: boolean | null;
    last_error: string;
    /** 比べるための完全な文の SHA-256 先頭16桁。last_error は短く切るため。 */
    last_error_sha256: string;
    behind: number;
    waiting: boolean;
    pending_invalid: PacketRejection | null;
    conflicts: number;
    outbox_unpublished: number;
  };
  verdict: ReplicaSyncVerdict;
}

export interface McpProbeResult {
  ok: boolean;
  tools: number;
  capabilities_ok: boolean;
  reason?: string;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > REASON_LIMIT ? `${message.slice(0, REASON_LIMIT)}…` : message;
}

/** 更新スクリプトの python が同じ値を作る（utf-8 の SHA-256、先頭16桁）。空なら空。 */
export function errorDigest(message: string): string {
  return message ? createHash("sha256").update(message, "utf8").digest("hex").slice(0, 16) : "";
}

function entityTypeOf(packet: unknown): string {
  const value = (packet as { entityType?: unknown } | null)?.entityType;
  return typeof value === "string" ? value.slice(0, 40) : "";
}

function readManifestWorkspace(
  syncDirectory: string,
): { workspaceId: string } | { reason: string } {
  let manifest: { format?: unknown; formatVersion?: unknown; workspaceId?: unknown };
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(syncDirectory, sharedFolderSyncManifestFile), "utf8"),
    );
  } catch {
    return { reason: "共有フォルダの tasken-sync.json を読めない" };
  }
  // SharedFolderSyncService.readManifest と同じ条件。形式の版が上がれば、この版では読めない。
  if (
    manifest?.format !== "tasken-shared-folder-sync" ||
    manifest?.formatVersion !== 1 ||
    typeof manifest?.workspaceId !== "string"
  ) {
    return { reason: "tasken-sync.json の形式をこの版で読めない" };
  }
  return { workspaceId: manifest.workspaceId };
}

function listDevices(syncDirectory: string): string[] {
  const root = path.join(syncDirectory, sharedFolderSyncDeviceDirectory);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listPacketFiles(syncDirectory: string, device: string): string[] {
  return fs
    .readdirSync(path.join(syncDirectory, sharedFolderSyncDeviceDirectory, device))
    .filter((name) => SYNC_PACKET_FILE_PATTERN.test(name))
    .sort();
}

type PacketRead = { packet: unknown } | { unreadable: true };

function readPacket(syncDirectory: string, device: string, fileName: string): PacketRead {
  try {
    return {
      packet: JSON.parse(
        fs.readFileSync(
          path.join(syncDirectory, sharedFolderSyncDeviceDirectory, device, fileName),
          "utf8",
        ),
      ),
    };
  } catch {
    // 共有フォルダへのコピーの途中。取り込み側も到着を待つだけで、版ずれではない。
    return { unreadable: true };
  }
}

/** 取り込み（SharedFolderSyncService.receiveChanges と applySyncPacket）と同じ規則。 */
function packetRejection(
  packet: unknown,
  device: string,
  sequence: number,
  workspaceId: string,
): PacketRejection | null {
  try {
    assertSyncPacket(packet, workspaceId);
    const header = packet as { deviceId?: unknown; deviceSequence?: unknown };
    if (header.deviceId !== device || Number(header.deviceSequence) !== sequence) {
      throw new Error("同期差分の端末情報が一致しません。");
    }
    return null;
  } catch (error) {
    return {
      device: shortId(device),
      sequence,
      entity_type: entityTypeOf(packet),
      reason: shortReason(error),
    };
  }
}

/**
 * 共有フォルダの各端末の最近の差分を、この版の取り込み規則で読めるか。
 *
 * 止めるのは、各端末の最新の `blocking` 件に読めない差分があるときだけ。最新の差分が、その端末の
 * 今の版が書く形を表す。それより古い差分は取り込み済みで、この版がもう読まなくてよいもの
 * （規則を厳しくした版や、廃止したEntity型で永久に止まらないように、数だけ rejected_old に出す）。
 * replica自身の端末（`excludeDevice`）は取り込みが読まないので見ない。
 * ほかの端末に差分があるのに一つも読めなければ、確かめられていないので合格にしない。
 */
export function checkSyncPackets(
  syncDirectory: string,
  {
    recent = DEFAULT_RECENT_PACKETS,
    blocking = DEFAULT_BLOCKING_PACKETS,
    excludeDevice = "",
  }: { recent?: number; blocking?: number; excludeDevice?: string } = {},
): PacketCheckResult {
  const manifest = readManifestWorkspace(syncDirectory);
  if ("reason" in manifest) {
    return {
      compatible: false,
      manifest_ok: false,
      reason: manifest.reason,
      devices: 0,
      checked: 0,
      unreadable: 0,
      rejected_total: 0,
      rejected_old: 0,
      rejected: [],
    };
  }
  const rejected: PacketRejection[] = [];
  let rejectedTotal = 0;
  let rejectedOld = 0;
  let checked = 0;
  let unreadable = 0;
  let published = 0;
  const devices = listDevices(syncDirectory).filter((device) => device !== excludeDevice);
  for (const device of devices) {
    const files = listPacketFiles(syncDirectory, device).slice(-recent);
    published += files.length;
    files.forEach((fileName, index) => {
      const read = readPacket(syncDirectory, device, fileName);
      if ("unreadable" in read) {
        unreadable += 1;
        return;
      }
      checked += 1;
      const rejection = packetRejection(
        read.packet,
        device,
        Number(fileName.slice(0, 12)),
        manifest.workspaceId,
      );
      if (!rejection) return;
      if (index < files.length - blocking) {
        rejectedOld += 1;
        return;
      }
      rejectedTotal += 1;
      if (rejected.length < SAMPLE_LIMIT) rejected.push(rejection);
    });
  }
  const nothingReadable = published > 0 && checked === 0;
  return {
    compatible: rejectedTotal === 0 && !nothingReadable,
    manifest_ok: true,
    ...(nothingReadable ? { reason: "ほかの端末の差分を一つも読めない" } : {}),
    devices: devices.length,
    ...(excludeDevice ? { excluded_device: shortId(excludeDevice) } : {}),
    checked,
    unreadable,
    rejected_total: rejectedTotal,
    rejected_old: rejectedOld,
    rejected,
  };
}

/**
 * 同期の失敗のうち、共有フォルダへの到着を待っているだけのもの（版のせいではない）。
 * 差分の連番の抜け・差分や添付画像や写真の到着待ちは、どれも「…待っています」で返る
 * （services/sharedFolderSync.mjs・sharedFolderAttachments.mjs）。
 */
export function isWaitingSyncError(message: string): boolean {
  return message.includes("待っています");
}

/**
 * 動いているreplicaのDBを読み取り専用で開き、同期の様子を返す。
 * `since` はコンテナの起動時刻。その後に一度でも同期が通ったか（synced_since）を見る。
 * headless Coreは起動時に同期を一度終えてからhealthに応答するので、healthの後に読めば
 * 起動直後の同期の結果が入っている。
 */
export function readReplicaState({
  databasePath,
  syncDirectory,
  since,
}: {
  databasePath: string;
  syncDirectory: string;
  since?: string;
}): ReplicaStateResult {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  let meta: (key: string) => string;
  let cursors: Map<string, number>;
  let conflicts: number;
  let outboxUnpublished: number;
  let schemaVersion: number;
  try {
    const statement = db.prepare("SELECT value FROM workspace_meta WHERE key = ?");
    meta = (() => {
      const values = new Map<string, string>();
      for (const key of [
        "schema_version",
        "workspace_id",
        "device_id",
        "shared_sync_enabled",
        "shared_sync_directory",
        "shared_sync_last_at",
        "shared_sync_last_error",
      ]) {
        const row = statement.get(key) as { value?: unknown } | undefined;
        values.set(key, typeof row?.value === "string" ? row.value : "");
      }
      return (key: string) => values.get(key) ?? "";
    })();
    schemaVersion = Number(meta("schema_version")) || 0;
    cursors = new Map(
      (
        db.prepare("SELECT device_id, last_sequence FROM sync_device_cursors").all() as Array<{
          device_id: string;
          last_sequence: number;
        }>
      ).map((row) => [row.device_id, Number(row.last_sequence) || 0]),
    );
    conflicts = Number(
      (db.prepare("SELECT COUNT(*) AS count FROM sync_conflicts").get() as { count: number }).count,
    );
    outboxUnpublished = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE published_at IS NULL")
          .get() as { count: number }
      ).count,
    );
  } finally {
    db.close();
  }

  const enabled = meta("shared_sync_enabled") === "true";
  const lastAt = meta("shared_sync_last_at");
  const lastError = meta("shared_sync_last_error");
  const ownDevice = meta("device_id");
  const workspaceId = meta("workspace_id");
  let behind = 0;
  let waiting = false;
  let pendingInvalid: PacketRejection | null = null;
  let validated = 0;
  if (enabled && fs.existsSync(syncDirectory)) {
    for (const device of listDevices(syncDirectory)) {
      if (device === ownDevice) continue;
      const cursor = cursors.get(device) ?? 0;
      const pending = listPacketFiles(syncDirectory, device).filter(
        (name) => Number(name.slice(0, 12)) > cursor,
      );
      behind += pending.length;
      if (pending.length && Number(pending[0].slice(0, 12)) !== cursor + 1) waiting = true;
      for (const fileName of pending) {
        if (pendingInvalid || validated >= PENDING_VALIDATE_LIMIT) break;
        const read = readPacket(syncDirectory, device, fileName);
        if ("unreadable" in read) {
          waiting = true;
          break;
        }
        validated += 1;
        pendingInvalid = packetRejection(
          read.packet,
          device,
          Number(fileName.slice(0, 12)),
          workspaceId,
        );
      }
    }
  }
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const lastAtMs = lastAt ? Date.parse(lastAt) : Number.NaN;
  const syncedSince = since
    ? Number.isFinite(sinceMs) && Number.isFinite(lastAtMs) && lastAtMs >= sinceMs
    : null;
  // 同期が通ると last_error は空に戻る。後で失敗すると last_at は前の成功のまま残る。
  const succeeded = !lastError && (since ? syncedSince === true : Boolean(lastAt));
  // 差分の連番の抜けは上で見た。添付画像や写真の到着待ちは差分からは分からないので、文で見る。
  if (lastError && isWaitingSyncError(lastError)) waiting = true;
  const verdict: ReplicaSyncVerdict = !enabled
    ? "disabled"
    : pendingInvalid
      ? "incompatible"
      : succeeded
        ? "synced"
        : lastError && waiting
          ? "waiting"
          : lastError
            ? "error"
            : "pending";
  return {
    db_schema_version: schemaVersion,
    sync: {
      enabled,
      directory_matches:
        path.resolve(meta("shared_sync_directory") || "/") === path.resolve(syncDirectory),
      last_at: lastAt,
      synced_since: syncedSince,
      last_error:
        lastError.length > REASON_LIMIT ? `${lastError.slice(0, REASON_LIMIT)}…` : lastError,
      last_error_sha256: errorDigest(lastError),
      behind,
      waiting,
      pending_invalid: pendingInvalid,
      conflicts,
      outbox_unpublished: outboxUnpublished,
    },
    verdict,
  };
}

/** この版のMCP bridge（stdio）を読み取り専用で起こし、Coreにつながってtoolを出せるか。 */
export async function probeMcp({
  userDataPath,
  serverPath,
  timeoutMs = 30_000,
}: {
  userDataPath: string;
  serverPath: string;
  timeoutMs?: number;
}): Promise<McpProbeResult> {
  if (!fs.existsSync(serverPath)) {
    return { ok: false, tools: 0, capabilities_ok: false, reason: "MCP bridgeが見つからない" };
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...env, TASKEN_USER_DATA_DIR: userDataPath, TASKEN_MCP_READ_ONLY: "1" },
    stderr: "pipe",
  });
  const client = new Client({ name: "tasken-replica-check", version: "1.0.0" });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MCP bridgeが${timeoutMs}ms以内に応答しない`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        const { tools } = await client.listTools();
        const listed = tools.some((tool) => tool.name === "tasken.get_capabilities");
        const result = listed
          ? await client.callTool({ name: "tasken.get_capabilities", arguments: {} })
          : null;
        const capabilitiesOk = Boolean(result) && result?.isError !== true;
        return {
          ok: tools.length > 0 && capabilitiesOk,
          tools: tools.length,
          capabilities_ok: capabilitiesOk,
          ...(capabilitiesOk ? {} : { reason: "tasken.get_capabilities が通らない" }),
        };
      })(),
      timeout,
    ]);
  } catch (error) {
    return { ok: false, tools: 0, capabilities_ok: false, reason: shortReason(error) };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => {});
  }
}

const USAGE = `Usage:
  node core-dist/replica-check.mjs packets --sync-dir=<path> [--recent=<n>] [--exclude-device=<id>]
  node core-dist/replica-check.mjs state --user-data-dir=<path> --sync-dir=<path> [--db-path=<path>] [--since=<ISO 8601>]
  node core-dist/replica-check.mjs mcp --user-data-dir=<path> [--mcp-server=<path>]`;

function emit(check: string, body: Record<string, unknown>): void {
  process.stdout.write(
    `${OUTPUT_PREFIX} ${JSON.stringify({
      schema_version: REPLICA_CHECK_SCHEMA_VERSION,
      check,
      source_sha: process.env.TASKEN_SOURCE_SHA || null,
      ...body,
    })}\n`,
  );
}

export async function runReplicaCheck(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        "sync-dir": { type: "string" },
        "user-data-dir": { type: "string" },
        "db-path": { type: "string" },
        since: { type: "string" },
        recent: { type: "string" },
        "exclude-device": { type: "string" },
        "mcp-server": { type: "string" },
      },
      allowPositionals: false,
    }) as { values: Record<string, string | undefined> });
  } catch (error) {
    process.stderr.write(`${shortReason(error)}\n${USAGE}\n`);
    return 2;
  }
  try {
    if (command === "packets" && values["sync-dir"]) {
      const recent = values.recent ? Number(values.recent) : DEFAULT_RECENT_PACKETS;
      if (!Number.isInteger(recent) || recent < 1) throw new Error("--recentは1以上の整数");
      const result = checkSyncPackets(path.resolve(values["sync-dir"]), {
        recent,
        excludeDevice: values["exclude-device"] || "",
      });
      emit("packets", { ...result });
      return result.compatible ? 0 : 3;
    }
    if (command === "state" && values["user-data-dir"] && values["sync-dir"]) {
      const userDataPath = path.resolve(values["user-data-dir"]);
      const result = readReplicaState({
        databasePath: path.resolve(
          values["db-path"] || path.join(userDataPath, "research-desk.sqlite"),
        ),
        syncDirectory: path.resolve(values["sync-dir"]),
        ...(values.since ? { since: values.since } : {}),
      });
      emit("state", { ...result });
      return result.verdict === "synced" ? 0 : 3;
    }
    if (command === "mcp" && values["user-data-dir"]) {
      const result = await probeMcp({
        userDataPath: path.resolve(values["user-data-dir"]),
        serverPath: path.resolve(
          values["mcp-server"] || fileURLToPath(new URL("../mcp-dist/server.mjs", import.meta.url)),
        ),
      });
      emit("mcp", { ...result });
      return result.ok ? 0 : 3;
    }
  } catch (error) {
    emit(command || "unknown", { error: shortReason(error) });
    return 2;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

// 入口の判定は実体のpathで比べる（symlinkを経た起動で黙って何もしないのを避ける）。
function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  void runReplicaCheck(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
