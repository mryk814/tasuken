import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  createNativeAgentLogAccumulator,
  type ImportedAgentWorkLog,
} from "../../shared/agentWorkLogImport.ts";
import type {
  AgentLogProbe,
  AgentLogService,
  AgentLogSourceConfig,
  AgentLogSyncStatus,
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
  queued: 0,
  unchanged: 0,
  deferred: 0,
  errors: [],
});

export class AgentLogSync {
  private value = blank();
  private fingerprints: Record<string, string> = {};
  private running: Promise<AgentLogSyncStatus> | null = null;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly directory: string;
  private readonly submit: (
    log: ImportedAgentWorkLog,
    destination: string,
  ) => Promise<"queued" | "duplicate" | "deferred">;
  constructor(
    directory: string,
    submit: (
      log: ImportedAgentWorkLog,
      destination: string,
    ) => Promise<"queued" | "duplicate" | "deferred">,
  ) {
    this.directory = directory;
    this.submit = submit;
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
      this.fingerprints =
        stored.fingerprints && typeof stored.fingerprints === "object" ? stored.fingerprints : {};
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
    const keys = Object.keys(this.fingerprints);
    if (keys.length > 50000)
      for (const key of keys.slice(0, keys.length - 50000)) delete this.fingerprints[key];
    await fs.promises.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, "sources.json");
    await fs.promises.writeFile(
      file + ".tmp",
      JSON.stringify({
        sources: this.value.sources,
        background: this.value.background,
        fingerprints: this.fingerprints,
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
      message: "未同期",
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
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
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
    return files;
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
          ? "JSONL 候補。対応形式は同期時に確認します。"
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
  private async read(file: string, service: AgentLogService, signal: AbortSignal) {
    const accumulator = createNativeAgentLogAccumulator(service);
    const stream = fs.createReadStream(file, {
      encoding: "utf8",
      highWaterMark: 64 * 1024,
      signal,
    });
    let buffer = "";
    let bytes = 0;
    let incomplete = false;
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        bytes += Buffer.byteLength(chunk as string);
        if (bytes > 128 * 1024 * 1024) throw new Error("128MB の上限です。ログを絞ってください。");
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw new Error("1行8MBの上限です。");
          if (line.trim()) {
            let decoded;
            try {
              decoded = JSON.parse(line);
            } catch {
              throw new Error("JSONL に壊れた行があります。保存中か形式を確認してください。");
            }
            accumulator.add(decoded);
          }
        }
        if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) throw new Error("1行8MBの上限です。");
      }
      if (buffer.trim()) {
        let value;
        try {
          value = JSON.parse(buffer);
        } catch {
          incomplete = true;
        }
        if (!incomplete) accumulator.add(value);
      }
      return { log: accumulator.finish(), incomplete };
    } finally {
      stream.destroy();
    }
  }
  async run(): Promise<AgentLogSyncStatus> {
    await this.load();
    if (this.running) return this.running;
    this.running = this.scan().finally(() => {
      this.running = null;
      this.abort = null;
    });
    return this.running;
  }
  private async scan() {
    this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]);
    Object.assign(this.value, {
      state: "running",
      scanned: 0,
      queued: 0,
      unchanged: 0,
      deferred: 0,
      errors: [],
    });
    let bytes = 0;
    try {
      for (const source of this.value.sources) {
        let issues = 0;
        try {
          const files = await this.files(source.path, signal);
          for (const file of files) {
            signal.throwIfAborted();
            const key = digest(source.service + "\0" + file.file);
            const statKey = `${file.size}:${file.mtime}`;
            this.value.scanned++;
            if (this.fingerprints[key] === statKey) {
              this.value.unchanged++;
              continue;
            }
            if (file.size > 128 * 1024 * 1024) {
              issues++;
              source.message = "128MB の上限を超えるログがあります。";
              if (this.value.errors.length < 20)
                this.value.errors.push(
                  `${source.service} · ${path.basename(file.file)}: 128MB の上限です。`,
                );
              continue;
            }
            bytes += file.size;
            if (bytes > 512 * 1024 * 1024)
              throw new Error("1回512MBの上限です。次回同期で残りを読みます。");
            try {
              const { log, incomplete } = await this.read(file.file, source.service, signal);
              const contentKey = digest(
                `${source.service}\0${log.source_session}\0${log.started_at}`,
              );
              const contentDigest = digest(JSON.stringify(log));
              const result =
                this.fingerprints[contentKey] === contentDigest
                  ? "duplicate"
                  : await this.submit(log, source.destination);
              if (result === "queued") this.value.queued++;
              else if (result === "duplicate") this.value.unchanged++;
              if (result === "deferred" || incomplete) {
                this.value.deferred++;
                issues++;
                source.message = incomplete
                  ? "書き込み途中。次回に続きます。"
                  : "提案の採用待ち。変更は次回に続きます。";
              }
              if (result !== "deferred") this.fingerprints[contentKey] = contentDigest;
              const after = await fs.promises.stat(file.file);
              if (
                !incomplete &&
                result !== "deferred" &&
                after.size === file.size &&
                after.mtimeMs === file.mtime
              )
                this.fingerprints[key] = statKey;
              // Checkpoint in batches; rewriting a growing index for every small log is quadratic IO.
              if (this.value.scanned % 100 === 0) await this.persist();
            } catch (error) {
              signal.throwIfAborted();
              issues++;
              source.message = `読込できないログ: ${message(error)}`;
              if (this.value.errors.length < 20)
                this.value.errors.push(
                  `${source.service} · ${path.basename(file.file)}: ${message(error)}`,
                );
            }
          }
          if (!issues)
            source.message = files.length
              ? "同期済み（新規・変更だけを収集）"
              : "JSONL がありません。";
          source.lastScan = new Date().toISOString();
        } catch (error) {
          signal.throwIfAborted();
          source.message = locationMessage(error);
          if (this.value.errors.length < 20)
            this.value.errors.push(`${source.service}: ${locationMessage(error)}`);
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
        this.value.errors.push(`設定・差分の保存に失敗しました: ${message(error)}`);
    }
    return this.status();
  }
}
