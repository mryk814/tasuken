import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { safeStorage } from "electron";

import {
  AI_ADAPTER_KINDS,
  AI_CAPABILITIES,
  AI_CONFIG_SCHEMA_VERSION,
  type AiAdapterKind,
  type AiApiSurface,
  type AiAuthKind,
  type AiCapability,
  type AiConnectionTestResult,
  type AiFeature,
  type AiFeatureAvailability,
  type AiModelLifecycle,
  type AiModelProfile,
  type AiModelProfileUpdate,
  type AiNoteGenerateRequest,
  type AiNoteGenerateResult,
  type AiProviderConfig,
  type AiProviderProfile,
  type AiProviderProfileUpdate,
  type AiStreamEvent,
  type AiTestConnectionRequest,
} from "../../shared/ai";
import { adapterCapabilities, resolveFeatureAvailability } from "./ai/capabilities";
import { AiAdapterError, type AiAdapter, type FetchLike } from "./ai/adapterContract";
import { OpenAiResponsesAdapter, UnsupportedAiAdapter } from "./ai/adapters";
import { AiNoteStreamRegistry } from "./ai/noteStreamRegistry.mjs";

const DEFAULT_MODEL = "gpt-5.6";
const DEFAULT_PROVIDER_ID = "openai-default";
const DEFAULT_MODEL_ID = "openai-default-model";
const MAX_BODY_CHARS = 300_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const CONNECTION_TIMEOUT_MS = 30_000;
const BATCH_TRANSCRIPTION_MAX_FILE_SIZE = 25 * 1024 * 1024;
const BATCH_TRANSCRIPTION_MODELS = new Set([
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe",
  "whisper-1",
]);
const BATCH_TRANSCRIPTION_MIME_TYPES = [
  "audio/flac",
  "audio/mpeg",
  "audio/mp4",
  "audio/mpga",
  "audio/m4a",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
] as const;

interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredProviderProfile {
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
  requestTimeoutMs: number;
  enabled: boolean;
  credentialRef: string;
  encryptedCredential?: string;
}

interface StoredAiConfig {
  schemaVersion: typeof AI_CONFIG_SCHEMA_VERSION;
  providers: StoredProviderProfile[];
  models: AiModelProfile[];
  defaultProviderProfileId: string | null;
  defaultModelProfileId: string | null;
}

type LegacyAiConfig = {
  schemaVersion?: unknown;
  provider?: unknown;
  model?: unknown;
  encryptedApiKey?: unknown;
  apiKey?: unknown;
};

export class AiProviderServiceError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_request" | "missing_credential" | "authentication" | "quota" | "rate_limit" | "timeout" | "cancelled" | "unsupported" | "model_unavailable" | "provider_failure",
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "AiProviderServiceError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown, label: string, maxLength: number): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > maxLength) throw new AiProviderServiceError(`${label}が不正です。`, "invalid_request");
  return result;
}

function optionalText(value: unknown, maxLength = 300): string | null {
  if (value === null || value === undefined || value === "") return null;
  const result = String(value).trim();
  if (result.length > maxLength) throw new AiProviderServiceError("設定値が長すぎます。", "invalid_request");
  return result || null;
}

function cleanModel(value: unknown): string {
  const model = text(value, "モデル名", 120);
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) throw new AiProviderServiceError("モデル名に使用できない文字があります。", "invalid_request");
  return model;
}

function validateAdapterKind(value: unknown): AiAdapterKind {
  if (typeof value !== "string" || !(AI_ADAPTER_KINDS as readonly string[]).includes(value)) {
    throw new AiProviderServiceError("adapter kindが不正です。", "invalid_request");
  }
  return value as AiAdapterKind;
}

function validateAuthKind(value: unknown): AiAuthKind {
  if (value !== "api_key" && value !== "bearer_token" && value !== "none") {
    throw new AiProviderServiceError("認証方式が不正です。", "invalid_request");
  }
  return value;
}

function validateApiSurface(value: unknown): AiApiSurface {
  if (value !== "responses" && value !== "chat_completions" && value !== "native") throw new AiProviderServiceError("API surfaceが不正です。", "invalid_request");
  return value;
}

function defaultApiSurfaceForAdapter(adapterKind: AiAdapterKind): AiApiSurface {
  if (adapterKind === "anthropic" || adapterKind === "gemini" || adapterKind === "bedrock") return "native";
  if (adapterKind === "ollama") return "chat_completions";
  return "responses";
}

