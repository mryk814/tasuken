import { useSyncExternalStore } from "react";

import { todayIso } from "../../../utils/dataFormat.js";

/**
 * 利用者のローカル日付を画面へ配る（#685）。
 *
 * Taskenは閉じずに何日も使われるため、render時に一度だけ `todayIso()` を読むと
 * 0時を跨いでもTodayやSidebarが前日のまま残る。日付を扱う画面はここを購読し、
 * 日付が変わったときだけ再描画する。
 *
 * 0時ぴったりのtimerだけに頼らない。スリープ中はtimerが走らず、時計変更もあるため、
 * 低頻度の確認に加えて focus / visibilitychange / pageshow で即座に照合する。
 * 日付が同じなら購読者へ通知しない。
 */
export const LOCAL_DATE_CHECK_INTERVAL_MS = 60_000;

type Listener = () => void;

interface LocalDateEnvironment {
  now: () => Date;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** 前面復帰の合図。購読を外す関数を返す。 */
  subscribeWake: (callback: () => void) => () => void;
}

export interface LocalDateStore {
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => string;
  /** 現在の日付を読み直し、変わっていれば通知する。変わったかを返す。 */
  check: () => boolean;
}

export function createLocalDateStore(environment: LocalDateEnvironment): LocalDateStore {
  const listeners = new Set<Listener>();
  let current = todayIso(environment.now());
  let intervalHandle: unknown = null;
  let unsubscribeWake: (() => void) | null = null;

  function check(): boolean {
    const next = todayIso(environment.now());
    if (next === current) return false;
    current = next;
    for (const listener of [...listeners]) listener();
    return true;
  }

  function start(): void {
    intervalHandle = environment.setInterval(check, LOCAL_DATE_CHECK_INTERVAL_MS);
    unsubscribeWake = environment.subscribeWake(check);
  }

  function stop(): void {
    if (intervalHandle !== null) environment.clearInterval(intervalHandle);
    intervalHandle = null;
    unsubscribeWake?.();
    unsubscribeWake = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        // 購読者がいない間に日付が変わっていても、最初の購読で追いつく。
        check();
        start();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot() {
      // 描き直すたびに時計を読む。0時を跨いだ直後の操作（「やったことを記録」を開くなど）で、
      // 60秒ごとの確認やfocusを待たずに当日を返す（前面のまま日付が変わると、どちらも来ない）。
      // current は「購読者へ通知済みの日付」。render中には通知せず、次の check が全員へ知らせる。
      const today = todayIso(environment.now());
      if (listeners.size === 0) current = today;
      return today;
    },
    check,
  };
}

function browserEnvironment(): LocalDateEnvironment {
  return {
    now: () => new Date(),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    subscribeWake(callback) {
      const onVisibility = () => {
        if (document.visibilityState === "visible") callback();
      };
      window.addEventListener("focus", callback);
      window.addEventListener("pageshow", callback);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("focus", callback);
        window.removeEventListener("pageshow", callback);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },
  };
}

let sharedStore: LocalDateStore | null = null;

function localDateStore(): LocalDateStore {
  sharedStore ??= createLocalDateStore(browserEnvironment());
  return sharedStore;
}

/** 今日のローカル日付（YYYY-MM-DD）。日付が変わると購読中の画面だけ再描画する。 */
export function useCurrentLocalDate(): string {
  const store = localDateStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
