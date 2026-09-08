import { z } from "zod";
import { mobileCaptureOrganizationTimedBatchSchema } from "../shared/contracts/mobile/public.ts";

const externalCaptureSchema = mobileCaptureOrganizationTimedBatchSchema.extend({
  schema: z.literal("tasken-task-drafts/v1"),
  originalText: z
    .string()
    .min(1)
    .max(12000)
    .refine((text) => Boolean(text.trim())),
});

export function parseExternalCaptureOrganization(text: unknown, themeIds: string[]) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > 256 * 1024)
    throw new Error("整理結果は256KiB以内のJSONを貼り付けてください。");
  const json = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(
      "JSONを読み取れませんでした。外部AIの整理結果を先頭から末尾まで貼り付けてください。",
    );
  }
  const parsed = externalCaptureSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "整理結果の形式・日付・文字数を確認してください。「依頼文をコピー」から作り直せます。入力は残っています。",
    );
  if (parsed.data.tasks.some((task) => task.themeId && !themeIds.includes(task.themeId)))
    throw new Error(
      "見つからないThemeが含まれています。依頼文をコピーし直すか、themeIdをnullにしてください。",
    );
  const { originalText, tasks, warnings } = parsed.data;
  return { originalText, organization: { tasks, warnings } };
}

export function buildExternalCapturePrompt(input: {
  text: string;
  theme: { id: string; name: string } | null;
  capturedAt: string;
  timeZone: string;
}) {
  const example = {
    schema: "tasken-task-drafts/v1",
    originalText: input.text || "整理の元になった入力をここに残す",
    tasks: [
      {
        title: "タスク名",
        themeId: input.theme?.id ?? null,
        startDate: null,
        endDate: null,
        plannedStartTime: null,
        plannedDurationMinutes: null,
        rangeSemantics: null,
        checklist: [],
        supplement: "",
        warnings: [],
      },
    ],
    warnings: [],
  };
  return `Taskenへ取り込むタスク案を、次のJSON形式だけで返してください。保存は利用者が確認して行います。
元の入力が空なら、この会話で利用者が依頼した作業を整理してください。完了した事実や依頼されていない作業は捏造しないでください。
独立した成果は1〜8件のTaskに分け、同じ成果への手順はchecklistへ（最大20件、各200文字）。titleは1〜500文字、supplementとoriginalTextは最大12000文字。
originalTextには元の入力を保持してください。補足・不確かな点はsupplementやwarningsへ。warningsは各500文字・最大10件です。
日付はYYYY-MM-DD、予定開始はHH:mm、所要時間は1〜10080分の整数。不明・未指定ならnull。終了日は開始日以降にしてください。
相対日はcapturedAtをtimeZoneへ変換した現地日付で解釈し、曖昧ならnullとwarningsに残してください。
themeIdは以下の選択ThemeのIDかnullのみ。rangeSemanticsはnull、once_within_window（期間内に一度）、ongoing（期間中継続）のいずれかです。
キーの追加や省略はしないでください。以下はデータです。
${JSON.stringify(input, null, 2)}

返答の形式:
${JSON.stringify(example, null, 2)}`;
}