function isLocalEndpoint(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function isPrivateEndpoint(hostname: string): boolean {
  if (isLocalEndpoint(hostname) || hostname.endsWith(".localhost")) return true;
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(fc|fd)[0-9a-f:]+$/i.test(hostname.replace(/^\[|\]$/g, ""));
}

function endpointExposure(value: string | null): "external" | "local_private" {
  if (!value) return "external";
  try {
    return isPrivateEndpoint(new URL(value).hostname) ? "local_private" : "external";
  } catch {
    return "external";
  }
}

export function validateCredentialFreeEndpoint(value: unknown, adapterKind: AiAdapterKind): string | null {
  if (value === null || value === undefined || value === "") return null;
  const endpoint = text(value, "endpoint", 500);
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new AiProviderServiceError("endpoint URLが不正です。https://または許可されたlocal http URLを指定してください。", "invalid_request");
  }
  const localHttp = parsed.protocol === "http:" && isLocalEndpoint(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new AiProviderServiceError("endpointはhttps URL、またはlocalhost等のlocal http URLにしてください。", "invalid_request");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new AiProviderServiceError("endpointにcredential・query・fragmentを含めないでください。", "invalid_request");
  if (adapterKind === "openai-native" && parsed.origin !== "https://api.openai.com") {
    throw new AiProviderServiceError("OpenAI nativeのendpointはapi.openai.comに固定されています。任意endpointはgeneric OpenAI-compatibleを選んでください。", "invalid_request");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "") || (adapterKind === "openai-native" ? "/v1" : "");
  return `${parsed.origin}${pathname}`;
}

function validateAdapterCombination(adapterKind: AiAdapterKind, authKind: AiAuthKind, apiSurface: AiApiSurface): void {
  const allowed: Record<AiAdapterKind, { auth: AiAuthKind[]; surfaces: AiApiSurface[] }> = {
    "openai-native": { auth: ["api_key"], surfaces: ["responses"] },
    "openai-compatible": { auth: ["api_key", "bearer_token"], surfaces: ["responses", "chat_completions"] },
    "azure-openai": { auth: ["api_key", "bearer_token"], surfaces: ["responses", "chat_completions"] },
    anthropic: { auth: ["api_key"], surfaces: ["native"] },
    gemini: { auth: ["api_key", "bearer_token"], surfaces: ["native"] },
    bedrock: { auth: ["bearer_token"], surfaces: ["native"] },
    ollama: { auth: ["none"], surfaces: ["chat_completions"] },
  };
  if (!allowed[adapterKind].auth.includes(authKind) || !allowed[adapterKind].surfaces.includes(apiSurface)) {
    throw new AiProviderServiceError(`${adapterKind}に指定された認証方式/API surfaceの組合せは利用できません。`, "invalid_request");
  }
}

function validateCapabilities(value: unknown, fallback: AiCapability[]): AiCapability[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw new AiProviderServiceError("capabilitiesが不正です。", "invalid_request");
  const result = [...new Set(value.filter((entry): entry is AiCapability => typeof entry === "string" && (AI_CAPABILITIES as readonly string[]).includes(entry)))];
  if (result.length !== value.length) throw new AiProviderServiceError("capabilitiesに未定義の値があります。", "invalid_request");
  return result;
}

function fallbackCapabilities(adapterKind: AiAdapterKind, apiSurface: AiApiSurface = "responses"): AiCapability[] {
  return adapterCapabilities(adapterKind, apiSurface);
}

function cleanLifecycle(value: unknown): AiModelLifecycle {
  if (value === "available" || value === "unavailable" || value === "deprecated" || value === "experimental") return value;
  return "available";
}

function isUsableModel(model: AiModelProfile): boolean {
  return model.lifecycle === "available" || model.lifecycle === "experimental";
}

function chooseDefaultModelId(models: AiModelProfile[], providerProfileId: string | null, preferredId?: string | null): string | null {
  if (!providerProfileId) return null;
  const preferred = preferredId ? models.find((model) => model.id === preferredId && model.providerProfileId === providerProfileId && isUsableModel(model)) : undefined;
  return preferred?.id || models.find((model) => model.providerProfileId === providerProfileId && isUsableModel(model))?.id || null;
}

function readPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new AiProviderServiceError("limitは正の整数で指定してください。", "invalid_request");
  return result;
}

function readRequestTimeout(value: unknown, fallback = DEFAULT_REQUEST_TIMEOUT_MS): number {
  if (value === null || value === undefined || value === "") return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 30_000 || result > 600_000) throw new AiProviderServiceError("request timeoutは30〜600秒で指定してください。", "invalid_request");
  return result;
}

function redact(value: string, credential?: string): string {
  const withoutCredential = credential ? value.split(credential).join("[REDACTED]") : value;
  return withoutCredential.replace(/(api[-_]?key|authorization|token|secret)\s*[:=]\s*[^,\s]+/gi, "$1=[REDACTED]").slice(0, 500);
}

export function buildNoteMessages(request: AiNoteGenerateRequest) {
  const context: string[] = [];
  if (request.context.includeTitle) context.push(`## Note title\n${request.title || "無題"}`);
  if (request.context.includeBody) context.push(`## Note body\n${request.body}`);
  if (request.context.includeSelection && request.selection) context.push(`## Explicit selection\n${request.selection.text}`);
  if (request.context.includeHeading && request.context.heading) context.push(`## Current heading\n${request.context.heading}`);
  if (request.context.theme) context.push(`## Theme\n${request.context.theme.title}\n\n${request.context.theme.summary}`);
  if (request.context.resource) context.push(`## Related Resource\n${request.context.resource.title}\n\n${request.context.resource.summary}`);
  const history = (request.history || []).map((entry) => ({
    role: entry.role,
    content: [{ type: "text" as const, text: entry.text }],
  }));
  return [
    ...history,
    {
      role: "system" as const,
      content: [{ type: "text" as const, text: "あなたはTaskenのNote編集アシスタントです。明示されたContextだけを使って回答してください。回答はそのままコピー・挿入・差分レビューできるMarkdownにし、コードフェンスや前置きは付けません。" }],
    },
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: [`# Request\n${request.instruction.trim()}`, ...context].join("\n\n") }],
    },
  ];
}

function validateContextEntity(value: unknown, label: string): { id: string; title: string; summary: string } | undefined {
  if (value === undefined || value === null) return undefined;
  const item = record(value);
  return {
    id: text(item.id, `${label} id`, 200),
    title: text(item.title, `${label} title`, 500),
    summary: text(item.summary, `${label} summary`, 20_000),
  };
}

