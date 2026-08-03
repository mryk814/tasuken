export type AiProvider = "openai";
export type AiNoteMode = "rewrite" | "continue" | "chat";
export type AiNoteScope = "document" | "selection";

export interface AiProviderConfig {
  provider: AiProvider;
  model: string;
  hasApiKey: boolean;
}

export interface AiProviderConfigUpdate {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AiNoteGenerateRequest {
  mode: AiNoteMode;
  scope: AiNoteScope;
  title: string;
  body: string;
  instruction: string;
  selection?: {
    start: number;
    end: number;
    text: string;
  };
}

export interface AiNoteGenerateResult {
  provider: AiProvider;
  model: string;
  proposedBody: string;
  responseText: string;
}
