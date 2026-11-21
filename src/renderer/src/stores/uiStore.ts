import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";
export type ToastMark = "adopt" | "dismiss";

/**
 * 取り消せる操作のトースト添え字。
 * 削除の復元と同じ位置に出し、同じ操作を二重に実行しないよう1件だけ持つ。
 */
export interface ToastUndo {
  label: string;
  run(): void | Promise<void>;
}

interface UiState {
  route: string;
  activeThemeId: string;
  themeMode: "light" | "dark";
  activeGroups: string[];
  toast: string;
  toastTone: ToastTone;
  toastUndo: ToastUndo | null;
  /**
   * 提案を決めた帯の印（#774）。採った＝チェックの判、見送った＝灰の横棒。印のある帯は 5 秒で
   * 尽きる線を持ち、5 秒で閉じる（決定はその 5 秒だけ端末に持たれ、取り消せる）。
   */
  toastMark: ToastMark | null;
  /** 帯を出すたびに増える。同じ文の帯でも線を始めからにする。 */
  toastKey: number;
  setRoute(route: string): void;
  setActiveThemeId(id: string): void;
  setThemeMode(mode: "light" | "dark"): void;
  setActiveGroups(groups: string[]): void;
  setToast(
    message: string,
    tone?: ToastTone,
    undo?: ToastUndo | null,
    mark?: ToastMark | null,
  ): void;
}

export const useUiStore = create<UiState>((set) => ({
  route: location.hash.slice(1) || "today",
  activeThemeId: "",
  themeMode: "light",
  activeGroups: [],
  toast: "",
  toastTone: "info",
  toastUndo: null,
  toastMark: null,
  toastKey: 0,
  setRoute: (route) => set({ route }),
  setActiveThemeId: (activeThemeId) => set({ activeThemeId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setActiveGroups: (activeGroups) => set({ activeGroups }),
  setToast: (toast, toastTone = "info", toastUndo = null, toastMark = null) =>
    set((state) => ({ toast, toastTone, toastUndo, toastMark, toastKey: state.toastKey + 1 })),
}));