export function validateNoteRequest(value: AiNoteGenerateRequest): AiNoteGenerateRequest {
  if (!value || typeof value !== "object") throw new AiProviderServiceError("AI編集の入力が不正です。", "invalid_request");
  if (
    value.confirmationToken !== "note-ai-context-confirmed/v1"
    || typeof value.noteId !== "string"
    || !value.noteId.trim()
    || !Number.isInteger(value.baseRevision)
    || typeof value.expectedBodySignature !== "string"
    || !/^[a-f0-9]{64}$/.test(value.expectedBodySignature)
  ) {
    throw new AiProviderServiceError("AI ContextのMain確認が不正です。", "invalid_request");
  }
  if (!["document", "selection"].includes(value.scope)) throw new AiProviderServiceError("AI編集範囲が不正です。", "invalid_request");
  if (typeof value.body !== "string" || value.body.length > MAX_BODY_CHARS) throw new AiProviderServiceError("Note本文が大きすぎます。30万文字以下にしてください。", "invalid_request");
  if (typeof value.title !== "string" || value.title.length > 500) throw new AiProviderServiceError("Note titleが大きすぎます。", "invalid_request");
  if (typeof value.instruction !== "string" || !value.instruction.trim() || value.instruction.length > 20_000) throw new AiProviderServiceError("AIへの指示を1〜2万文字で入力してください。", "invalid_request");
  const contextValue = record(value.context);
  if (typeof contextValue.includeTitle !== "boolean" || typeof contextValue.includeBody !== "boolean" || typeof contextValue.includeSelection !== "boolean" || typeof contextValue.includeHeading !== "boolean" || typeof contextValue.includeHistory !== "boolean") {
    throw new AiProviderServiceError("AIへ送るContextの選択が不正です。", "invalid_request");
  }
  if (value.scope === "selection") {
    const selection = value.selection;
    if (!selection || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end <= selection.start || value.body.slice(selection.start, selection.end) !== selection.text) {
      throw new AiProviderServiceError("選択範囲が本文と一致しません。範囲を選び直してください。", "invalid_request");
    }
  }
  if (contextValue.includeSelection && !value.selection) throw new AiProviderServiceError("送信対象の選択範囲がありません。", "invalid_request");
  const heading = contextValue.includeHeading ? text(contextValue.heading, "current heading", 500) : undefined;
  const theme = validateContextEntity(contextValue.theme, "Theme");
  const resource = validateContextEntity(contextValue.resource, "Resource");
  const history = Array.isArray(value.history) ? value.history : [];
  if (history.length > 24) throw new AiProviderServiceError("AI会話履歴が多すぎます。", "invalid_request");
  let historyChars = 0;
  const boundedHistory = history.map((entry) => {
    if (!entry || (entry.role !== "user" && entry.role !== "assistant") || typeof entry.text !== "string" || !entry.text || entry.text.length > 4_000) {
      throw new AiProviderServiceError("AI会話履歴が不正です。", "invalid_request");
    }
    historyChars += entry.text.length;
    return { role: entry.role, text: entry.text };
  });
  if (historyChars > 24_000) throw new AiProviderServiceError("AI会話履歴が大きすぎます。", "invalid_request");
  if (!contextValue.includeTitle && !contextValue.includeBody && !contextValue.includeSelection && !heading && !theme && !resource && !(contextValue.includeHistory && boundedHistory.length)) {
    throw new AiProviderServiceError("AIへ送るContextを1件以上選んでください。", "invalid_request");
  }
  return {
    ...value,
    title: value.title.slice(0, 500),
    instruction: value.instruction.trim(),
    context: {
      includeTitle: contextValue.includeTitle,
      includeBody: contextValue.includeBody,
      includeSelection: contextValue.includeSelection,
      includeHeading: contextValue.includeHeading,
      includeHistory: contextValue.includeHistory,
      ...(heading ? { heading } : {}),
      ...(theme ? { theme } : {}),
      ...(resource ? { resource } : {}),
    },
    history: boundedHistory,
  };
}

function migrateLegacyConfig(parsed: LegacyAiConfig, storage: SafeStorageAdapter): StoredAiConfig {
  const model = typeof parsed.model === "string" && parsed.model.trim() ? cleanModel(parsed.model) : DEFAULT_MODEL;
  const encryptedCredential = typeof parsed.encryptedApiKey === "string" ? parsed.encryptedApiKey : undefined;
  let migratedCredential = encryptedCredential;
  if (!migratedCredential && typeof parsed.apiKey === "string" && parsed.apiKey.trim()) {
    if (!storage.isEncryptionAvailable()) throw new AiProviderServiceError("旧AI設定のcredentialを安全に移行できません。OSの資格情報保護を有効にしてください。", "missing_credential");
    migratedCredential = storage.encryptString(parsed.apiKey.trim()).toString("base64");
  }
  return {
    schemaVersion: AI_CONFIG_SCHEMA_VERSION,
    providers: [{
      id: DEFAULT_PROVIDER_ID,
      label: "OpenAI",
      adapterKind: "openai-native",
      authKind: "api_key",
      endpoint: null,
      organization: null,
      project: null,
      region: null,
      deployment: null,
      apiSurface: "responses",
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      enabled: true,
      credentialRef: `ai-profile:${DEFAULT_PROVIDER_ID}`,
      ...(migratedCredential ? { encryptedCredential: migratedCredential } : {}),
    }],
    models: [{
      id: DEFAULT_MODEL_ID,
      providerProfileId: DEFAULT_PROVIDER_ID,
      model,
      displayName: model,
      capabilities: adapterCapabilities("openai-native", "responses"),
      contextLimit: null,
      outputLimit: null,
      costHint: null,
      lifecycle: "available",
    }],
    defaultProviderProfileId: DEFAULT_PROVIDER_ID,
    defaultModelProfileId: DEFAULT_MODEL_ID,
  };
}

export class AiProviderService {
  private readonly configPath: string;

