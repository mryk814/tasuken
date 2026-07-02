import { create } from "zustand";

export type ToastTone = "info" | "success" | "warning" | "danger";

interface UiState {
  route: string;
  activeThemeId: string;
  themeMode: "light" | "dark";
  activeGroups: string[];
  toast: string;
  toastTone: ToastTone;
  setRoute(route: string): void;
  setActiveThemeId(id: string): void;
  setThemeMode(mode: "light" | "dark"): void;
  setActiveGroups(groups: string[]): void;
  setToast(message: string, tone?: ToastTone): void;
}

export const useUiStore = create<UiState>((set) => ({
  route: location.hash.slice(1) || "theme",
  activeThemeId: "",
  themeMode: "light",
  activeGroups: [],
  toast: "",
  toastTone: "info",
  setRoute: (route) => set({ route }),
  setActiveThemeId: (activeThemeId) => set({ activeThemeId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setActiveGroups: (activeGroups) => set({ activeGroups }),
  setToast: (toast, toastTone = "info") => set({ toast, toastTone }),
}));
