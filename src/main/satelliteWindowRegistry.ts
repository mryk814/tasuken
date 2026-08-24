import { BrowserWindow, screen } from "electron";

import {
  clampBoundsToDisplays,
  createSatelliteWindowStateStore,
  normalizeBounds,
  satelliteWindowKeyOf,
  type SatelliteWindowKey,
  type SatelliteWindowKind,
  type SatelliteWindowStateStore,
  type WindowBounds,
} from "./satelliteWindowState";

/**
 * 本体から切り離したウィンドウを一箇所で管理する（#290 / #298）。
 *
 * 付箋Memoも切り離しNoteも、必要なことは同じ。
 *
 * - 同じEntityに二つ目のウィンドウを作らない（黙って別Editorを開かない）
 * - 既に開いていれば前面へ出す
 * - 位置・サイズを覚え、画面外へ復元しない
 * - Entity変更を開いている全ウィンドウへ配る
 * - どれが本体でどれが切り離しかを、windowの素性から判定できるようにする
 *
 * 最後の項目が重要で、index.ts の findMainWindow は「既知の補助ウィンドウ以外」を
 * 本体とみなしている。補助ウィンドウを増やすたびに除外条件を書き足すのは壊れやすいので、
 * 登録済みかどうかをこのregistryへ問い合わせる形にする。
 */

export interface SatelliteWindowSpec {
  /** ウィンドウのタイトル。Entityのタイトルを渡す。 */
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  /** レンダラのエントリ（例: "memo-sticky"）。dev/本番のどちらでも同じ名前で解決する。 */
  page: string;
  /** ページへ渡すクエリ。本体と同じindexを別モードで開くときに使う（#290）。 */
  query?: Record<string, string>;
  preload: string;
  backgroundColor?: string;
  transparent?: boolean;
  hasShadow?: boolean;
  alwaysOnTop?: boolean;
  frame?: boolean;
  skipTaskbar?: boolean;
}

export interface SatelliteWindowInfo extends SatelliteWindowKey {
  title: string;
  focused: boolean;
  visible: boolean;
  alwaysOnTop: boolean;
}

export interface SatelliteWindowRegistry {
  open: (key: SatelliteWindowKey, spec: SatelliteWindowSpec) => BrowserWindow;
  focus: (key: SatelliteWindowKey) => boolean;
  hide: (key: SatelliteWindowKey) => boolean;
  close: (key: SatelliteWindowKey) => boolean;
  get: (key: SatelliteWindowKey) => BrowserWindow | null;
  isOpen: (key: SatelliteWindowKey) => boolean;
  /** windowから逆引きする。IPCハンドラが「どのEntityの窓から来たか」を知るために使う。 */
  keyOf: (window: BrowserWindow) => SatelliteWindowKey | null;
  /** 本体ウィンドウ判定のための所属確認。 */
  has: (window: BrowserWindow) => boolean;
  /** Top Barが表示状態を読むためのRegistry投影（#327）。 */
  list: (kind?: SatelliteWindowKind) => SatelliteWindowInfo[];
  /** 複数の補助窓を、保存位置を尊重しながら初回・重複・画面外だけ安全に並べる。 */
  arrange: (keys: SatelliteWindowKey[]) => number;
  /** 開いている切り離しウィンドウへ一斉送信する。 */
  broadcast: (channel: string, payload?: unknown) => void;
  /** 特定Entityの窓だけへ送る。 */
  send: (key: SatelliteWindowKey, channel: string, payload?: unknown) => boolean;
  closeAll: () => void;
}

interface RegistryOptions {
  /** 位置・サイズを書くJSONのパス。userData配下を想定する。 */
  stateFilePath: string;
  getAppIconPath: () => string;
  resolvePageUrl: (page: string) => { url: string } | { file: string };
  /** 開閉が変わったとき。本体側の「開いている一覧」を追従させるために使う。 */
  onChanged?: () => void;
}

interface Entry {
  key: SatelliteWindowKey;
  window: BrowserWindow;
  title: string;
  restoredFromState: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
}

const SAVE_BOUNDS_DEBOUNCE_MS = 400;

