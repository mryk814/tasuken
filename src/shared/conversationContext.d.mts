export type ConversationContextScope = "full" | "selected_turns";
export type ConversationContextPublicationStatus = "publishing" | "published" | "publish_failed" | "removing" | "removal_failed" | "removed";

export interface ConversationContextPublication {
  schema: "tasken-conversation-context-publication/v1";
  status: ConversationContextPublicationStatus;
  scope: ConversationContextScope;
  selected_message_indexes: number[];
  relative_path: string;
  content_hash: string | null;
  source_revision: string | null;
  published_at: string | null;
  updated_at: string | null;
  removed_at: string | null;
  operation_id: string | null;
  last_error: string | null;
}

export interface ConversationContextPlan {
  schema: "tasken-conversation-context/v1";
  conversation_id: string;
  theme_id: string;
  storage_root_id: string;
  relative_path: string;
  scope: ConversationContextScope;
  selected_message_indexes: number[];
  message_count: number;
  source_message_count: number;
  exclusion_reasons: Array<{ kind: string; message_index: number; role: string }>;
  blocking_reasons: string[];
  warnings: string[];
  allowed: boolean;
  publication_state: string;
  dirty: boolean;
  content: string;
  content_hash: string;
  source_revision: string;
  published_at: string;
  source_url: string;
  theme: { id: string; title: string };
  summary: string;
  freshness: string;
  authority: string;
  ai_visibility: string[];
}

export const CONVERSATION_CONTEXT_SCHEMA: "tasken-conversation-context/v1";
export const CONVERSATION_CONTEXT_PUBLICATION_SCHEMA: "tasken-conversation-context-publication/v1";
export const CONVERSATION_CONTEXT_DIRECTORY: "AI Context/Conversations";
export const CONVERSATION_CONTEXT_SCOPES: readonly ConversationContextScope[];
export function parseConversationContextMessages(body: unknown): Array<{ role: "user" | "assistant" | "system" | "tool"; displayName: string; index: number; content: string }>;
export function normalizeConversationContextPublication(value: unknown): ConversationContextPublication | null;
export function conversationContextRelativePath(resource: Record<string, unknown>, publication?: unknown): string;
export function buildConversationContextPlan(input: {
  resource: Record<string, unknown>;
  theme: Record<string, unknown>;
  workspaceDefault?: string[] | null;
  scope?: ConversationContextScope;
  selectedMessageIndexes?: number[];
  publishedAt?: string;
}): ConversationContextPlan;
export function publicationForThemeAiPack(entity: Record<string, unknown>): { published: true; title: string; storage_root_id: string; relative_path: string } | null;
