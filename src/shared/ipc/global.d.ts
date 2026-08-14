import type { ResearchDeskApi, TodayMiniAddTaskRequest, TodayMiniTask, TodayMiniThemeOption } from "./contracts";

interface TodayMiniApi {
  list(): Promise<TodayMiniTask[]>;
  listThemes(): Promise<TodayMiniThemeOption[]>;
  addTask(request: TodayMiniAddTaskRequest): Promise<TodayMiniTask[]>;
  toggle(taskId: string): Promise<TodayMiniTask[]>;
  openTask(taskId: string): Promise<boolean>;
  pinTopRight(): Promise<boolean>;
  hide(): Promise<boolean>;
  refresh(): Promise<TodayMiniTask[]>;
  onRefresh(callback: () => void): () => void;
  onThemeChange(callback: (mode: "light" | "dark") => void): () => void;
}

declare global {
  interface Window {
    api: ResearchDeskApi;
    researchDesk: ResearchDeskApi;
    todayMiniApi: TodayMiniApi;
  }
}

export {};
