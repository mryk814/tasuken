import type { AiNoteGenerateRequest, AiNoteGenerateResult } from "./ai";
import type { Entity } from "./types/workspace";

export interface NoteAiHistoryEntry {
  id: string;
  kind: "proposal" | "legacy_draft";
  prompt: string;
  response: string;
  status: string;
  created_at: string;
  provider: string;
  model: string;
  proposal: Entity | null;
}

export function noteAiConversationId(noteId: unknown): string;
export function markdownHeadingAt(markdown: unknown, offset?: unknown): string;
export function markdownHeadingAnchor(markdown: unknown, headingIndex?: unknown): { heading: string; offset: number };
export function markdownCaretAnchor(markdown: unknown, headingIndex?: unknown, blockText?: unknown, prefixText?: unknown): { heading: string; offset: number };
export function proposalNoteId(proposal: unknown): string;
export function proposalResponseText(proposal: unknown): string;
export function buildNoteAiHistory(note: unknown, proposals: unknown): NoteAiHistoryEntry[];
export function buildNoteAiProposal(input: {
  id: string;
  note: Entity;
  instruction: string;
  request: AiNoteGenerateRequest;
  result: AiNoteGenerateResult;
  generatedAt: string;
}): Entity;
export function noteAiSecretWarning(value: unknown): string;
