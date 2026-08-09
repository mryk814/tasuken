import type { AiNoteGenerateRequest } from "../../../shared/ai";

export const NOTE_AI_CONTEXT_CONFIRMATION: "note-ai-context-confirmed/v1";
export const NOTE_AI_HISTORY_MAX_TURNS: number;
export const NOTE_AI_HISTORY_MAX_TEXT: number;
export function authorizeNoteAiRequest(repository: {
  get(type: string, id: string): unknown;
  list(type: string, includeDeleted?: boolean): unknown;
  getPreference(key: string): unknown;
}, request: unknown): AiNoteGenerateRequest;
