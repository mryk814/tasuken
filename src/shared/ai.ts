export const AI_CONFIG_SCHEMA_VERSION = 2 as const;

export const AI_CAPABILITIES = [
  "text",
  "streaming",
  "tool_calling",
  "parallel_tool_calling",
  "structured_output",
  "vision",
  "file_input",
  "citations",
  "embeddings",
  "audio_input",
  "audio_output",
  "image_generation",
  "remote_mcp",
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];
export type AiNoteScope = "document" | "selection";

export const AI_ADAPTER_KINDS = [
  "openai-native",
  "openai-compatible",
  "azure-openai",
  "anthropic",
  "gemini",
  "bedrock",
  "ollama",
] as const;

export type AiAdapterKind = (typeof AI_ADAPTER_KINDS)[number];
export type AiAuthKind = "api_key" | "bearer_token" | "none";
export type AiApiSurface = "responses" | "chat_completions" | "native";
export type AiModelLifecycle = "available" | "unavailable" | "deprecated" | "experimental";
export type AiFeature = "note_assistant" | "structured_output" | "tool_use" | "vision" | "embeddings";

export interface AiProviderProfile {
  id: string;
  label: string;
  adapterKind: AiAdapterKind;
  authKind: AiAuthKind;
  endpoint: string | null;
  organization: string | null;
  project: string | null;
  region: string | null;
  deployment: string | null;
  apiSurface: AiApiSurface;
  endpointExposure: "external" | "local_private";
  requestTimeoutMs: number;
  enabled: boolean;
  credentialConfigured: boolean;
  adapterStatus: "implemented" | "planned";
}

export interface AiModelProfile {
  id: string;
  providerProfileId: string;
  model: string;
  displayName: string;
  capabilities: AiCapability[];
  contextLimit: number | null;
  outputLimit: number | null;
  costHint: string | null;
  lifecycle: AiModelLifecycle;
}

export interface AiProviderConfig {
  schemaVersion: typeof AI_CONFIG_SCHEMA_VERSION;
  providers: AiProviderProfile[];
  models: AiModelProfile[];
  defaultProviderProfileId: string | null;
  defaultModelProfileId: string | null;
}

export interface AiProviderProfileUpdate {
  id?: string;
  label: string;
  adapterKind: AiAdapterKind;
  authKind: AiAuthKind;
  endpoint?: string | null;
  organization?: string | null;
  project?: string | null;
  region?: string | null;
  deployment?: string | null;
  apiSurface?: AiApiSurface;
  requestTimeoutMs?: number;
  enabled?: boolean;
  credential?: string;
  clearCredential?: boolean;
}

export interface AiModelProfileUpdate {
  id?: string;
  providerProfileId: string;
  model: string;
  displayName?: string;
  capabilities?: AiCapability[];
  contextLimit?: number | null;
  outputLimit?: number | null;
  costHint?: string | null;
  lifecycle?: AiModelLifecycle;
}

export interface AiTestConnectionRequest {
  providerProfileId: string;
  modelProfileId?: string;
}

export type AiConnectionTestStatus =
  | "connected"
  | "missing_credential"
  | "unsupported"
  | "connection_failed"
  | "model_unavailable";

export interface AiConnectionTestResult {
  status: AiConnectionTestStatus;
  providerProfileId: string;
  modelProfileId?: string;
  adapterKind: AiAdapterKind;
  capabilities: AiCapability[];
  message: string;
  httpStatus?: number;
}

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { kind: "url" | "base64"; value: string; mediaType?: string } }
  | { type: "file"; source: { kind: "url" | "base64"; value: string; mediaType?: string; name?: string } };

export type AiMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface AiMessage {
  role: AiMessageRole;
  content: AiContentPart[];
  toolCallId?: string;
  toolName?: string;
  toolCalls?: AiToolCall[];
}

export interface AiToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface AiStructuredOutput {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface AiCanonicalRequest {
  model: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; name: string };
  structuredOutput?: AiStructuredOutput;
  stream: boolean;
}

export interface AiToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens?: number | null;
}

export interface AiRawMetadata {
  requestId?: string;
  responseId?: string;
  model?: string;
  providerStatus?: string;
  finishReason?: string;
}

export interface AiResponse {
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage | null;
  rawMetadata: AiRawMetadata;
}

export type AiStreamEvent =
  | { type: "message_start"; responseId?: string; model?: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string }
  | { type: "citation"; url: string; title?: string }
  | { type: "usage"; usage: AiUsage }
  | { type: "message_end"; responseId?: string; finishReason?: string }
  | { type: "error"; error: AiErrorProjection };

export type AiErrorCode =
  | "invalid_request"
  | "missing_credential"
  | "authentication"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "cancelled"
  | "unsupported"
  | "model_unavailable"
  | "provider_failure";

export interface AiErrorProjection {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  providerProfileId?: string;
  modelProfileId?: string;
}

export interface AiFeatureAvailability {
  feature: AiFeature;
  available: boolean;
  required: AiCapability[];
  missing: AiCapability[];
  reason?: "provider_disabled" | "provider_unavailable" | "model_unavailable" | "capability_missing" | "adapter_unimplemented";
}

export interface AiNoteGenerateRequest {
  noteId: string;
  baseRevision: number;
  expectedBodySignature: string;
  confirmationToken: "note-ai-context-confirmed/v1";
  anchorOffset: number;
  scope: AiNoteScope;
  title: string;
  body: string;
  instruction: string;
  selection?: {
    start: number;
    end: number;
    text: string;
  };
  context: {
    includeTitle: boolean;
    includeBody: boolean;
    includeSelection: boolean;
    includeHeading: boolean;
    includeHistory: boolean;
    heading?: string;
    theme?: { id: string; title: string; summary: string };
    resource?: { id: string; title: string; summary: string };
  };
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface AiNoteGenerateResult {
  providerProfileId: string;
  providerLabel: string;
  adapterKind: AiAdapterKind;
  modelProfileId: string;
  model: string;
  capabilityPath: AiCapability[];
  usage: AiUsage | null;
  proposedBody: string;
  responseText: string;
}
