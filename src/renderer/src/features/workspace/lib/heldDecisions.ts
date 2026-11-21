/**
 * 採る・見送るを、押してから 5 秒だけ端末に持っておき、押した順に 1 件ずつ送る列（#774）。
 *
 * 押した瞬間に端末へ書き（storage）、帯の「取り消す」が出ている 5 秒の間は送らない。取り消せば
 * 列から消えるだけで、Core には何も届かない。5 秒たったものから、押した順に 1 件ずつ送る。
 * 採否を Core で取り消す道は無い（採ると Task・Note・日程などを作り・変える）ので、取り消しは
 * 「送る前に止める」で行う。
 *
 * - 送るのは 1 件ずつ。前の 1 件の答えが来るまで次を送らない（押した順に届く）。
 * - 断られた 1 件は列から外して `onRefused` で知らせ、残りは続けて送る。黙って捨てない。
 * - 時間の上限を越えた 1 件は、捨てずに列の後ろへ回して後で送り直す（後ろの物を止めないため）。
 *   送る物は押した時に作った command そのもので、同じ commandId の再送は Core が前の答えを返す。
 * - 端末に残っていた物（5 秒の間に窓を閉じた等）は、次に `start` した時にすぐ送る。
 *
 * DOM にも Electron にも触れない（試験は node で流す。tests/held-decisions.test.mjs）。
 */
export interface HeldItem {
  id: string;
  /** 押した時刻（ms）。これに holdMs を足した時刻から送ってよい。 */
  pressedAt: number;
}

export interface HeldStorage<T> {
  read(): T[];
  write(items: readonly T[]): void;
}

type Timer = unknown;

export interface HeldQueueOptions<T extends HeldItem> {
  storage: HeldStorage<T>;
  /** 1 件を送る。断られたら throw する。 */
  send(item: T): Promise<void>;
  onSent?(item: T): void;
  /** 断られた。`error` は send が投げた物そのもの。 */
  onRefused?(item: T, message: string, error: unknown): void;
  /** 時間の上限を越えた。列の後ろで送り直す。 */
  onDelayed?(item: T): void;
  onChange?(items: readonly T[]): void;
  holdMs?: number;
  timeoutMs?: number;
  /** 時間切れの 1 件を送り直すまでの間。 */
  retryMs?: number;
  now?(): number;
  setTimer?(run: () => void, ms: number): Timer;
  clearTimer?(timer: Timer): void;
}

export interface HeldQueue<T extends HeldItem> {
  /** 押した 1 件を端末に書き、5 秒後に送る列に入れる。 */
  hold(item: T): void;
  /** まだ送り始めていなければ列から外す（何も送らない）。外せたら true。 */
  cancel(id: string): boolean;
  /** 端末に残っていた物を読み、すぐ送る。 */
  start(): void;
  items(): readonly T[];
  /** 送っている最中の 1 件の ID。 */
  sending(): string | null;
}

export const DECISION_HOLD_MS = 5_000;
export const DECISION_TIMEOUT_MS = 20_000;
const DECISION_RETRY_MS = 30_000;

const TIMED_OUT = Symbol("timed-out");

export function createHeldQueue<T extends HeldItem>(options: HeldQueueOptions<T>): HeldQueue<T> {
  const holdMs = options.holdMs ?? DECISION_HOLD_MS;
  const timeoutMs = options.timeoutMs ?? DECISION_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DECISION_RETRY_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let entries: Array<{ item: T; due: number }> = [];
  let inFlight: string | null = null;
  let timer: Timer | null = null;

  function persist() {
    const items = entries.map((entry) => entry.item);
    options.storage.write(items);
    options.onChange?.(items);
  }

  function remove(id: string) {
    entries = entries.filter((entry) => entry.item.id !== id);
    persist();
  }

  function schedule(ms: number) {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(
      () => {
        timer = null;
        pump();
      },
      Math.max(0, ms),
    );
  }

  function pump() {
    if (inFlight !== null || !entries.length) return;
    const head = entries[0];
    const wait = head.due - now();
    if (wait > 0) {
      schedule(wait);
      return;
    }
    inFlight = head.item.id;
    let expire: Timer | null = null;
    const limit = new Promise<typeof TIMED_OUT>((resolve) => {
      expire = setTimer(() => resolve(TIMED_OUT), timeoutMs);
    });
    const sent = Promise.resolve()
      .then(() => options.send(head.item))
      .then(() => null);
    // 時間切れの後に来た答えは使わない（送り直しが同じ答えを受け取る）。
    sent.catch(() => {});
    void Promise.race([sent, limit])
      .then(
        (outcome) => {
          if (outcome === TIMED_OUT) {
            // 捨てずに後ろへ回す。後ろの物は先に送る。
            entries = [
              ...entries.filter((entry) => entry.item.id !== head.item.id),
              { item: head.item, due: now() + retryMs },
            ];
            persist();
            options.onDelayed?.(head.item);
            return;
          }
          remove(head.item.id);
          options.onSent?.(head.item);
        },
        (error: unknown) => {
          remove(head.item.id);
          options.onRefused?.(
            head.item,
            error instanceof Error ? error.message : String(error),
            error,
          );
        },
      )
      .finally(() => {
        if (expire !== null) clearTimer(expire);
        inFlight = null;
        pump();
      });
  }

  return {
    hold(item) {
      entries = [
        ...entries.filter((entry) => entry.item.id !== item.id),
        { item, due: item.pressedAt + holdMs },
      ];
      persist();
      pump();
    },
    cancel(id) {
      if (inFlight === id || !entries.some((entry) => entry.item.id === id)) return false;
      remove(id);
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      pump();
      return true;
    },
    start() {
      const stored = ((): T[] => {
        try {
          return options.storage.read();
        } catch {
          // 壊れた中身は読まない（その起動で押した物は持てる）。
          return [];
        }
      })();
      const known = new Set(entries.map((entry) => entry.item.id));
      const at = now();
      // 前の起動の残りは、帯が無いので待たずに送る。押した順は保つ。
      const leftovers = stored
        .filter((item) => item && typeof item.id === "string" && !known.has(item.id))
        .sort((left, right) => left.pressedAt - right.pressedAt)
        .map((item) => ({ item, due: at }));
      if (leftovers.length) {
        entries = [...leftovers, ...entries];
        persist();
      }
      pump();
    },
    items: () => entries.map((entry) => entry.item),
    sending: () => inFlight,
  };
}
