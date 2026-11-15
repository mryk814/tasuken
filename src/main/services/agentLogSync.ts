import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import {
  createNativeAgentLogAccumulator,
  type AgentLogPickup,
} from "../../shared/agentLogPickup.ts";
import {
  AGENT_LOG_QUIET_MS,
  type AgentLogProbe,
  type AgentLogService,
  type AgentLogSourceConfig,
  type AgentLogSyncStatus,
} from "../../shared/agentLogSync.ts";

export function agentLogCandidates(
  service: AgentLogService,
  home: string,
  env: Record<string, string | undefined>,
) {
  const configured = env[service === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"];
  const leaf = service === "codex" ? "sessions" : "projects";
  return [
    ...(configured && path.isAbsolute(configured)
      ? [
          {
            service,
            label: service === "codex" ? "CODEX_HOME の保存先" : "CLAUDE_CONFIG_DIR の保存先",
            path: path.resolve(configured, leaf),
          },
        ]
      : []),
    {
      service,
      label: "この PC の標準保存先",
      path: path.resolve(home, service === "codex" ? ".codex" : ".claude", leaf),
    },
  ];
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const serviceValid = (value: unknown): value is AgentLogService =>
  value === "codex" || value === "claude_code";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** 内容が変わるまで同じ結果になる解析失敗。IO・保存の失敗は含めない。 */
class AgentLogFormatError extends Error {}
/** 1 回の読み取りの上限に達した。そのファイルの誤りではなく、残りを次回へ回す合図。 */
class AgentLogRunBudgetError extends Error {}
const FILE_LIMIT = 128 * 1024 * 1024;
const RUN_LIMIT = 512 * 1024 * 1024;
const RUN_LIMIT_MESSAGE = "1回512MBの上限です。次回に残りを読みます。";
/** Codex は古い会話のログを zstd で圧縮する（`rollout-*.jsonl.zst`）。 */
const isCompressedLog = (file: string) => file.endsWith(".jsonl.zst");
const isLogFile = (name: string) => name.endsWith(".jsonl") || isCompressedLog(name);
const errorPrefix = (source: Pick<AgentLogSourceConfig, "service" | "path">) =>
  `${digest(source.service + "\0" + source.path)}:error:`;
const locationMessage = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT"
    ? "保存先またはログが見つかりません。場所を再確認してください。"
    : code === "EACCES" || code === "EPERM"
      ? "保存先にアクセスできません。読める場所を選んでください。"
      : message(error);
};
const blank = (): AgentLogSyncStatus => ({
  sources: [],
  background: false,
  state: "idle",
  scanned: 0,
  recorded: 0,
  unchanged: 0,
  active: 0,
  errors: [],
});

/** recorded = 新しく 1 件書いた。covered = もう数えてある（判定は Core の受け口の 1 か所）。 */
export type AgentLogPickupOutcome = "recorded" | "covered";

/**
 * 本人が登録した保存先のログから、静かになった会話だけを 1 件ずつ拾う（#751）。
 *
 * - 動いている会話（最後の動きから 60 分たっていない）は読まない。会話が伸びるたびに読み直して
 *   書き換える事はしない（1 件は 1 回だけ書く）。
 * - 同じ作業かどうかは、ここでは決めない。拾った物を `submit`（Core の受け口）に渡し、
 *   そこが「書いた」か「もう数えてある」かを返す。
 * - `picked` は「このファイルのこの大きさ・更新時刻は、もう見た」の控え。無くしても、
 *   Core が同じ会話を 2 件にしない（読み直しの手間が増えるだけ）。
 */
export class AgentLogSync {
  private value = blank();
  private picked: Record<string, string> = {};
  private running: Promise<AgentLogSyncStatus> | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly directory: string;
  private readonly submit: (
    pickup: AgentLogPickup,
    destination: string,
  ) => Promise<AgentLogPickupOutcome>;
  private readonly now: () => number;
  private readonly onFinished?: (status: AgentLogSyncStatus) => void;
  constructor(
    directory: string,
    submit: (pickup: AgentLogPickup, destination: string) => Promise<AgentLogPickupOutcome>,
    options: {
      now?: () => number;
      /** 1 回の読み取りが終わるたびに 1 回だけ呼ぶ（止めた時・誤りで終わった時も）。 */
      onFinished?: (status: AgentLogSyncStatus) => void;
    } = {},
  ) {
    this.directory = directory;
    this.submit = submit;
    this.now = options.now || (() => Date.now());
    this.onFinished = options.onFinished;
  }
  async load() {
    if (this.loaded) return;
    if (!this.loading) this.loading = this.readState();
    return this.loading;
  }
  private async readState() {
    try {
      const stored = JSON.parse(
        await fs.promises.readFile(path.join(this.directory, "sources.json"), "utf8"),
      );
      if (!Array.isArray(stored.sources) || stored.sources.length > 20)
        throw new Error("保存先設定が壊れています。");
      this.value.sources = stored.sources.filter(
        (s: AgentLogSourceConfig) =>
          serviceValid(s.service) && typeof s.path === "string" && path.isAbsolute(s.path),
      );
      this.value.background = stored.background === true;
      // 前の版の控え（fingerprints）は読まない。前の版は動いている会話も読んでいたので、
      // 「見た」の意味が違う。古い形でもう入っている会話は、Core が拾い直さない。
      this.picked = stored.picked && typeof stored.picked === "object" ? stored.picked : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.value.state = "error";
        this.value.errors = [message(error)];
      }
    }
    this.loaded = true;
    this.updateTimer();
  }
  status(): AgentLogSyncStatus {
    return structuredClone(this.value);
  }
  private async persist() {
    const next = this.writing.then(
      () => this.writeState(),
      () => this.writeState(),
    );
    this.writing = next;
    return next;
  }
  private async writeState() {
    const keys = Object.keys(this.picked);
    if (keys.length > 50000)
      for (const key of keys.slice(0, keys.length - 50000)) delete this.picked[key];
    await fs.promises.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, "sources.json");
    await fs.promises.writeFile(
      file + ".tmp",
      JSON.stringify({
        sources: this.value.sources,
        background: this.value.background,
        picked: this.picked,
      }),
    );
    await fs.promises.rename(file + ".tmp", file);
  }
  private updateTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = this.value.background
      ? setInterval(() => {
          void this.run().catch(() => {});
        }, 5 * 60_000)
      : null;
    this.timer?.unref();
  }
  async configure(input: AgentLogSourceConfig, destination: string) {
    await this.load();
    if (this.running) throw new Error("同期を止めてから保存先を変更してください。");
    if (!input?.consent || input.destination !== destination)
      throw new Error("保存内容と現在の保存先を確認してください。");
    if (
      !serviceValid(input.service) ||
      typeof input.path !== "string" ||
      !path.isAbsolute(input.path)
    )
      throw new Error("保存先を選択してください。");
    const selected = path.resolve(input.path);
    const existing = this.value.sources.find(
      (s) => s.path === selected && s.service === input.service,
    );
    if (existing) {
      existing.destination = destination;
      // 読めなかったログを、同じ中身でもう一度試す。
      const prefix = errorPrefix(existing);
      for (const key of Object.keys(this.picked)) {
        if (!key.startsWith(prefix)) continue;
        delete this.picked[key.slice(prefix.length)];
        delete this.picked[key];
      }
      await this.persist();
      return this.status();
    }
    if (this.value.sources.length >= 20) throw new Error("保存先は20件まで登録できます。");
    this.value.sources.push({
      id: randomUUID(),
      service: input.service,
      path: selected,
      destination,
      lastScan: null,
      message: "まだ見ていません",
    });
    await this.persist();
    return this.status();
  }
  async remove(id: string) {
    await this.load();
    if (this.running) throw new Error("同期を止めてから保存先を変更してください。");
    this.value.sources = this.value.sources.filter((s) => s.id !== id);
    await this.persist();
    return this.status();
  }
  async background(enabled: boolean) {
    await this.load();
    if (typeof enabled !== "boolean") throw new Error("定期同期の設定が不正です。");
    const before = this.value.background;
    this.value.background = enabled;
    try {
      await this.persist();
    } catch (error) {
      this.value.background = before;
      throw error;
    }
    this.updateTimer();
    return this.status();
  }
  cancel() {
    this.abort?.abort();
    return this.status();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cancel();
  }
  private async files(root: string, signal?: AbortSignal) {
    const actual = await fs.promises.realpath(root);
    const files: Array<{ file: string; size: number; mtime: number }> = [];
    let visited = 0;
    const walk = async (directory: string, depth: number) => {
      signal?.throwIfAborted();
      if (depth > 6) throw new Error("保存先が深すぎます。ログのフォルダーを絞ってください。");
      const entries = await fs.promises.opendir(directory);
      for await (const entry of entries) {
        signal?.throwIfAborted();
        if (++visited > 100000) throw new Error("走査上限です。保存先を絞ってください。");
        if (entry.isSymbolicLink() || entry.name === "subagents") continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(file, depth + 1);
        else if (entry.isFile() && isLogFile(entry.name)) {
          const resolved = await fs.promises.realpath(file);
          const relative = path.relative(actual, resolved);
          if (relative.startsWith("..") || path.isAbsolute(relative))
            throw new Error("保存先の外へ続くリンクは読みません。");
          const stat = await fs.promises.stat(resolved);
          files.push({ file: resolved, size: stat.size, mtime: stat.mtimeMs });
          if (files.length > 10000)
            throw new Error("ファイル数の上限です。保存先を絞ってください。");
        }
      }
    };
    await walk(actual, 0);
    return files.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
  }
  async probe(service: AgentLogService, root: string): Promise<AgentLogProbe> {
    if (!serviceValid(service) || typeof root !== "string" || !path.isAbsolute(root))
      throw new Error("サービスと保存先を選択してください。");
    try {
      const files = await this.files(root, AbortSignal.timeout(15_000));
      const latest = Math.max(...files.map((f) => f.mtime), 0);
      return {
        state: files.length ? "ready" : "empty",
        count: files.length,
        lastUpdated: latest ? new Date(latest).toISOString() : null,
        message: files.length
          ? "JSONL 候補。対応形式は拾う時に確認します。"
          : "フォルダーはありますが JSONL はありません。",
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const state =
        code === "ENOENT"
          ? "missing"
          : code === "EACCES" || code === "EPERM"
            ? "denied"
            : /上限|深すぎ/.test(message(error))
              ? "limited"
              : "error";
      return {
        state,
        count: 0,
        lastUpdated: null,
        message:
          state === "missing"
            ? "保存先がありません。未使用か別の環境を確認してください。"
            : state === "denied"
              ? "この PC から読めません。アクセス可能な保存先を選んでください。"
              : message(error),
      };
    }
  }
  /**
   * 静かになったログ 1 つを読む。拾わない物（subagent などの委任 thread）は pickup が null。
   * 圧縮されたログ（.jsonl.zst）は展開しながら読み、大きさの上限は展開後の大きさで数える
   * （`budget` は、この回の読み取りに残っている大きさ）。返す bytes は読んだ（展開後の）大きさ。
   */
  private async read(file: string, service: AgentLogService, signal: AbortSignal, budget: number) {
    const accumulator = createNativeAgentLogAccumulator(service);
    const add = (line: string) => {
      let decoded;
      try {
        decoded = JSON.parse(line);
      } catch {
        throw new AgentLogFormatError("JSONL に壊れた行があります。形式を確認してください。");
      }
      try {
        accumulator.add(decoded);
      } catch (error) {
        throw new AgentLogFormatError(message(error));
      }
    };
    const compressed = isCompressedLog(file);
    const source = fs.createReadStream(file, {
      ...(compressed ? {} : { encoding: "utf8" as const }),
      highWaterMark: 64 * 1024,
      signal,
    });
    // 展開の誤り（壊れた圧縮）は、中身が変わるまで同じ結果になる。
    const inflate = compressed ? zlib.createZstdDecompress() : null;
    if (inflate) {
      source.on("error", (error) => inflate.destroy(error));
      source.pipe(inflate);
      inflate.setEncoding("utf8");
    }
    const stream: AsyncIterable<string> = inflate ?? source;
    let buffer = "";
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        bytes += Buffer.byteLength(chunk as string);
        // 圧縮されたログは、開くまで大きさが分からない。展開後の大きさで止める。
        if (bytes > FILE_LIMIT)
          throw new AgentLogFormatError("128MB の上限です（展開後の大きさ）。");
        if (bytes > budget) throw new AgentLogRunBudgetError(RUN_LIMIT_MESSAGE);
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (Buffer.byteLength(line) > 8 * 1024 * 1024)
            throw new AgentLogFormatError("1行8MBの上限です。");
          if (line.trim()) add(line);
        }
        if (Buffer.byteLength(buffer) > 8 * 1024 * 1024)
          throw new AgentLogFormatError("1行8MBの上限です。");
      }
      if (buffer.trim()) {
        // 改行で終わっていない最後の行。静かになった後も壊れたままなら、書きかけで終わった行なので捨てる。
        let whole = true;
        try {
          JSON.parse(buffer);
        } catch {
          whole = false;
        }
        if (whole) add(buffer);
      }
      if (accumulator.skipReason()) return { pickup: null, bytes };
      try {
        return { pickup: accumulator.finish(), bytes };
      } catch (error) {
        throw new AgentLogFormatError(message(error));
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (compressed && typeof code === "string" && /^(ZSTD_|ERR_ZSTD|Z_)/.test(code))
        throw new AgentLogFormatError("圧縮されたログを展開できません。", { cause: error });
      throw error;
    } finally {
      inflate?.destroy();
      source.destroy();
    }
  }
  async run(): Promise<AgentLogSyncStatus> {
    await this.load();
    if (this.running) return this.running;
    this.running = this.scan().finally(() => {
      this.running = null;
      this.abort = null;
      try {
        this.onFinished?.(this.status());
      } catch {
        // 画面への知らせの失敗で、読み取りの結果を変えない。
      }
    });
    return this.running;
  }
  private async scan() {
    this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]);
    Object.assign(this.value, {
      state: "running",
      scanned: 0,
      recorded: 0,
      unchanged: 0,
      active: 0,
      errors: [],
    });
    let bytes = 0;
    try {
      for (const source of this.value.sources) {
        let issues = 0;
        let active = 0;
        try {
          const files = await this.files(source.path, signal);
          for (const file of files) {
            signal.throwIfAborted();
            const key = digest(source.service + "\0" + file.file);
            const errorKey = errorPrefix(source) + key;
            this.value.scanned++;
            // 動いている会話は読まない。静かになってから 1 回だけ拾う。
            if (this.now() - file.mtime < AGENT_LOG_QUIET_MS) {
              this.value.active++;
              active++;
              continue;
            }
            const statKey = `${file.size}:${file.mtime}`;
            if (this.picked[key] === statKey) {
              this.value.unchanged++;
              const priorError = this.picked[errorKey];
              if (priorError) {
                issues++;
                source.message = `読込できないログ: ${priorError}`;
                if (this.value.errors.length < 20)
                  this.value.errors.push(
                    `${source.service} · ${path.basename(file.file)}: ${priorError}`,
                  );
              }
              continue;
            }
            const compressed = isCompressedLog(file.file);
            if (file.size > FILE_LIMIT) {
              issues++;
              source.message = "128MB の上限を超えるログがあります。";
              if (this.value.errors.length < 20)
                this.value.errors.push(
                  `${source.service} · ${path.basename(file.file)}: 128MB の上限です。`,
                );
              continue;
            }
            // 圧縮されていないログは、開く前に大きさで数える。圧縮されたログは、読みながら
            // 展開後の大きさで数える（read が上限で止める）。
            if (!compressed) {
              if (bytes + file.size > RUN_LIMIT) throw new Error(RUN_LIMIT_MESSAGE);
              bytes += file.size;
            } else if (bytes >= RUN_LIMIT) throw new Error(RUN_LIMIT_MESSAGE);
            try {
              const { pickup, bytes: read } = await this.read(
                file.file,
                source.service,
                signal,
                compressed ? RUN_LIMIT - bytes : Number.POSITIVE_INFINITY,
              );
              if (compressed) bytes += read;
              delete this.picked[errorKey];
              if (!pickup) {
                // subagent・レビュー用threadは親の会話の一部。単独では拾わない。
                this.value.unchanged++;
                this.picked[key] = statKey;
                continue;
              }
              // ファイルの更新時刻が古くても、ログの中の最後の動きが新しければ、まだ動いている。
              if (this.now() - Date.parse(pickup.ended_at) < AGENT_LOG_QUIET_MS) {
                this.value.active++;
                active++;
                continue;
              }
              const result = await this.submit(pickup, source.destination);
              if (result === "recorded") this.value.recorded++;
              else this.value.unchanged++;
              const after = await fs.promises.stat(file.file);
              if (after.size === file.size && after.mtimeMs === file.mtime)
                this.picked[key] = statKey;
              // Checkpoint in batches; rewriting a growing index for every small log is quadratic IO.
              if (this.value.scanned % 100 === 0) await this.persist();
            } catch (error) {
              signal.throwIfAborted();
              if (error instanceof AgentLogRunBudgetError)
                throw new Error(error.message, { cause: error });
              if (error instanceof AgentLogFormatError) {
                this.picked[key] = statKey;
                this.picked[errorKey] = message(error);
              }
              issues++;
              source.message = `読込できないログ: ${message(error)}`;
              if (this.value.errors.length < 20)
                this.value.errors.push(
                  `${source.service} · ${path.basename(file.file)}: ${message(error)}`,
                );
            }
          }
          if (!issues)
            source.message = !files.length
              ? "JSONL がありません。"
              : active
                ? `静かになった会話を拾いました（動いている ${active} 件は、静かになってから）`
                : "静かになった会話を拾いました";
        } catch (error) {
          signal.throwIfAborted();
          source.message = locationMessage(error);
          if (this.value.errors.length < 20)
            this.value.errors.push(`${source.service}: ${locationMessage(error)}`);
        } finally {
          source.lastScan = new Date(this.now()).toISOString();
        }
      }
      this.value.state = this.value.errors.length ? "error" : "idle";
    } catch (error) {
      this.value.state = this.abort.signal.aborted ? "cancelled" : "error";
      if (!this.abort.signal.aborted) this.value.errors.push(message(error));
    }
    try {
      await this.persist();
    } catch (error) {
      this.value.state = "error";
      if (this.value.errors.length < 20)
        this.value.errors.push(`設定・控えの保存に失敗しました: ${message(error)}`);
    }
    return this.status();
  }
}
