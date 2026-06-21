import { create } from "zustand";

interface UiState {
  route: string;
  activeThemeId: string;
  themeMode: "light" | "dark";
  activeGroups: string[];
  toast: string;
  setRoute(route: string): void;
  setActiveThemeId(id: string): void;
  setThemeMode(mode: "light" | "dark"): void;
  setActiveGroups(groups: string[]): void;
  setToast(message: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  route: location.hash.slice(1) || "home",
  activeThemeId: "",
  themeMode: "light",
  activeGroups: [],
  toast: "",
  setRoute: (route) => set({ route }),
  setActiveThemeId: (activeThemeId) => set({ activeThemeId }),
  setThemeMode: (themeMode) => set({ themeMode }),
  setActiveGroups: (activeGroups) => set({ activeGroups }),
  setToast: (toast) => set({ toast }),
}));
