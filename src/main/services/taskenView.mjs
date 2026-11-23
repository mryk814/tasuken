/**
 * View（現在形の射影）の書き手（#802・#803 設計 3 節・#811 段 3）。
 *
 * main の側で、決定的な Markdown の射影を {root}/View/ に書く。射影の中身の
 * 決まりは shared/taskenView.mjs が持ち、ここは台帳・書き手の判定・書き込み・
 * 作るタイミングを担う。repository と読み取り口だけに依存するので、NAS の
 * node でも同じコードが使える。
 *
 * 書き手は Workspace に 1 台。Settings の「この端末で View を書く」を本人が
 * 入れた端末だけが書く。書く前に台帳 .tasken-view.json の writerDeviceId を
 * 見て、別の端末なら書かない（引き継ぐときだけ台帳の書き手を自分に変える）。
 * 書き換え・削除は台帳にあるファイルだけ。中身は読まず、台帳のハッシュと
 * stat（有無と大きさ）で比べる（クラウドにしかないファイルを全部読んで
 * ダウンロードさせないため）。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  TASKEN_VIEW_LEDGER_FILE,
  TASKEN_VIEW_LEDGER_SCHEMA,
  buildTaskenViewFiles,
} from "../../shared/taskenView.mjs";
import {
  detectTaskenRootKind,
  effectiveTaskenRootKind,
  normalizeTaskenRootKindPreference,
} from "../../shared/taskenRoot.mjs";

/** 保存・受信のあと静かになるまで待つ時間（設計 3.4）。 */
export const TASKEN_VIEW_QUIET_MS = 30 * 1000;
/** 作り直しの最短間隔（設計 3.4「2 分に 1 回まで」）。 */
export const TASKEN_VIEW_MIN_INTERVAL_MS = 2 * 60 * 1000;
/** 日付の変わり目を見張る間隔。 */
const DATE_CHECK_MS = 60 * 1000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** 一時ファイルに書いてから rename する。途中で失敗しても壊れたファイルを残さない。 */
function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * 台帳を読む。無い・壊れているは例外にせず状態で返す。
 * @returns {{ state: "missing" } | { state: "invalid", error?: string } | { state: "present", ledger: object }}
 */
export function readTaskenViewLedger(viewDirectory) {
  const filePath = path.join(viewDirectory, TASKEN_VIEW_LEDGER_FILE);
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { state: "missing" };
    }
    return { state: "invalid", error: errorMessage(error) };
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.schema !== TASKEN_VIEW_LEDGER_SCHEMA ||
      !parsed.files ||
      typeof parsed.files !== "object"
    ) {
      return { state: "invalid" };
    }
    return { state: "present", ledger: parsed };
  } catch (error) {
    return { state: "invalid", error: errorMessage(error) };
  }
}

/** View の中にあるファイルの相対パス（/ 区切り）すべて。中身は読まない。 */
function listViewFiles(viewDirectory) {
  const found = [];
  const walk = (directory, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  };
  walk(viewDirectory, "");
  return found.sort();
}