  constructor(
    userDataPath: string,
    private readonly storage: SafeStorageAdapter = safeStorage,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.configPath = path.join(userDataPath, "ai-provider.json");
  }

  getConfig(): AiProviderConfig {
    const config = this.readConfig();
    return {
      schemaVersion: AI_CONFIG_SCHEMA_VERSION,
      providers: config.providers.map((profile) => this.toPublicProvider(profile)),
      models: config.models,
      defaultProviderProfileId: config.defaultProviderProfileId,
      defaultModelProfileId: config.defaultModelProfileId,
    };
  }

  saveProviderProfile(update: AiProviderProfileUpdate): AiProviderConfig {
    const config = this.readConfig();
    const id = update.id || randomUUID();
    const current = config.providers.find((profile) => profile.id === id);
    const adapterKind = validateAdapterKind(update?.adapterKind);
    const authKind = validateAuthKind(update?.authKind);
    const apiSurface = validateApiSurface(update?.apiSurface || (current?.adapterKind === adapterKind ? current.apiSurface : defaultApiSurfaceForAdapter(adapterKind)));
    validateAdapterCombination(adapterKind, authKind, apiSurface);
    const endpoint = validateCredentialFreeEndpoint(update?.endpoint, adapterKind);
    if ((adapterKind === "openai-compatible" || adapterKind === "azure-openai") && !endpoint) throw new AiProviderServiceError("このadapterにはendpointが必要です。", "invalid_request");
    const nextEnabled = update.enabled ?? current?.enabled ?? true;
    if (current && current.id === config.defaultProviderProfileId && !nextEnabled) throw new AiProviderServiceError("default providerは無効化できません。先に別のproviderをdefaultにしてください。", "invalid_request");
    const next: StoredProviderProfile = {
      id,
      label: text(update.label, "provider名", 120),
      adapterKind,
      authKind,
      endpoint,
      organization: optionalText(update.organization),
      project: optionalText(update.project),
      region: optionalText(update.region),
      deployment: optionalText(update.deployment),
      apiSurface,
      requestTimeoutMs: readRequestTimeout(update.requestTimeoutMs, current?.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS),
      enabled: nextEnabled,
      credentialRef: current?.credentialRef || `ai-profile:${id}`,
      ...(current?.encryptedCredential ? { encryptedCredential: current.encryptedCredential } : {}),
    };
    if (authKind === "none") delete next.encryptedCredential;
    if (update.clearCredential) delete next.encryptedCredential;
    if (update.credential !== undefined) {
      const credential = update.credential.trim();
      if (!credential) throw new AiProviderServiceError("credentialは空欄にできません。", "invalid_request");
      if (authKind === "none") throw new AiProviderServiceError("このadapterはcredential不要であり、credentialを受け付けません。", "invalid_request");
      if (!this.storage.isEncryptionAvailable()) throw new AiProviderServiceError("この端末ではcredentialを安全に暗号化できません。OSの資格情報保護を有効にしてください。", "missing_credential");
      next.encryptedCredential = this.storage.encryptString(credential).toString("base64");
    }
    const providers = current ? config.providers.map((profile) => profile.id === id ? next : profile) : [...config.providers, next];
    const supportedCapabilities = new Set(adapterCapabilities(adapterKind, apiSurface));
    const models = config.models.map((model) => model.providerProfileId === id
      ? { ...model, capabilities: model.capabilities.filter((capability) => supportedCapabilities.has(capability)) }
      : model);
    const defaultProviderProfileId = config.defaultProviderProfileId
      ? providers.some((profile) => profile.id === config.defaultProviderProfileId && profile.enabled) ? config.defaultProviderProfileId : null
      : (nextEnabled ? id : providers.find((profile) => profile.enabled)?.id || null);
    const defaultModelProfileId = chooseDefaultModelId(models, defaultProviderProfileId, config.defaultModelProfileId);
    this.writeConfig({ ...config, providers, models, defaultProviderProfileId, defaultModelProfileId });
    return this.getConfig();
  }

  deleteProviderProfile(id: string): AiProviderConfig {
    const config = this.readConfig();
    if (!config.providers.some((profile) => profile.id === id)) throw new AiProviderServiceError("provider profileが見つかりません。", "invalid_request");
    const providers = config.providers.filter((profile) => profile.id !== id);
    const models = config.models.filter((model) => model.providerProfileId !== id);
    const defaultProviderProfileId = config.defaultProviderProfileId === id
      ? providers.find((profile) => profile.enabled)?.id || null
      : config.defaultProviderProfileId;
    const defaultModelProfileId = chooseDefaultModelId(models, defaultProviderProfileId, config.defaultModelProfileId);
    this.writeConfig({ ...config, providers, models, defaultProviderProfileId, defaultModelProfileId });
    return this.getConfig();
  }

  saveModelProfile(update: AiModelProfileUpdate): AiProviderConfig {
    const config = this.readConfig();
    if (!config.providers.some((profile) => profile.id === update?.providerProfileId)) throw new AiProviderServiceError("紐づけ先のprovider profileが見つかりません。", "invalid_request");
    const id = update.id || randomUUID();
    const current = config.models.find((model) => model.id === id);
    const provider = config.providers.find((profile) => profile.id === update.providerProfileId)!;
    const supportedCapabilities = new Set(adapterCapabilities(provider.adapterKind, provider.apiSurface));
    const requestedCapabilities = validateCapabilities(update.capabilities, fallbackCapabilities(provider.adapterKind, provider.apiSurface));
    const next: AiModelProfile = {
      id,
      providerProfileId: update.providerProfileId,
      model: cleanModel(update.model),
      displayName: optionalText(update.displayName, 120) || cleanModel(update.model),
      capabilities: requestedCapabilities.filter((capability) => supportedCapabilities.has(capability)),
      contextLimit: readPositiveInteger(update.contextLimit),
      outputLimit: readPositiveInteger(update.outputLimit),
      costHint: optionalText(update.costHint, 120),
      lifecycle: cleanLifecycle(update.lifecycle ?? current?.lifecycle),
    };
    const models = current ? config.models.map((model) => model.id === id ? next : model) : [...config.models, next];
    const defaultModelProfileId = chooseDefaultModelId(models, config.defaultProviderProfileId, config.defaultModelProfileId || (config.defaultProviderProfileId === next.providerProfileId ? next.id : null));
    this.writeConfig({ ...config, models, defaultModelProfileId });
    return this.getConfig();
  }