export function createSatelliteWindowRegistry(options: RegistryOptions): SatelliteWindowRegistry {
  const entries = new Map<string, Entry>();
  const store: SatelliteWindowStateStore = createSatelliteWindowStateStore(options.stateFilePath);

  function displays() {
    return screen.getAllDisplays().map((display) => display.workArea);
  }

  /** 保存済みの位置を、いまの画面構成に合わせて補正して返す。無ければ既定サイズ。 */
  function restoreBounds(
    key: SatelliteWindowKey,
    spec: SatelliteWindowSpec,
  ): { bounds: Partial<WindowBounds>; restoredFromState: boolean } {
    const saved = store.read(key);
    if (!saved)
      return { bounds: { width: spec.width, height: spec.height }, restoredFromState: false };
    return {
      bounds: clampBoundsToDisplays(saved, displays(), {
        minWidth: spec.minWidth,
        minHeight: spec.minHeight,
      }),
      restoredFromState: true,
    };
  }

  function scheduleSaveBounds(entry: Entry): void {
    if (entry.saveTimer) clearTimeout(entry.saveTimer);
    entry.saveTimer = setTimeout(() => {
      entry.saveTimer = null;
      if (entry.window.isDestroyed() || entry.window.isMinimized()) return;
      const bounds = normalizeBounds(entry.window.getBounds());
      if (bounds) store.write(entry.key, bounds);
    }, SAVE_BOUNDS_DEBOUNCE_MS);
  }

  function reveal(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    const wasVisible = window.isVisible();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (!wasVisible && window.isVisible()) options.onChanged?.();
  }

  function createWindow(key: SatelliteWindowKey, spec: SatelliteWindowSpec): BrowserWindow {
    const restored = restoreBounds(key, spec);
    const window = new BrowserWindow({
      ...restored.bounds,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      show: false,
      title: spec.title,
      icon: options.getAppIconPath(),
      frame: spec.frame ?? true,
      resizable: true,
      skipTaskbar: spec.skipTaskbar ?? false,
      alwaysOnTop: spec.alwaysOnTop ?? false,
      autoHideMenuBar: true,
      transparent: spec.transparent ?? false,
      hasShadow: spec.hasShadow ?? true,
      backgroundColor: spec.backgroundColor ?? (spec.transparent ? "#00000000" : "#F4EEEC"),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: spec.preload,
      },
    });

    const target = options.resolvePageUrl(spec.page);
    const search = spec.query ? new URLSearchParams(spec.query).toString() : "";
    if ("url" in target) void window.loadURL(search ? `${target.url}?${search}` : target.url);
    else void window.loadFile(target.file, search ? { search } : undefined);

    const entry: Entry = {
      key,
      window,
      title: spec.title,
      restoredFromState: restored.restoredFromState,
      saveTimer: null,
    };
    entries.set(satelliteWindowKeyOf(key), entry);
    options.onChanged?.();

    window.once("ready-to-show", () => reveal(window));
    window.on("move", () => scheduleSaveBounds(entry));
    window.on("resize", () => scheduleSaveBounds(entry));
    // 最小化／復元もB（表示状態）の変化として本体へ通知する。
    window.on("minimize", () => options.onChanged?.());
    window.on("restore", () => options.onChanged?.());
    window.on("close", () => {
      // 閉じる直前の位置は debounce を待たずに確定させる。
      if (entry.saveTimer) clearTimeout(entry.saveTimer);
      entry.saveTimer = null;
      if (!window.isDestroyed() && !window.isMinimized()) {
        const closing = normalizeBounds(window.getBounds());
        if (closing) store.write(key, closing);
      }
    });
    window.on("closed", () => {
      const current = entries.get(satelliteWindowKeyOf(key));
      if (current?.window === window) entries.delete(satelliteWindowKeyOf(key));
      options.onChanged?.();
    });
    return window;
  }

  function get(key: SatelliteWindowKey): BrowserWindow | null {
    const entry = entries.get(satelliteWindowKeyOf(key));
    if (!entry) return null;
    if (entry.window.isDestroyed()) {
      entries.delete(satelliteWindowKeyOf(key));
      return null;
    }
    return entry.window;
  }

  function overlaps(a: WindowBounds, b: WindowBounds): boolean {
    return (
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    );
  }

  function sameBounds(a: WindowBounds, b: WindowBounds): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  function arrange(keys: SatelliteWindowKey[]): number {
    const wanted = [...new Map(keys.map((key) => [satelliteWindowKeyOf(key), key])).values()]
      .map((key) => entries.get(satelliteWindowKeyOf(key)))
      .filter((entry): entry is Entry => entry !== undefined && !entry.window.isDestroyed());
    if (!wanted.length) return 0;

    const areas = displays();
    if (!areas.length) return 0;
    const occupied: WindowBounds[] = [];
    for (const entry of entries.values()) {
      if (wanted.includes(entry) || entry.window.isDestroyed() || !entry.window.isVisible())
        continue;
      const bounds = normalizeBounds(entry.window.getBounds());
      if (bounds) occupied.push(bounds);
    }
    let changed = 0;
    for (const entry of wanted) {
      const current = normalizeBounds(entry.window.getBounds());
      if (!current) continue;
      const clamped = clampBoundsToDisplays(current, areas, { minWidth: 1, minHeight: 1 });
      const initialPlacement = !entry.restoredFromState;
      const needsPlacement =
        initialPlacement ||
        !sameBounds(current, clamped) ||
        occupied.some((other) => overlaps(current, other));
      let next = current;
      if (needsPlacement) {
        const candidates = areas.flatMap((area) => {
          const maxX = Math.max(area.x, area.x + area.width - current.width);
          const maxY = Math.max(area.y, area.y + area.height - current.height);
          const result: WindowBounds[] = [];
          for (let y = area.y + 16; y <= maxY; y += current.height + 16) {
            for (let x = area.x + 16; x <= maxX; x += current.width + 16) {
              result.push({ ...current, x, y });
            }
          }
          return result;
        });
        next =
          candidates.find((candidate) => !occupied.some((other) => overlaps(candidate, other))) ||
          clampBoundsToDisplays(current, areas, { minWidth: 1, minHeight: 1 });
      }
      if (!sameBounds(current, next)) {
        entry.window.setBounds(next, false);
        store.write(entry.key, next);
        changed += 1;
      } else if (initialPlacement) {
        store.write(entry.key, next);
      }
      entry.restoredFromState = true;
      occupied.push(next);
    }
    return changed;
  }

  return {
    open(key, spec) {
      // 同じEntityは二度開かない。既にあれば前面へ出すだけにして、
      // 同一データを別Editorで同時に編集させない（#290）。
      const existing = get(key);
      if (existing) {
        const entry = entries.get(satelliteWindowKeyOf(key));
        if (entry && entry.title !== spec.title) {
          entry.title = spec.title;
          existing.setTitle(spec.title);
        }
        reveal(existing);
        return existing;
      }
      return createWindow(key, spec);
    },
    focus(key) {
      const window = get(key);
      if (!window) return false;
      reveal(window);
      return true;
    },
    hide(key) {
      const window = get(key);
      if (!window) return false;
      const wasVisible = window.isVisible();
      window.hide();
      if (wasVisible && !window.isVisible()) options.onChanged?.();
      return true;
    },
    close(key) {
      const window = get(key);
      if (!window) return false;
      window.close();
      return true;
    },
    get,
    isOpen: (key) => get(key) != null,
    keyOf(window) {
      for (const entry of entries.values()) {
        if (entry.window === window) return entry.key;
      }
      return null;
    },
    has(window) {
      for (const entry of entries.values()) {
        if (entry.window === window) return true;
      }
      return false;
    },
    list(kind) {
      const result: SatelliteWindowInfo[] = [];
      for (const entry of entries.values()) {
        if (entry.window.isDestroyed()) continue;
        if (kind && entry.key.kind !== kind) continue;
        result.push({
          ...entry.key,
          title: entry.title,
          focused: entry.window.isFocused(),
          visible: entry.window.isVisible(),
          alwaysOnTop: entry.window.isAlwaysOnTop(),
        });
      }
      return result.sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, "ja"),
      );
    },
    arrange,
    broadcast(channel, payload) {
      for (const entry of entries.values()) {
        if (entry.window.isDestroyed() || entry.window.webContents.isLoading()) continue;
        entry.window.webContents.send(channel, payload);
      }
    },
    send(key, channel, payload) {
      const window = get(key);
      if (!window || window.webContents.isLoading()) return false;
      window.webContents.send(channel, payload);
      return true;
    },
    closeAll() {
      for (const entry of [...entries.values()]) {
        if (!entry.window.isDestroyed()) entry.window.close();
      }
    },
  };
}
