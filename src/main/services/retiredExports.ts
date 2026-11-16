import { runKnowledgeRetirementExportOnce } from "./knowledgeRetirementExport";
import { runSavedViewRetirementExportOnce } from "./savedViewRetirementExport";
import { runTranscriptionRetirementExportOnce } from "./transcriptionRetirementExport";
import { runWaitingRetirementExportOnce } from "./waitingRetirementExport";

/**
 * 切った機能の記録を、切った版の最初の起動で Markdown に書き出す控え（#755 の決まり 4）を、まとめて流す。
 * Knowledge の節と線（束 8）、完了済みの文字起こし（束 4）、保存した絞り込み（束 6）、待ち（束 7）。
 * 置き場・印・やり直しの扱いはそれぞれの書き出しが持つ。ここは起動の口を 1 つにするだけで、
 * Main の composition root（src/main/index.ts）に束ごとの import と配線を増やさないために置く。
 * 1 つが例外で止まっても残りは流す（どれも本人の記録を残すための物なので、互いを巻き込まない）。
 */
type RetiredExportRepository = Parameters<
  typeof runKnowledgeRetirementExportOnce
>[0]["repository"] &
  Parameters<typeof runTranscriptionRetirementExportOnce>[0]["repository"] &
  Parameters<typeof runSavedViewRetirementExportOnce>[0]["repository"] &
  Parameters<typeof runWaitingRetirementExportOnce>[0]["repository"];

export function runRetiredExportsOnce(input: {
  repository: RetiredExportRepository;
  userDataDirectory: string;
  syncRoot: string | null;
  log: (level: "info" | "warn", message: string) => void;
}): void {
  const runners = [
    ["knowledge", runKnowledgeRetirementExportOnce],
    ["transcriptions", runTranscriptionRetirementExportOnce],
    ["views", runSavedViewRetirementExportOnce],
    ["waitings", runWaitingRetirementExportOnce],
  ] as const;
  for (const [name, run] of runners) {
    try {
      run(input);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as { code?: unknown }).code)
          : "unexpected";
      input.log("warn", `retired export ${name} failed code=${code}`);
    }
  }
}