  deleteModelProfile(id: string): AiProviderConfig {
    const config = this.readConfig();
    const models = config.models.filter((model) => model.id !== id);
    if (models.length === config.models.length) throw new AiProviderServiceError("model profileが見つかりません。", "invalid_request");
    const defaultModelProfileId = config.defaultModelProfileId === id
      ? chooseDefaultModelId(models, config.defaultProviderProfileId)
      : chooseDefaultModelId(models, config.defaultProviderProfileId, config.defaultModelProfileId);
    this.writeConfig({ ...config, models, defaultModelProfileId });
    return this.getConfig();
  }

  setDefaultProviderProfile(id: string): AiProviderConfig {
    const config = this.readConfig();
    const provider = config.providers.find((profile) => profile.id === id);
    if (!provider) throw new AiProviderServiceError("provider profileが見つかりません。", "invalid_request");
    if (!provider.enabled) throw new AiProviderServiceError("無効なprovider profileはdefaultにできません。", "invalid_request");
    const model = config.models.find((candidate) => candidate.id === config.defaultModelProfileId && candidate.providerProfileId === id && isUsableModel(candidate))
      || config.models.find((candidate) => candidate.providerProfileId === id && isUsableModel(candidate));
    this.writeConfig({ ...config, defaultProviderProfileId: id, defaultModelProfileId: model?.id || null });
    return this.getConfig();
  }

  setDefaultModelProfile(id: string): AiProviderConfig {
    const config = this.readConfig();
    const model = config.models.find((candidate) => candidate.id === id);
    if (!model) throw new AiProviderServiceError("model profileが見つかりません。", "invalid_request");
    if (model.providerProfileId !== config.defaultProviderProfileId) throw new AiProviderServiceError("default providerに属さないmodelはdefaultにできません。", "invalid_request");
    if (model.lifecycle === "unavailable" || model.lifecycle === "deprecated") throw new AiProviderServiceError("利用できないmodelはdefaultにできません。", "model_unavailable");
    this.writeConfig({ ...config, defaultModelProfileId: id });
    return this.getConfig();
  }

  getFeatureAvailability(feature: AiFeature, providerProfileId?: string, modelProfileId?: string): AiFeatureAvailability {
    const config = this.readConfig();
    const provider = config.providers.find((candidate) => candidate.id === (providerProfileId || config.defaultProviderProfileId));
    const model = config.models.find((candidate) => candidate.id === (modelProfileId || config.defaultModelProfileId));
    if (!provider || !model || model.providerProfileId !== provider.id) {
      return { feature, available: false, required: [], missing: [], reason: "provider_unavailable" };
    }
    return resolveFeatureAvailability(feature, this.toPublicProvider(provider), model);
  }

  resolveBatchTranscriptionProvider() {
    const config = this.readConfig();
    const provider = config.providers.find((candidate) => candidate.id === config.defaultProviderProfileId);
    const model = config.models.find((candidate) => candidate.id === config.defaultModelProfileId);
    if (!provider || !model || model.providerProfileId !== provider.id) {
      return {
        binding: null,
        provider: null,
        reason: "binding_unavailable",
        message: "文字起こし用のdefault provider/modelが設定されていません。Settingsで選択してください。",
      };
    }
    const exactModelSupported = provider.adapterKind === "openai-native" && BATCH_TRANSCRIPTION_MODELS.has(model.model);
    const binding = {
      feature: "transcript_batch" as const,
      provider_profile_id: provider.id,
      provider_label: provider.label,
      model_profile_id: model.id,
      model_id: model.model,
      processing_mode: "cloud" as const,
      enabled: provider.enabled,
      credential_configured: Boolean(provider.encryptedCredential),
      model_lifecycle: model.lifecycle,
      capabilities: exactModelSupported ? ["batch_transcription" as const, "language_detection" as const] : [],
      max_file_size: BATCH_TRANSCRIPTION_MAX_FILE_SIZE,
      supported_mime_types: [...BATCH_TRANSCRIPTION_MIME_TYPES],
    };
    if (!exactModelSupported) {
      return {
        binding,
        provider: null,
        reason: "capability_missing",
        message: "選択中のprovider/modelはbatch文字起こしに対応していません。別modelへ自動切替しません。",
      };
    }
    if (!provider.enabled || (model.lifecycle !== "available" && model.lifecycle !== "experimental") || !provider.encryptedCredential) {
      return {
        binding,
        provider: null,
        reason: !provider.enabled ? "provider_disabled" : !provider.encryptedCredential ? "missing_credential" : "model_unavailable",
        message: !provider.enabled
          ? "文字起こしProviderが無効です。Settingsで有効にしてください。"
          : !provider.encryptedCredential
            ? "文字起こしProviderの資格情報をSettingsで設定してください。"
            : "選択中の文字起こしmodelを利用できません。Settingsを確認してください。",
      };
    }
    return {
      binding,
      provider: {
        providerProfileId: provider.id,
        transcribe: (input: {
          source: { fileDescriptor: number };
          fileSize: number;
          mimeType: string;
          model: string;
          language: string;
          signal?: AbortSignal;
        }) => this.transcribeOpenAiBatch(provider, model, input),
      },
      reason: null,
      message: null,
    };
  }

