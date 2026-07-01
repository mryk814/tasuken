import type { ResearchDeskApi, TodayMiniTask } from "./contracts";

interface TodayMiniApi {
  list(): Promise<TodayMiniTask[]>;
  toggle(taskId: string): Promise<TodayMiniTask[]>;
  openTask(taskId: string): Promise<boolean>;
  refresh(): Promise<TodayMiniTask[]>;
  onRefresh(callback: () => void): () => void;
}

declare global {
  interface Window {
    api: ResearchDeskApi;
    researchDesk: ResearchDeskApi;
    todayMiniApi: TodayMiniApi;
  }
}

export {};
