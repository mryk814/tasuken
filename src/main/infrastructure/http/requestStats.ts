import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * 入口ごとの計測（#733）。Coreのプロセスにだけ置き、日ごとに回数・時間・大きさをまとめる。
 *
 * 保存先は本体の`research-desk.sqlite`とは別のファイルにする。
 * - 本体のschema移行（DesktopとreplicaのversionのずれをRefuseする門）を動かさずに済む。
 * - 同期・Export・Snapshotに乗らない。計測はその端末の運用の記録で、本人のデータではない。
 * - 本体の書き込みと待ち合わせない（journalも別）。
 *
 * 記録するのは「入口の名前・呼び手の種類・状態・回数・時間・大きさ」だけ。入口の名前は呼び手が
 * 決まった集合から作って渡す（ここでは文字列の中身を見ない）。応答ごとにDBへは書かず、メモリにためて
 * 一定の間隔・読み出し・終了のときにまとめて書く。
 */

export interface RequestStatsRow {
  entry: string;
  caller: string;
  status: number;
  code: string;
  /** 処理時間（マイクロ秒）。 */
  us: number;
  /** 応答本文のバイト数。 */
  bytes: number;
}

export interface RequestStatsSink {
  record(row: RequestStatsRow): void;
}

export interface RequestStatsFailing {
  entry: string;
  count: number;
  failed: number;
  by_status: Record<string, number>;
  by_caller: Record<string, number>;
  by_code: Record<string, number>;
}

export interface RequestStatsReport {
  days: number;
  since: string;
  requests: number;
  slowest: {
    entry: string;
    count: number;
    avg_ms: number;
    max_ms: number;
    avg_bytes: number;
  }[];
  failing: RequestStatsFailing[];
  tool_errors: RequestStatsFailing[];
}

export interface RequestStatsOptions {
  filePath: string;
  now?: () => Date;
  flushEveryMs?: number;
}

interface Accumulated {
  day: string;
  entry: string;
  caller: string;
  status: number;
  code: string;
  count: number;
  usTotal: number;
  usMax: number;
  bytesTotal: number;
}

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface StatsDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

const RETENTION_YEARS = 1;
// 共通の形に合わせ、入力の誤りとして数えるのはこの三つだけ（認証や存在しない経路は混ぜない）。
const FAILING_STATUSES = new Set([400, 409, 422]);
const SLOWEST_LIMIT = 10;
const FAILING_LIMIT = 10;
const TOOL_ERRORS_LIMIT = 50;
// 書けない日が続いてもメモリが際限なく増えないよう、ためるkeyの数に上限を置く（超えた新しいkeyは捨てる）。
const MAX_PENDING_KEYS = 10_000;
const BROKEN_DATABASE_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB"]);

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayOffset(date: Date, days: number) {
  return localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - days));
}

