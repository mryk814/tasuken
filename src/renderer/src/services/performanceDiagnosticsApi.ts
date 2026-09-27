import type { RendererPerformanceReport } from "../../../shared/ipc/contracts";

// 補助ウィンドウのpreloadには app API が無い。診断は無ければ何もしない。
function appApi() {
  return window.api?.app;
}

export const performanceDiagnosticsApi = {
  async enabled(): Promise<boolean> {
    return (await appApi()?.performanceDiagnosticsEnabled?.()) === true;
  },
  report(report: RendererPerformanceReport): void {
    appApi()?.reportPerformance?.(report);
  },
};