  async testConnection(request: AiTestConnectionRequest): Promise<AiConnectionTestResult> {
    const config = this.readConfig();
    const provider = config.providers.find((candidate) => candidate.id === request?.providerProfileId);
    if (!provider) throw new AiProviderServiceError("provider profileが見つかりません。", "invalid_request");
    const model = request.modelProfileId ? config.models.find((candidate) => candidate.id === request.modelProfileId) : undefined;
    if (model && model.providerProfileId !== provider.id) throw new AiProviderServiceError("model profileとprovider profileの組合せが不正です。", "invalid_request");
    const base = { providerProfileId: provider.id, ...(model ? { modelProfileId: model.id } : {}), adapterKind: provider.adapterKind };
    if (this.toPublicProvider(provider).adapterStatus === "planned") return { ...base, status: "unsupported", capabilities: [], message: `${provider.adapterKind}/${provider.apiSurface} adapterは未実装です。接続成功とは表示しません。` };
    if (provider.authKind !== "none" && !provider.encryptedCredential) return { ...base, status: "missing_credential", capabilities: [], message: "credentialが設定されていません。" };
    let credential: string | undefined;
    try {
      credential = this.credentialFor(provider);
      const adapter = this.createAdapter(provider, credential, CONNECTION_TIMEOUT_MS);
      const result = await adapter.testConnection(model?.model);
      const supportedCapabilities = adapterCapabilities(provider.adapterKind, provider.apiSurface);
      return { ...base, ...result, capabilities: model ? model.capabilities.filter((capability) => supportedCapabilities.includes(capability)) : supportedCapabilities };
    } catch (error) {
      const projection = this.normalizeError(error, provider, model, credential);
      return { ...base, status: projection.code === "model_unavailable" ? "model_unavailable" : projection.code === "unsupported" ? "unsupported" : projection.code === "missing_credential" ? "missing_credential" : "connection_failed", capabilities: [], message: projection.message, ...(projection.httpStatus ? { httpStatus: projection.httpStatus } : {}) };
    }
  }

  private readonly noteStreams = new AiNoteStreamRegistry();

  async streamNote(requestId: string, requestValue: AiNoteGenerateRequest, onEvent: (event: AiStreamEvent) => void): Promise<AiNoteGenerateResult> {
    const request = validateNoteRequest(requestValue);
    const config = this.readConfig();
    const provider = config.providers.find((candidate) => candidate.id === config.defaultProviderProfileId);
    const model = config.models.find((candidate) => candidate.id === config.defaultModelProfileId);
    if (!provider || !model || model.providerProfileId !== provider.id) throw new AiProviderServiceError("default provider/modelが設定されていません。Settingsで選択してください。", "provider_failure");
    if (!provider.enabled) throw new AiProviderServiceError("default providerが無効です。Settingsで有効化してください。", "provider_failure");
    const availability = resolveFeatureAvailability("note_assistant", this.toPublicProvider(provider), model);
    if (!availability.available) {
      throw new AiProviderServiceError(`このmodelではNote AIを利用できません。必要: ${availability.required.join(", ")} / 不足: ${availability.missing.join(", ")}`, availability.reason === "model_unavailable" ? "model_unavailable" : availability.reason === "adapter_unimplemented" ? "unsupported" : "invalid_request");
    }
    let responseText = "";
    let usage = null;
    let credential: string | undefined;
    let controller: AbortController;
    try {
      controller = this.noteStreams.start(requestId);
    } catch {
      throw new AiProviderServiceError("AI stream request idが不正です。", "invalid_request");
    }
    try {
      credential = this.credentialFor(provider);
      const adapter = this.createAdapter(provider, credential, provider.requestTimeoutMs, controller.signal);
      for await (const event of adapter.stream({ model: model.model, messages: buildNoteMessages(request), stream: true })) {
        onEvent(event);
        if (event.type === "text_delta") responseText += event.text;
        else if (event.type === "usage") usage = event.usage;
        else if (event.type === "error") throw new AiAdapterError(event.error);
      }
    } catch (error) {
      throw this.normalizeError(error, provider, model, credential);
    } finally {
      this.noteStreams.finish(requestId);
    }
    if (!responseText.trim()) throw new AiProviderServiceError("providerの返答が空でした。入力内容は保持されています。", "provider_failure");
    const proposedBody = request.scope === "selection"
      ? `${request.body.slice(0, request.selection!.start)}${responseText}${request.body.slice(request.selection!.end)}`
      : responseText;
    return {
      providerProfileId: provider.id,
      providerLabel: provider.label,
      adapterKind: provider.adapterKind,
      modelProfileId: model.id,
      model: model.model,
      capabilityPath: availability.required,
      usage,
      proposedBody,
      responseText,
    };
  }

  cancelNoteStream(requestId: string): boolean {
    return this.noteStreams.cancel(requestId);
  }

