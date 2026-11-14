import type { ResearchDeskApi } from "./contracts";

declare global {
  interface Window {
    api: ResearchDeskApi;
    researchDesk: Omit<ResearchDeskApi, "mobileGateway">;
  }
}

export {};
