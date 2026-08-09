import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";
export type InboxLane = "untriaged" | "processed" | "micro";

interface UiState {
  route: string;
  activeThemeId: string;
  themeMode: "light" | "dark";
  activeGroups: string[];
  /** Inboxのレーン選択。上部バーのMemoランチャーから開いたときに合わせる（#299）。 */
  inboxLane: InboxLane;
  inboxRecorderRequested: boolean;
  toast: string;
  toastTone: ToastTone;
  setInboxLane(lane: InboxLane): void;
  requestInboxRecorder(): void;
  consumeInboxRecorderRequest(): void;
  setRoute(route: string): void;
  setActiveThemeId(id: string): void;
  setThemeMode(mode: "light" | "dark"): void;
  setActiveGroups(groups: string[]): void;
  setToast(message: string, tone?: ToastTone): void;
}

export const useUiStore = create<UiState>((set) => ({
  route: location.hash.slice(1) || "today",
  activeThemeId: "",
  themeMode: "light",
  activeGroups: [],
  inboxLane: "untriaged",
  inboxRecorderRequested: false,
  toast: "",
  toastTone: "info",
  setRoute: (route) => set({ route }),
  setActiveThemeId: (activeThemeId) => set({ activeThemeId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setActiveGroups: (activeGroups) => set({ activeGroups }),
  setInboxLane: (inboxLane) => set({ inboxLane }),
  requestInboxRecorder: () => set({ inboxRecorderRequested: true }),
  consumeInboxRecorderRequest: () => set({ inboxRecorderRequested: false }),
  setToast: (toast, toastTone = "info") => set({ toast, toastTone }),
}));
