import { noteProperties } from "./io";
import { str } from "./format";

export const PROMPT_PURPOSE_LABELS: Record<string, string> = {
  report: "報告書",
  knowledge: "Knowledge抽出",
  chat_summary: "チャット要約",
  email: "メール文面",
  okf: "OKF / Context",
  other: "その他",
};

function noteType(note: object): string {
  return str((note as { note_type?: unknown }).note_type);
}

export function isPromptNote(note: object): boolean {
  const type = noteType(note);
  return type === "prompt" || type === "report_prompt" || Boolean(noteProperties(note).prompt_purpose);
}

export function promptPurpose(note: object): string {
  if (noteType(note) === "report_prompt") return "report";
  return str(noteProperties(note).prompt_purpose) || "other";
}

export function promptVariables(note: object): string {
  return str(noteProperties(note).prompt_variables);
}

export function isDefaultPrompt(note: object): boolean {
  return noteProperties(note).is_default === true;
}
