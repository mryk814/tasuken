import {
  artifactFileTypeFromName,
  displayNameFromTarget,
  inferArtifactLinkType,
  isHttpUrl,
} from "./artifactLinks.mjs";
import { isWebArtifact } from "./webArtifact.mjs";

// 「完了Taskを記録」で一緒に添える成果物（ファイル・URL）。
export const DONE_TASK_ATTACHMENT_LIMIT = 20;

export type DoneTaskAttachment =
  { kind: "file"; path: string; name: string } | { kind: "url"; url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Capture windowから届いた添付を検査して正規化する。
 * 形が崩れていれば例外にし、Taskを作る前に止める。
 */
export function normalizeDoneTaskAttachments(value: unknown): DoneTaskAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("成果物の指定が不正です。");
  if (value.length > DONE_TASK_ATTACHMENT_LIMIT) {
    throw new Error(`成果物は${DONE_TASK_ATTACHMENT_LIMIT}件までにしてください。`);
  }
  const seen = new Set<string>();
  const attachments: DoneTaskAttachment[] = [];
  for (const item of value) {
    if (!isRecord(item)) throw new Error("成果物の指定が不正です。");
    if (item.kind === "file") {
      const filePath = trimmed(item.path);
      if (!filePath) throw new Error("成果物のファイルの場所を取得できませんでした。");
      if (seen.has(`file:${filePath}`)) continue;
      seen.add(`file:${filePath}`);
      attachments.push({
        kind: "file",
        path: filePath,
        name: trimmed(item.name) || displayNameFromTarget(filePath, "file"),
      });
    } else if (item.kind === "url") {
      const url = trimmed(item.url);
      if (!isHttpUrl(url)) throw new Error("成果物のURLはhttpかhttpsで指定してください。");
      if (seen.has(`url:${url}`)) continue;
      seen.add(`url:${url}`);
      attachments.push({ kind: "url", url });
    } else {
      throw new Error("成果物の指定が不正です。");
    }
  }
  return attachments;
}

function linkedArtifact(target: string, filename: string, base: Record<string, unknown>) {
  const fileType = artifactFileTypeFromName(filename);
  const isWeb = isWebArtifact({ filename, file_type: fileType });
  return {
    ...base,
    title: filename.replace(/\.[^.]+$/, "") || "リンク",
    filename,
    file_type: fileType,
    stored_path: "",
    original_path: null,
    storage_mode: "linked",
    copied_at: null,
    link_type: inferArtifactLinkType(target),
    target,
    link_status: "unknown",
    last_checked_at: null,
    web_kind: isWeb ? "self_contained_html" : null,
    web_entrypoint: isWeb ? filename : null,
    web_execution_policy: isWeb ? "sandboxed_interactive" : null,
  };
}

/**
 * 完了Taskを出所にしたArtifactを組み立てる。
 * ファイルはQuick Captureと同じく元の場所を参照するlinked Artifactにし、コピーしない。
 */
export function buildDoneTaskArtifacts(input: {
  taskId: string;
  themeId: string | null;
  files?: Array<{ path: string; name: string }>;
  urls?: string[];
  newId: () => string;
}): Array<Record<string, unknown>> {
  const { taskId, themeId, files = [], urls = [], newId } = input;
  const base = () => ({
    id: newId(),
    source_type: "task",
    source_id: taskId,
    theme_id: themeId || null,
    description: null,
    generated_by: null,
  });
  return [
    ...files.map((file) => linkedArtifact(file.path, file.name, base())),
    ...urls.map((url) => linkedArtifact(url, displayNameFromTarget(url, "link"), base())),
  ];
}
