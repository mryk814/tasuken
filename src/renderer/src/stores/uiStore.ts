import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";

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
  inboxRecorderRequested: boolean;
  toast: string;
  toastTone: ToastTone;
  toastUndo: ToastUndo | null;
  requestInboxRecorder(): void;
  consumeInboxRecorderRequest(): void;
  setRoute(route: string): void;
  setActiveThemeId(id: string): void;
  setThemeMode(mode: "light" | "dark"): void;
  setActiveGroups(groups: string[]): void;
  setToast(message: string, tone?: ToastTone, undo?: ToastUndo | null): void;
}

export const useUiStore = create<UiState>((set) => ({
  route: location.hash.slice(1) || "today",
  activeThemeId: "",
  themeMode: "light",
  activeGroups: [],
  inboxRecorderRequested: false,
  toast: "",
  toastTone: "info",
  toastUndo: null,
  setRoute: (route) => set({ route }),
  setActiveThemeId: (activeThemeId) => set({ activeThemeId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setActiveGroups: (activeGroups) => set({ activeGroups }),
  requestInboxRecorder: () => set({ inboxRecorderRequested: true }),
  consumeInboxRecorderRequest: () => set({ inboxRecorderRequested: false }),
  setToast: (toast, toastTone = "info", toastUndo = null) => set({ toast, toastTone, toastUndo }),
}));