function oneYearAgo(date: Date) {
  return localDay(new Date(date.getFullYear() - RETENTION_YEARS, date.getMonth(), date.getDate()));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function key(parts: readonly (string | number)[]) {
  return JSON.stringify(parts);
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function openDatabase(filePath: string): StatsDatabase {
  // better-sqliteはネイティブなので、使うときまで読み込まない。Coreのhostを束ねて読み込むだけの
  // 試験や、計測を一度も書かない経路でnativeを要求しないため。
  let require: NodeRequire;
  try {
    require = createRequire(import.meta.url);
  } catch {
    require = createRequire(path.join(process.cwd(), "noop.cjs"));
  }
  const Database = require("better-sqlite3") as new (file: string) => StatsDatabase;
  const db = new Database(filePath);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS request_stats (
      day TEXT NOT NULL,
      entry TEXT NOT NULL,
      caller TEXT NOT NULL,
      status INTEGER NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL,
      us_total INTEGER NOT NULL,
      us_max INTEGER NOT NULL,
      bytes_total INTEGER NOT NULL,
      PRIMARY KEY (day, entry, caller, status, code)
    )`);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export class RequestStats implements RequestStatsSink {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly flushEveryMs: number;
  private pending = new Map<string, Accumulated>();
  private db: StatsDatabase | null = null;
  private lastFlushAt: number;
  private flushScheduled = false;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: RequestStatsOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? (() => new Date());
    this.flushEveryMs = options.flushEveryMs ?? 30_000;
    this.lastFlushAt = this.now().getTime();
  }

  /** 要求の処理を妨げないよう、決してthrowしない。 */
  record(row: RequestStatsRow): void {
    try {
      if (this.closed) return;
      const at = this.now();
      this.add({
        day: localDay(at),
        entry: row.entry,
        caller: row.caller,
        status: nonNegativeInteger(row.status),
        code: row.code,
        count: 1,
        usTotal: nonNegativeInteger(row.us),
        usMax: nonNegativeInteger(row.us),
        bytesTotal: nonNegativeInteger(row.bytes),
      });
      // 要求が途切れても、ためた分が次の要求まで残らないようにする。unrefでプロセスの終了は止めない。
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, this.flushEveryMs);
        this.timer.unref?.();
      }
      if (!this.flushScheduled && at.getTime() - this.lastFlushAt >= this.flushEveryMs) {
        this.flushScheduled = true;
        // 書き込みは要求の処理の外で行う。
        setImmediate(() => {
          this.flushScheduled = false;
          this.flush();
        });
      }
    } catch {
      // 計測の失敗で要求を失敗させない。
    }
  }

  private add(row: Accumulated) {
    const id = key([row.day, row.entry, row.caller, row.status, row.code]);
    const current = this.pending.get(id);
    if (!current) {
      if (this.pending.size >= MAX_PENDING_KEYS) return;
      this.pending.set(id, row);
      return;
    }
    current.count += row.count;
    current.usTotal += row.usTotal;
    current.usMax = Math.max(current.usMax, row.usMax);
    current.bytesTotal += row.bytesTotal;
  }

  private database() {
    if (this.closed) throw new Error("REQUEST_STATS_CLOSED");
    this.db ??= openDatabase(this.filePath);
    return this.db;
  }

  /**
   * 壊れたファイルは脇へ退けて、次に開くときに作り直す。計測は捨ててよい記録なので、
   * 直らないまま読み出しが失敗し続けるより、新しく数え直す方を選ぶ。
   */
  private setAsideIfBroken(error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || !BROKEN_DATABASE_CODES.has(code)) return;
    try {
      this.db?.close();
    } catch {
      // 閉じられなくても退けるのは試みる。
    }
    this.db = null;
    try {
      fs.rmSync(`${this.filePath}.broken`, { force: true });
      fs.renameSync(this.filePath, `${this.filePath}.broken`);
    } catch {
      // 退けられなければ次の機会にもう一度試みる。
    }
  }

  /** ためた分をまとめて書く。失敗したら取り出した分をメモリへ戻し、失われないようにする。 */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastFlushAt = this.now().getTime();
    if (this.closed && !this.db) return;
    const taken = this.pending;
    if (taken.size === 0) return;
    this.pending = new Map();
    try {
      const db = this.database();
      const upsert = db.prepare(`INSERT INTO request_stats
        (day, entry, caller, status, code, count, us_total, us_max, bytes_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (day, entry, caller, status, code) DO UPDATE SET
          count = count + excluded.count,
          us_total = us_total + excluded.us_total,
          us_max = MAX(us_max, excluded.us_max),
          bytes_total = bytes_total + excluded.bytes_total`);
      const prune = db.prepare("DELETE FROM request_stats WHERE day < ?");
      const cutoff = oneYearAgo(this.now());
      db.transaction(() => {
        for (const row of taken.values()) {
          upsert.run(
            row.day,
            row.entry,
            row.caller,
            row.status,
            row.code,
            row.count,
            row.usTotal,
            row.usMax,
            row.bytesTotal,
          );
        }
        prune.run(cutoff);
      })();
    } catch (error) {
      for (const row of taken.values()) this.add(row);
      this.setAsideIfBroken(error);
    }
  }

  /** 直近days日（今日を含む）を、入口ごとにまとめて返す。 */
  read(days: number): RequestStatsReport {
    try {
      return this.readUnchecked(days);
    } catch (error) {
      this.setAsideIfBroken(error);
      throw error;
    }
  }

  private readUnchecked(days: number): RequestStatsReport {
    this.flush();
    const since = dayOffset(this.now(), days - 1);
    const rows = this.database()
      .prepare(
        `SELECT entry, caller, status, code,
          SUM(count) AS count, SUM(us_total) AS us_total,
          MAX(us_max) AS us_max, SUM(bytes_total) AS bytes_total
        FROM request_stats WHERE day >= ?
        GROUP BY entry, caller, status, code`,
      )
      .all(since) as {
      entry: string;
      caller: string;
      status: number;
      code: string;
      count: number;
      us_total: number;
      us_max: number;
      bytes_total: number;
    }[];

    const entries = new Map<
      string,
      { count: number; usTotal: number; usMax: number; bytesTotal: number }
    >();
    let requests = 0;
    for (const row of rows) {
      requests += row.count;
      const entry = entries.get(row.entry) ?? { count: 0, usTotal: 0, usMax: 0, bytesTotal: 0 };
      entry.count += row.count;
      entry.usTotal += row.us_total;
      entry.usMax = Math.max(entry.usMax, row.us_max);
      entry.bytesTotal += row.bytes_total;
      entries.set(row.entry, entry);
    }

    const slowest = [...entries.entries()]
      .map(([entry, value]) => ({
        entry,
        count: value.count,
        avg_ms: round1(value.usTotal / value.count / 1000),
        max_ms: round1(value.usMax / 1000),
        avg_bytes: round1(value.bytesTotal / value.count),
      }))
      .sort((a, b) => b.avg_ms - a.avg_ms || b.count - a.count || a.entry.localeCompare(b.entry))
      .slice(0, SLOWEST_LIMIT);

    const failures = (include: (entry: string, status: number) => boolean, limit: number) => {
      const grouped = new Map<string, RequestStatsFailing>();
      for (const row of rows) {
        if (!include(row.entry, row.status)) continue;
        const group = grouped.get(row.entry) ?? {
          entry: row.entry,
          count: entries.get(row.entry)?.count ?? 0,
          failed: 0,
          by_status: {},
          by_caller: {},
          by_code: {},
        };
        group.failed += row.count;
        group.by_status[String(row.status)] =
          (group.by_status[String(row.status)] ?? 0) + row.count;
        group.by_caller[row.caller] = (group.by_caller[row.caller] ?? 0) + row.count;
        if (row.code) group.by_code[row.code] = (group.by_code[row.code] ?? 0) + row.count;
        grouped.set(row.entry, group);
      }
      return [...grouped.values()]
        .sort((a, b) => b.failed - a.failed || a.entry.localeCompare(b.entry))
        .slice(0, limit);
    };

    return {
      days,
      since,
      requests,
      slowest,
      failing: failures((_entry, status) => FAILING_STATUSES.has(status), FAILING_LIMIT),
      tool_errors: failures(
        (entry, status) => entry.startsWith("tool ") && status !== 200,
        TOOL_ERRORS_LIMIT,
      ),
    };
  }

  /** 残りを書いてDBを閉じる。失敗してもthrowしない。 */
  close(): void {
    try {
      this.flush();
    } catch {
      // 終了処理を止めない。
    }
    this.closed = true;
    const db = this.db;
    this.db = null;
    try {
      db?.close();
    } catch {
      // 同上。
    }
  }
}
