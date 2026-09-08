import {
  createDailyContextAutoState,
  validateDailyContextAutoConfig,
  type DailyContextAutoConfig,
  type DailyContextAutoState,
  type DailyContextFreshness,
  type DailyContextAutoStatus,
} from "../../shared/dailyContextAuto";

export interface DailyContextAutoPublisherOptions {
  readState(): DailyContextAutoState | null;
  writeState(state: DailyContextAutoState): void;
  scan(state: DailyContextAutoState):
    | Promise<
        Pick<DailyContextAutoState, "sourceHashes" | "checkedThrough" | "deviceObservations"> & {
          dates: string[];
          priorityDate?: string | null;
        }
      >
    | (Pick<DailyContextAutoState, "sourceHashes" | "checkedThrough" | "deviceObservations"> & {
        dates: string[];
        priorityDate?: string | null;
      });
  publish(
    date: string,
    config: DailyContextAutoConfig,
    freshness: DailyContextFreshness,
  ):
    | Promise<{ written: boolean; generatedAt: string; sourceRevision: string }>
    | { written: boolean; generatedAt: string; sourceRevision: string };
  now?(): Date;
  setTimer?(callback: () => void, delay: number): unknown;
  clearTimer?(timer: unknown): void;
  onError?(message: string): void;
}

export class DailyContextAutoPublisher {
  private state: DailyContextAutoState;
  private running = false;
  private busy = false;
  private generation = 0;
  private timer: unknown = null;
  private readonly now: () => Date;
  constructor(private readonly options: DailyContextAutoPublisherOptions) {
    this.state = structuredClone(options.readState() ?? createDailyContextAutoState());
    this.now = options.now ?? (() => new Date());
  }
  private save(): void {
    this.options.writeState(structuredClone(this.state));
  }
  private schedule(): void {
    if (!this.running || this.busy || this.timer !== null || !this.state.config.enabled) return;
    // A periodic scan also detects a new local day without an input event.
    const delay = this.state.retryAt
      ? Math.max(250, Date.parse(this.state.retryAt) - this.now().getTime())
      : this.state.needsScan || this.state.pendingDates.length
        ? 250
        : 60_000;
    this.timer = (this.options.setTimer ?? ((callback, ms) => setTimeout(callback, ms)))(() => {
      this.timer = null;
      if (!this.state.pendingDates.length && !this.state.needsScan) {
        this.state.needsScan = true;
      }
      void this.runOnce()
        .catch(() => {
          const message = "自動公開の更新待ち状態を保存できませんでした。";
          (this.options.onError ?? console.warn)(message);
        })
        .finally(() => this.schedule());
    }, delay);
  }
  private cancelTimer(): void {
    if (this.timer !== null)
      (
        this.options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
      )(this.timer);
    this.timer = null;
  }
  start(): void {
    if (this.running) return;
    this.running = true;
    this.wake();
  }
  stop(): void {
    this.running = false;
    this.generation++;
    this.cancelTimer();
  }
  wake(): void {
    this.generation++;
    this.state.needsScan = true;
    this.save();
    this.cancelTimer();
    this.schedule();
  }
  retry(): void {
    this.state.retryAt = null;
    this.wake();
  }
  configure(value: DailyContextAutoConfig): void {
    const config = validateDailyContextAutoConfig(value);
    if (JSON.stringify(config) === JSON.stringify(this.state.config)) return;
    const previous = this.state.config;
    const onlyEnabled =
      JSON.stringify({ ...previous, enabled: config.enabled }) === JSON.stringify(config);
    const sameRoot = previous.root === config.root && previous.timezone === config.timezone;
    this.generation++;
    this.state = {
      ...this.state,
      config,
      needsScan: true,
      retryAt: null,
      error: null,
      ...(!onlyEnabled ? { sourceHashes: {}, checkedThrough: null } : {}),
      ...(!sameRoot ? { pendingDates: [], lastWrittenAt: null, lastSourceRevision: null } : {}),
    };
    this.save();
    this.cancelTimer();
    this.schedule();
  }
  status(): DailyContextAutoStatus {
    return structuredClone({
      config: this.state.config,
      freshness: this.freshness(),
      error: this.state.error,
      retryAt: this.state.retryAt,
    });
  }
  private freshness(): DailyContextFreshness {
    return {
      observedAt: this.now().toISOString(),
      configuredFromDate: this.state.config.fromDate,
      publishedThrough:
        this.state.pendingDates.length || this.state.needsScan ? null : this.state.checkedThrough,
      lastLocalWrittenAt: this.state.lastWrittenAt,
      sourceRevision: this.state.lastSourceRevision,
      pendingCount: this.state.needsScan ? null : this.state.pendingDates.length,
      deviceObservations: this.state.deviceObservations,
    };
  }
  async runOnce(): Promise<void> {
    if (
      this.busy ||
      !this.state.config.enabled ||
      (this.state.retryAt && Date.parse(this.state.retryAt) > this.now().getTime())
    )
      return;
    this.busy = true;
    const generation = this.generation;
    try {
      if (this.state.needsScan) {
        const scanned = await this.options.scan(structuredClone(this.state));
        if (generation !== this.generation || !this.state.config.enabled) return;
        this.state = {
          ...this.state,
          sourceHashes: scanned.sourceHashes,
          checkedThrough: scanned.checkedThrough,
          deviceObservations: scanned.deviceObservations,
          pendingDates: [...new Set([...this.state.pendingDates, ...scanned.dates])].sort(),
          needsScan: false,
        };
        if (scanned.priorityDate && this.state.pendingDates.includes(scanned.priorityDate)) {
          this.state.pendingDates = [
            scanned.priorityDate,
            ...this.state.pendingDates.filter((date) => date !== scanned.priorityDate),
          ];
        }
        this.save();
      }
      const date = this.state.pendingDates[0];
      if (!date) {
        this.state.error = null;
        this.state.retryAt = null;
        this.save();
        return;
      }
      const result = await this.options.publish(date, { ...this.state.config }, this.freshness());
      if (generation !== this.generation) return;
      this.state.pendingDates = this.state.pendingDates.filter((pending) => pending !== date);
      if (result.written) this.state.lastWrittenAt = result.generatedAt;
      this.state.lastSourceRevision = result.sourceRevision;
      this.state.error = null;
      this.state.retryAt = null;
      this.save();
    } catch {
      if (generation !== this.generation) return;
      // Error messages may contain canonical text or local paths; retain only a public failure label.
      this.state.error = "自動公開を完了できませんでした。保存先を確認して再試行してください。";
      this.state.retryAt = new Date(this.now().getTime() + 30_000).toISOString();
      this.save();
    } finally {
      this.busy = false;
      this.schedule();
    }
  }
}