export class TaskenViewService {
  /**
   * @param {{
   *   repository: {
   *     workspaceId: string,
   *     deviceId: string,
   *     getPreference(key: string): unknown,
   *     list(type: string, includeDeleted?: boolean): Array<Record<string, unknown>>,
   *     syncCursors(): Record<string, number>,
   *   },
   *   readDocumentHtml?: (document: Record<string, unknown>) => string | null,
   *   env?: Record<string, string | undefined>,
   *   now?: () => Date,
   *   log?: (level: "info" | "warn" | "error", message: string) => void,
   *   timers?: { setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function },
   * }} options
   */
  constructor({ repository, readDocumentHtml, env = process.env, now, log = () => {}, timers }) {
    this.repository = repository;
    this.readDocumentHtml = readDocumentHtml || (() => null);
    this.env = env;
    this.now = now || (() => new Date());
    this.log = log;
    this.timers = timers || {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle),
    };
    this.lastRun = null;
    this.timer = null;
    this.dateTimer = null;
    this.lastRequestAtMs = 0;
    this.lastRunAtMs = 0;
    this.lastDate = "";
    this.running = false;
    this.queued = false;
    this.stopped = true;
  }

  root() {
    return text(this.repository.getPreference("artifactDirectory"));
  }

  viewDirectory() {
    const root = this.root();
    return root ? path.join(root, "View") : "";
  }

  rootKind() {
    const preference = normalizeTaskenRootKindPreference(
      this.repository.getPreference("taskenRootKind"),
    );
    return effectiveTaskenRootKind(preference, detectTaskenRootKind(this.root(), this.env));
  }

  writerEnabled() {
    return this.repository.getPreference("taskenViewWriter") === true;
  }

  /**
   * Settings に出す状態。台帳の書き手と、この端末の関係を言う。
   * writerState: no-root / disabled（この端末で書く設定が無い）/ self / other /
   * none（まだ書き手がいない）/ invalid（台帳が読めない）
   */
  status() {
    const root = this.root();
    const base = {
      root,
      kind: this.rootKind(),
      writerEnabled: this.writerEnabled(),
      deviceId: this.repository.deviceId,
      writerDeviceId: "",
      writerState: "no-root",
      lastGeneratedAt: "",
      fileCount: 0,
      conflicts: [],
      lastRun: this.lastRun,
    };
    if (!root) return base;
    const viewDirectory = this.viewDirectory();
    const read = readTaskenViewLedger(viewDirectory);
    if (read.state === "invalid") return { ...base, writerState: "invalid" };
    if (read.state === "missing") {
      return { ...base, writerState: this.writerEnabled() ? "none" : "disabled" };
    }
    const ledger = read.ledger;
    const writerDeviceId = text(ledger.writerDeviceId);
    const managed = new Set(Object.keys(ledger.files || {}));
    const conflicts = listViewFiles(viewDirectory).filter(
      (relative) =>
        relative !== TASKEN_VIEW_LEDGER_FILE && !managed.has(relative) && !relative.includes(".tmp"),
    );
    return {
      ...base,
      writerDeviceId,
      writerState: !writerDeviceId
        ? this.writerEnabled()
          ? "none"
          : "disabled"
        : writerDeviceId === this.repository.deviceId
          ? "self"
          : "other",
      lastGeneratedAt: text(ledger.generatedAt),
      fileCount: managed.size,
      conflicts,
    };
  }

  snapshot() {
    const documents = this.repository.list("document").map((document) => {
      let html = null;
      try {
        html = this.readDocumentHtml(document);
      } catch {
        html = null;
      }
      return { ...document, html };
    });
    return {
      themes: this.repository.list("theme"),
      tasks: this.repository.list("task"),
      schedules: this.repository.list("schedule"),
      notes: this.repository.list("note"),
      documents,
    };
  }

  /**
   * 射影を作り直す。作るタイミングの制御はせず、その場で判定して書く。
   * 途中で失敗したら台帳は更新しない（次回に作り直す）。
   * @returns {{ status: string, written: string[], deleted: string[], error?: string }}
   */
  generateNow(reason = "manual") {
    const result = (status, extra = {}) => {
      const outcome = { status, written: [], deleted: [], ...extra };
      this.lastRun = {
        at: this.now().toISOString(),
        reason,
        status,
        written: outcome.written.length,
        deleted: outcome.deleted.length,
        ...(outcome.error ? { error: outcome.error } : {}),
      };
      return outcome;
    };
    const root = this.root();
    if (!root) return result("no-root");
    if (!this.writerEnabled()) return result("not-enabled");
    const viewDirectory = this.viewDirectory();
    const read = readTaskenViewLedger(viewDirectory);
    if (read.state === "invalid") return result("ledger-invalid", { error: read.error || "" });
    const ledger = read.state === "present" ? read.ledger : null;
    const writerDeviceId = text(ledger?.writerDeviceId);
    if (writerDeviceId && writerDeviceId !== this.repository.deviceId) {
      return result("other-writer", { writerDeviceId });
    }
    let files;
    try {
      files = buildTaskenViewFiles(this.snapshot(), { now: this.now() });
    } catch (error) {
      return result("failed", { error: errorMessage(error) });
    }
    const previousFiles = ledger?.files && typeof ledger.files === "object" ? ledger.files : {};
    const written = [];
    const deleted = [];
    try {
      fs.mkdirSync(viewDirectory, { recursive: true });
      for (const [relative, content] of files) {
        const hash = sha256(content);
        const size = Buffer.byteLength(content, "utf8");
        const previous = previousFiles[relative];
        let needsWrite = !previous || previous.sha256 !== hash;
        if (!needsWrite) {
          // 中身は読まず、台帳の大きさと stat で比べる。無い・大きさが違えば書き直す。
          try {
            const stat = fs.statSync(path.join(viewDirectory, relative));
            if (!stat.isFile() || stat.size !== Number(previous.size)) needsWrite = true;
          } catch {
            needsWrite = true;
          }
        }
        if (needsWrite) {
          writeFileAtomic(path.join(viewDirectory, relative), content);
          written.push(relative);
        }
      }
      for (const relative of Object.keys(previousFiles)) {
        if (files.has(relative)) continue;
        fs.rmSync(path.join(viewDirectory, relative), { force: true });
        deleted.push(relative);
      }
      const nextFiles = {};
      for (const relative of [...files.keys()].sort()) {
        const content = files.get(relative);
        nextFiles[relative] = { sha256: sha256(content), size: Buffer.byteLength(content, "utf8") };
      }
      const nextLedger = {
        schema: TASKEN_VIEW_LEDGER_SCHEMA,
        writerDeviceId: this.repository.deviceId,
        generatedAt: this.now().toISOString(),
        cursors: this.repository.syncCursors ? this.repository.syncCursors() : {},
        files: nextFiles,
      };
      writeFileAtomic(
        path.join(viewDirectory, TASKEN_VIEW_LEDGER_FILE),
        `${JSON.stringify(nextLedger, null, 2)}\n`,
      );
    } catch (error) {
      return result("failed", { error: errorMessage(error) });
    }
    if (written.length || deleted.length) {
      this.log(
        "info",
        `View を作り直しました（${reason}）: 書き換え ${written.length} 件、削除 ${deleted.length} 件`,
      );
    }
    return result(written.length || deleted.length ? "written" : "unchanged", { written, deleted });
  }

  /** 別の端末が書き手のとき、本人が引き継ぐ。台帳の書き手を自分にして作り直す。 */
  takeOver() {
    const root = this.root();
    if (!root) return { status: "no-root", written: [], deleted: [] };
    const viewDirectory = this.viewDirectory();
    const read = readTaskenViewLedger(viewDirectory);
    try {
      fs.mkdirSync(viewDirectory, { recursive: true });
      const ledger =
        read.state === "present"
          ? { ...read.ledger, writerDeviceId: this.repository.deviceId }
          : {
              schema: TASKEN_VIEW_LEDGER_SCHEMA,
              writerDeviceId: this.repository.deviceId,
              generatedAt: "",
              cursors: {},
              files: {},
            };
      writeFileAtomic(
        path.join(viewDirectory, TASKEN_VIEW_LEDGER_FILE),
        `${JSON.stringify(ledger, null, 2)}\n`,
      );
    } catch (error) {
      return { status: "failed", written: [], deleted: [], error: errorMessage(error) };
    }
    return this.generateNow("takeover");
  }

  /** Settings の「作り直す」。タイミング制御を通さず、その場で作る。 */
  rebuild() {
    return this.generateNow("manual");
  }

  /**
   * 保存・受信のあとの作り直し依頼。30 秒静かになってから、ただし
   * 前回から 2 分は空ける（設計 3.4）。
   */
  requestGenerate() {
    if (this.stopped) return;
    this.lastRequestAtMs = this.now().getTime();
    if (this.running) {
      this.queued = true;
      return;
    }
    this.armTimer();
  }

  armTimer() {
    if (this.timer !== null) return;
    const nowMs = this.now().getTime();
    const fireAt = Math.max(
      this.lastRequestAtMs + TASKEN_VIEW_QUIET_MS,
      this.lastRunAtMs + TASKEN_VIEW_MIN_INTERVAL_MS,
    );
    const delay = Math.max(0, fireAt - nowMs);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      const currentMs = this.now().getTime();
      if (
        currentMs < this.lastRequestAtMs + TASKEN_VIEW_QUIET_MS ||
        currentMs < this.lastRunAtMs + TASKEN_VIEW_MIN_INTERVAL_MS
      ) {
        this.armTimer();
        return;
      }
      this.runScheduled();
    }, delay);
  }

  runScheduled() {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    try {
      this.generateNow("scheduled");
    } catch (error) {
      this.log("warn", `View の生成に失敗しました: ${errorMessage(error)}`);
    } finally {
      this.running = false;
      this.lastRunAtMs = this.now().getTime();
    }
    if (this.queued) {
      this.queued = false;
      this.requestGenerate();
    }
  }

  /** 起動時に呼ぶ。起動の生成と、日付の変わり目の見張りを始める。 */
  start() {
    this.stopped = false;
    this.lastDate = this.todayString();
    this.runScheduled();
    if (this.dateTimer === null) {
      this.dateTimer = this.timers.setInterval(() => {
        const today = this.todayString();
        if (today !== this.lastDate) {
          this.lastDate = today;
          this.requestGenerate();
        }
      }, DATE_CHECK_MS);
      this.dateTimer?.unref?.();
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dateTimer !== null) {
      this.timers.clearInterval(this.dateTimer);
      this.dateTimer = null;
    }
  }

  todayString() {
    // 日付の区切りは射影と同じ +09:00 で見る。
    const shifted = new Date(this.now().getTime() + 9 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  }
}