  private async transcribeOpenAiBatch(
    provider: StoredProviderProfile,
    model: AiModelProfile,
    input: {
      source: { fileDescriptor: number };
      fileSize: number;
      mimeType: string;
      model: string;
      language: string;
      signal?: AbortSignal;
    },
  ): Promise<{ rawText: string; language: string }> {
    if (provider.adapterKind !== "openai-native" || model.model !== input.model || !BATCH_TRANSCRIPTION_MODELS.has(model.model)) {
      throw new AiProviderServiceError("文字起こしProviderまたはmodelが一致しません。", "unsupported");
    }
    if (!BATCH_TRANSCRIPTION_MIME_TYPES.includes(input.mimeType as (typeof BATCH_TRANSCRIPTION_MIME_TYPES)[number])
      || !Number.isSafeInteger(input.fileSize)
      || input.fileSize <= 0
      || input.fileSize > BATCH_TRANSCRIPTION_MAX_FILE_SIZE) {
      throw new AiProviderServiceError("音声形式または容量がProviderの上限に一致しません。", "invalid_request");
    }
    const credential = this.credentialFor(provider);
    if (!credential) throw new AiProviderServiceError("文字起こしProviderの資格情報がありません。", "missing_credential");
    const bytes = Buffer.allocUnsafe(input.fileSize);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = fs.readSync(input.source.fileDescriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (count <= 0) throw new AiProviderServiceError("原音を最後まで読み取れませんでした。Artifactを確認してください。", "invalid_request");
      offset += count;
    }
    const extension = input.mimeType === "audio/wav" ? "wav"
      : input.mimeType === "audio/webm" ? "webm"
        : input.mimeType === "audio/ogg" ? "ogg"
          : input.mimeType === "audio/flac" ? "flac"
            : input.mimeType === "audio/mp4" ? "mp4"
              : input.mimeType === "audio/m4a" ? "m4a" : "mp3";
    const form = new FormData();
    form.set("model", model.model);
    form.set("file", new Blob([bytes], { type: input.mimeType }), `audio.${extension}`);
    if (input.language && input.language !== "und") form.set("language", input.language);
    const endpoint = `${provider.endpoint || "https://api.openai.com/v1"}/audio/transcriptions`;
    const requestController = new AbortController();
    const abortFromCaller = () => requestController.abort();
    if (input.signal?.aborted) requestController.abort();
    else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => requestController.abort(), provider.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          ...(provider.organization ? { "OpenAI-Organization": provider.organization } : {}),
          ...(provider.project ? { "OpenAI-Project": provider.project } : {}),
        },
        body: form,
        signal: requestController.signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw new AiProviderServiceError("文字起こしをキャンセルしました。", "cancelled");
      if (requestController.signal.aborted) throw new AiProviderServiceError("文字起こしProviderが時間内に応答しませんでした。原音を保持したまま再試行できます。", "timeout");
      throw this.normalizeError(error, provider, model, credential);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
      bytes.fill(0);
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "authentication"
        : response.status === 429 ? "rate_limit"
          : response.status === 404 ? "model_unavailable"
            : response.status === 402 ? "quota"
              : response.status >= 400 && response.status < 500 ? "invalid_request" : "provider_failure";
      throw new AiProviderServiceError("文字起こしProviderが要求を処理できませんでした。設定または時間を置いて再試行してください。", code, response.status);
    }
    let payload: Record<string, unknown>;
    try {
      const value: unknown = await response.json();
      payload = record(value);
    } catch {
      throw new AiProviderServiceError("文字起こしProviderの応答を読み取れませんでした。時間を置いて再試行してください。", "provider_failure");
    }
    if (typeof payload.text !== "string" || !payload.text.trim()) {
      throw new AiProviderServiceError("文字起こしProviderの応答が空でした。原音は保持されています。", "provider_failure");
    }
    return {
      rawText: payload.text,
      language: typeof payload.language === "string" ? payload.language : input.language,
    };
  }

  private createAdapter(provider: StoredProviderProfile, credential = this.credentialFor(provider), timeoutMs = provider.requestTimeoutMs, signal?: AbortSignal): AiAdapter {
    const publicProvider = this.toPublicProvider(provider);
    if (publicProvider.adapterStatus === "implemented") {
      return new OpenAiResponsesAdapter({ profile: publicProvider, credential, fetcher: this.fetcher, timeoutMs, signal });
    }
    return new UnsupportedAiAdapter({ profile: publicProvider, credential, fetcher: this.fetcher, timeoutMs, signal });
  }

  private credentialFor(provider: StoredProviderProfile): string | undefined {
    return provider.encryptedCredential ? this.decryptCredential(provider) : undefined;
  }

  private decryptCredential(provider: StoredProviderProfile): string {
    if (!provider.encryptedCredential) throw new AiProviderServiceError("credentialが設定されていません。", "missing_credential");
    if (!this.storage.isEncryptionAvailable()) throw new AiProviderServiceError("保存したcredentialを復号できません。OSの資格情報保護を確認してください。", "missing_credential");
    try {
      return this.storage.decryptString(Buffer.from(provider.encryptedCredential, "base64"));
    } catch {
      throw new AiProviderServiceError("保存したcredentialを復号できません。Settingsでcredentialを設定し直してください。", "missing_credential");
    }
  }

  private normalizeError(error: unknown, provider: StoredProviderProfile, model?: AiModelProfile, credential?: string): AiProviderServiceError {
    if (error instanceof AiProviderServiceError) return error;
    if (error instanceof AiAdapterError) {
      return new AiProviderServiceError(redact(error.projection.message, credential), error.projection.code, error.projection.httpStatus);
    }
    return new AiProviderServiceError(`${provider.label}への接続に失敗しました。${model ? `model「${model.model}」を確認してください。` : "endpointを確認してください。"}`, "provider_failure");
  }

  private toPublicProvider(provider: StoredProviderProfile): AiProviderProfile {
    return {
      id: provider.id,
      label: provider.label,
      adapterKind: provider.adapterKind,
      authKind: provider.authKind,
      endpoint: provider.endpoint,
      organization: provider.organization,
      project: provider.project,
      region: provider.region,
      deployment: provider.deployment,
      apiSurface: provider.apiSurface,
      endpointExposure: endpointExposure(provider.endpoint),
      requestTimeoutMs: provider.requestTimeoutMs,
      enabled: provider.enabled,
      credentialConfigured: Boolean(provider.encryptedCredential),
      adapterStatus: adapterCapabilities(provider.adapterKind, provider.apiSurface).length > 0 ? "implemented" : "planned",
    };
  }

  private readConfig(): StoredAiConfig {
    if (!fs.existsSync(this.configPath)) return migrateLegacyConfig({}, this.storage);
    try {
      const parsed = record(JSON.parse(fs.readFileSync(this.configPath, "utf8"))) as Partial<StoredAiConfig> & LegacyAiConfig;
      const schemaVersion: unknown = parsed.schemaVersion;
      if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion) && schemaVersion > AI_CONFIG_SCHEMA_VERSION) {
        throw new AiProviderServiceError("AI設定のschemaVersionが新しすぎます。アプリを更新してください。設定ファイルは変更していません。", "invalid_request");
      }
      if (schemaVersion === undefined || schemaVersion === 1) {
        if (Array.isArray(parsed.providers) || Array.isArray(parsed.models)) throw new AiProviderServiceError("旧AI設定のprofile形式を移行できません。設定ファイルを確認してください。", "invalid_request");
        const migrated = migrateLegacyConfig(parsed, this.storage);
        this.writeConfig(migrated);
        return migrated;
      }
      if (schemaVersion !== AI_CONFIG_SCHEMA_VERSION) throw new AiProviderServiceError("AI設定のschemaVersionが不正です。設定ファイルを確認してください。", "invalid_request");
      if (!Array.isArray(parsed.providers) || !Array.isArray(parsed.models)) throw new AiProviderServiceError("AI設定のprofile配列が不正です。設定ファイルを確認してください。", "invalid_request");
      const providerIds = new Set<string>();
      const providers = parsed.providers.map((entry) => {
        const item = record(entry);
        const adapterKind = validateAdapterKind(item.adapterKind);
        const authKind = validateAuthKind(item.authKind);
        const apiSurface = validateApiSurface(item.apiSurface);
        validateAdapterCombination(adapterKind, authKind, apiSurface);
        const id = text(item.id, "provider id", 120);
        if (providerIds.has(id)) throw new AiProviderServiceError("provider profileのidが重複しています。設定ファイルを確認してください。", "invalid_request");
        providerIds.add(id);
        return {
          id,
          label: text(item.label, "provider名", 120),
          adapterKind,
          authKind,
          endpoint: validateCredentialFreeEndpoint(item.endpoint, adapterKind),
          organization: optionalText(item.organization),
          project: optionalText(item.project),
          region: optionalText(item.region),
          deployment: optionalText(item.deployment),
          apiSurface,
          requestTimeoutMs: readRequestTimeout(item.requestTimeoutMs),
          enabled: item.enabled !== false,
          credentialRef: text(item.credentialRef || `ai-profile:${String(item.id)}`, "credential ref", 200),
          ...(typeof item.encryptedCredential === "string" ? { encryptedCredential: item.encryptedCredential } : {}),
        } satisfies StoredProviderProfile;
      });
      const modelIds = new Set<string>();
      const models = parsed.models.map((entry) => {
        const item = record(entry);
        const providerProfileId = text(item.providerProfileId, "provider profile id", 120);
        if (!providerIds.has(providerProfileId)) throw new AiProviderServiceError("model profileのprovider参照が不正です。", "invalid_request");
        const provider = providers.find((candidate) => candidate.id === providerProfileId)!;
        const supportedCapabilities = new Set(adapterCapabilities(provider.adapterKind, provider.apiSurface));
        const id = text(item.id, "model profile id", 120);
        if (modelIds.has(id)) throw new AiProviderServiceError("model profileのidが重複しています。設定ファイルを確認してください。", "invalid_request");
        modelIds.add(id);
        return {
          id,
          providerProfileId,
          model: cleanModel(item.model),
          displayName: optionalText(item.displayName, 120) || cleanModel(item.model),
          capabilities: validateCapabilities(item.capabilities, fallbackCapabilities(provider.adapterKind, provider.apiSurface)).filter((capability) => supportedCapabilities.has(capability)),
          contextLimit: readPositiveInteger(item.contextLimit),
          outputLimit: readPositiveInteger(item.outputLimit),
          costHint: optionalText(item.costHint, 120),
          lifecycle: cleanLifecycle(item.lifecycle),
        } satisfies AiModelProfile;
      });
      const defaultProviderProfileId = typeof parsed.defaultProviderProfileId === "string"
        && providers.some((provider) => provider.id === parsed.defaultProviderProfileId && provider.enabled)
        ? parsed.defaultProviderProfileId
        : providers.find((provider) => provider.enabled)?.id || null;
      const parsedDefaultModel = typeof parsed.defaultModelProfileId === "string" && modelIds.has(parsed.defaultModelProfileId) ? parsed.defaultModelProfileId : null;
      const defaultModelProfileId = chooseDefaultModelId(models, defaultProviderProfileId, parsedDefaultModel);
      return { schemaVersion: AI_CONFIG_SCHEMA_VERSION, providers, models, defaultProviderProfileId, defaultModelProfileId };
    } catch (error) {
      if (error instanceof AiProviderServiceError) throw error;
      throw new AiProviderServiceError("AI設定を読み込めませんでした。設定ファイルを確認してください。", "invalid_request");
    }
  }

  private writeConfig(config: StoredAiConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
