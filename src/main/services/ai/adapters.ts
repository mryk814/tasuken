import type {
  AiCanonicalRequest,
  AiCapability,
  AiContentPart,
  AiConnectionTestStatus,
  AiErrorProjection,
  AiMessage,
  AiRawMetadata,
  AiProviderProfile,
  AiResponse,
  AiStreamEvent,
  AiToolCall,
  AiUsage,
} from "../../../shared/ai";

export type FetchLike = typeof fetch;

export interface AiAdapterConnectionResult {
  status: Extract<AiConnectionTestStatus, "connected" | "model_unavailable">;
  capabilities: AiCapability[];
  message: string;
  httpStatus?: number;
}

export interface AiAdapterContext {
  profile: AiProviderProfile;
  credential?: string;
  fetcher: FetchLike;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiAdapter {
  readonly kind: AiProviderProfile["adapterKind"];
  readonly capabilities: AiCapability[];
  complete(request: AiCanonicalRequest): Promise<AiResponse>;
  stream(request: AiCanonicalRequest): AsyncIterable<AiStreamEvent>;
  testConnection(model?: string): Promise<AiAdapterConnectionResult>;
}

export class AiAdapterError extends Error {
  readonly projection: AiErrorProjection;

  constructor(projection: AiErrorProjection) {
    super(projection.message);
    this.name = "AiAdapterError";
    this.projection = projection;
  }
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readErrorMessage(payload: unknown): string {
  const record = objectRecord(payload);
  const error = objectRecord(record.error);
  const message = typeof error.message === "string" ? error.message : typeof record.message === "string" ? record.message : "";
  return message.slice(0, 500);
}

function redactProviderMessage(value: string, credential?: string): string {
  const normalizedCredential = credential?.trim();
  if (!normalizedCredential) return value;
  return value.split(normalizedCredential).join("[REDACTED]");
}

function errorCodeForStatus(status: number): "authentication" | "quota" | "rate_limit" | "model_unavailable" | "invalid_request" | "provider_failure" {
  if (status === 401 || status === 403) return "authentication";
  if (status === 402) return "quota";
  if (status === 404) return "model_unavailable";
  if (status === 429) return "rate_limit";
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider_failure";
}

function retryableForCode(code: string): boolean {
  return code === "rate_limit" || code === "quota" || code === "provider_failure";
}

function readUsage(value: unknown): AiUsage | null {
  const usage = objectRecord(value);
  const inputDetails = objectRecord(usage.input_tokens_details);
  const inputTokens = Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null;
  const outputTokens = Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null;
  const totalTokens = Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null;
  if (inputTokens === null && outputTokens === null && totalTokens === null) return null;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: Number.isFinite(Number(inputDetails.cached_tokens)) ? Number(inputDetails.cached_tokens) : null,
  };
}

function textFromContent(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const record = objectRecord(part);
    return typeof record.text === "string" ? [record.text] : typeof record.output_text === "string" ? [record.output_text] : [];
  });
}

function readResponseText(payload: unknown): string {
  const record = objectRecord(payload);
  if (typeof record.output_text === "string") return record.output_text.trim();
  if (!Array.isArray(record.output)) return "";
  return record.output.flatMap((item) => {
    const output = objectRecord(item);
    return textFromContent(output.content);
  }).join("\n").trim();
}

function readToolCalls(payload: unknown): AiToolCall[] {
  const record = objectRecord(payload);
  if (!Array.isArray(record.output)) return [];
  return record.output.flatMap((item) => {
    const output = objectRecord(item);
    if (output.type !== "function_call" || typeof output.call_id !== "string" || typeof output.name !== "string") return [];
    return [{ id: output.call_id, name: output.name, argumentsJson: typeof output.arguments === "string" ? output.arguments : "{}" }];
  });
}

function mapContentPart(part: AiContentPart): Record<string, unknown> {
  if (part.type === "text") return { type: "input_text", text: part.text };
  if (part.type === "image") {
    return part.source.kind === "url"
      ? { type: "input_image", image_url: part.source.value }
      : { type: "input_image", image_url: `data:${part.source.mediaType || "application/octet-stream"};base64,${part.source.value}` };
  }
  return {
    type: "input_file",
    file_url: part.source.kind === "url" ? part.source.value : undefined,
    file_data: part.source.kind === "base64" ? part.source.value : undefined,
    filename: part.source.name,
  };
}

function mapMessage(message: AiMessage): Record<string, unknown>[] {
  if (message.role === "tool") {
    if (!message.toolCallId) throw new AiAdapterError({ code: "invalid_request", message: "tool messageにtoolCallIdがありません。", retryable: false });
    return [{
      type: "function_call_output",
      call_id: message.toolCallId,
      output: message.content.map(mapContentPart),
    }];
  }
  const functionCalls = message.role === "assistant" && message.toolCalls?.length
    ? message.toolCalls.map((toolCall) => ({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.argumentsJson,
    }))
    : [];
  const messagePart = {
    role: message.role,
    content: message.content.map(mapContentPart),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolName ? { name: message.toolName } : {}),
  };
  return [...(message.content.length || !functionCalls.length ? [messagePart] : []), ...functionCalls];
}

function buildRequestBody(request: AiCanonicalRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    input: request.messages.flatMap(mapMessage),
    stream: request.stream,
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters }));
  }
  if (request.toolChoice) body.tool_choice = request.toolChoice;
  if (request.structuredOutput) {
    body.text = {
      format: {
        type: "json_schema",
        name: request.structuredOutput.name,
        schema: request.structuredOutput.schema,
        strict: request.structuredOutput.strict ?? true,
      },
    };
  }
  return body;
}

function endpointBase(context: AiAdapterContext): string {
  const raw = context.profile.endpoint || (context.profile.adapterKind === "openai-native" ? DEFAULT_OPENAI_BASE_URL : "");
  if (!raw) throw new AiAdapterError({ code: "invalid_request", message: "このadapterにはendpointが必要です。", retryable: false });
  const parsed = new URL(raw);
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (context.profile.adapterKind === "azure-openai") {
    if (!pathname.endsWith("/openai/v1")) pathname = `${pathname}/openai/v1`;
  }
  return `${parsed.origin}${pathname}`;
}

function authHeaders(context: AiAdapterContext): Record<string, string> {
  const credential = context.credential;
  if (context.profile.authKind !== "none" && !credential) {
    throw new AiAdapterError({ code: "missing_credential", message: "このprovider profileにcredentialが設定されていません。", retryable: false });
  }
  if (!credential) return {};
  if (context.profile.adapterKind === "azure-openai" && context.profile.authKind === "api_key") return { "api-key": credential };
  return { Authorization: `Bearer ${credential}` };
}

async function fetchWithTimeout(context: AiAdapterContext, input: string, init: RequestInit): Promise<Response> {
  if (context.signal?.aborted) throw new AiAdapterError({ code: "cancelled", message: "AI requestがキャンセルされました。", retryable: false });
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  context.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, context.timeoutMs);
  try {
    return await context.fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new AiAdapterError({ code: "timeout", message: "AI requestがタイムアウトしました。endpointとネットワークを確認してください。", retryable: true });
    if (context.signal?.aborted) throw new AiAdapterError({ code: "cancelled", message: "AI requestがキャンセルされました。", retryable: false });
    if (error instanceof AiAdapterError) throw error;
    throw new AiAdapterError({ code: "provider_failure", message: "providerへの接続に失敗しました。endpointとネットワークを確認してください。", retryable: true });
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", onAbort);
  }
}

async function readJsonWithTimeout(response: Response, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const cancellation = signal
      ? new Promise<never>((_, reject) => {
        onAbort = () => reject(new AiAdapterError({ code: "cancelled", message: "AI requestがキャンセルされました。", retryable: false }));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      })
      : null;
    return await Promise.race([
      response.json(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AiAdapterError({ code: "timeout", message: "provider responseがタイムアウトしました。", retryable: true })), timeoutMs);
      }),
      ...(cancellation ? [cancellation] : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function responseMetadata(payload: unknown, response: Response): AiRawMetadata {
  const record = objectRecord(payload);
  return {
    requestId: response.headers.get("x-request-id") || response.headers.get("request-id") || undefined,
    responseId: typeof record.id === "string" ? record.id : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    providerStatus: typeof record.status === "string" ? record.status : undefined,
  };
}

export class OpenAiResponsesAdapter implements AiAdapter {
  readonly capabilities: AiCapability[] = ["text", "streaming", "tool_calling", "parallel_tool_calling", "structured_output"];
  private readonly context: AiAdapterContext;

  constructor(context: AiAdapterContext) {
    this.context = context;
  }

  get kind() {
    return this.context.profile.adapterKind;
  }

  async complete(request: AiCanonicalRequest): Promise<AiResponse> {
    let response: Response;
    try {
      response = await fetchWithTimeout(this.context, `${endpointBase(this.context)}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(this.context) },
        body: JSON.stringify(buildRequestBody({ ...request, stream: false })),
      });
    } catch (error) {
      if (error instanceof AiAdapterError) throw error;
      throw new AiAdapterError({ code: "provider_failure", message: "providerへの接続に失敗しました。endpointとネットワークを確認してください。", retryable: true });
    }
    const payload = await readJsonWithTimeout(response, this.context.timeoutMs, this.context.signal).catch((error) => {
      if (error instanceof AiAdapterError) throw error;
      return null;
    }) as unknown;
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new AiAdapterError({
        code,
        message: redactProviderMessage(readErrorMessage(payload), this.context.credential) || `providerがHTTP ${response.status}を返しました。`,
        retryable: retryableForCode(code),
        httpStatus: response.status,
      });
    }
    return {
      text: readResponseText(payload),
      toolCalls: readToolCalls(payload),
      usage: readUsage(objectRecord(payload).usage),
      rawMetadata: responseMetadata(payload, response),
    };
  }

  async *stream(request: AiCanonicalRequest): AsyncIterable<AiStreamEvent> {
    let response: Response;
    try {
      response = await fetchWithTimeout(this.context, `${endpointBase(this.context)}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders(this.context) },
        body: JSON.stringify(buildRequestBody({ ...request, stream: true })),
      });
    } catch (error) {
      yield { type: "error", error: error instanceof AiAdapterError ? error.projection : { code: "provider_failure", message: "providerへの接続に失敗しました。", retryable: true } };
      return;
    }
    if (!response.ok) {
      const payload = await readJsonWithTimeout(response, this.context.timeoutMs).catch(() => null) as unknown;
      const code = errorCodeForStatus(response.status);
      yield { type: "error", error: { code, message: redactProviderMessage(readErrorMessage(payload), this.context.credential) || `providerがHTTP ${response.status}を返しました。`, retryable: retryableForCode(code), httpStatus: response.status } };
      return;
    }
    if (!response.body) {
      yield { type: "error", error: { code: "provider_failure", message: "stream responseにbodyがありません。", retryable: true } };
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    const toolCallsByItemId = new Map<string, { id: string; name: string }>();
    let messageStarted = false;
    let streamTimedOut = false;
    let streamCancelled = Boolean(this.context.signal?.aborted);
    const onAbort = () => {
      streamCancelled = true;
      void reader.cancel();
    };
    this.context.signal?.addEventListener("abort", onAbort, { once: true });
    const streamTimer = setTimeout(() => {
      streamTimedOut = true;
      void reader.cancel();
    }, this.context.timeoutMs);
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
          if (!line.startsWith("data:")) continue;
          const value = line.slice(5).trim();
          if (value === "[DONE]") continue;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(value) as Record<string, unknown>;
          } catch {
            yield { type: "error", error: { code: "provider_failure", message: "providerのstream eventが不正です。", retryable: false } };
            return;
          }
          const type = typeof payload.type === "string" ? payload.type : currentEvent;
          if ((type === "response.created" || type === "response.in_progress") && !messageStarted) {
            messageStarted = true;
            const responsePayload = objectRecord(payload.response);
            yield { type: "message_start", responseId: typeof responsePayload.id === "string" ? responsePayload.id : undefined, model: typeof responsePayload.model === "string" ? responsePayload.model : undefined };
          } else if (type === "response.output_item.added") {
            const item = objectRecord(payload.item);
            if (item.type === "function_call" && typeof item.name === "string") {
              const itemId = typeof item.id === "string" ? item.id : typeof item.call_id === "string" ? item.call_id : "";
              const callId = typeof item.call_id === "string" ? item.call_id : itemId;
              if (itemId && callId) {
                toolCallsByItemId.set(itemId, { id: callId, name: item.name });
                yield { type: "tool_call_start", id: callId, name: item.name };
              }
            }
          } else if (type === "response.output_text.delta") {
            if (typeof payload.delta === "string") yield { type: "text_delta", text: payload.delta };
          } else if (type === "response.function_call_arguments.delta") {
            const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
            const toolCall = toolCallsByItemId.get(itemId);
            const callId = toolCall?.id || (typeof payload.call_id === "string" ? payload.call_id : itemId);
            if (callId && typeof payload.delta === "string") yield { type: "tool_call_delta", id: callId, argumentsDelta: payload.delta };
          } else if (type === "response.function_call_arguments.done") {
            const itemId = typeof payload.item_id === "string" ? payload.item_id : "";
            const toolCall = toolCallsByItemId.get(itemId);
            const callId = toolCall?.id || (typeof payload.call_id === "string" ? payload.call_id : itemId);
            if (callId) yield { type: "tool_call_end", id: callId };
          } else if (type === "response.completed") {
            const responsePayload = objectRecord(payload.response);
            const usage = readUsage(responsePayload.usage);
            if (usage) yield { type: "usage", usage };
            yield { type: "message_end", responseId: typeof responsePayload.id === "string" ? responsePayload.id : undefined, finishReason: typeof responsePayload.status === "string" ? responsePayload.status : undefined };
          } else if (type === "error" || type === "response.failed") {
            const error = objectRecord(payload.error);
            yield { type: "error", error: { code: "provider_failure", message: redactProviderMessage(typeof error.message === "string" ? error.message.slice(0, 500) : "providerがstreamを終了しました。", this.context.credential), retryable: true } };
          }
          currentEvent = "";
        }
        if (chunk.done) break;
      }
      if (streamCancelled) yield { type: "error", error: { code: "cancelled", message: "AI streamがキャンセルされました。", retryable: false } };
      else if (streamTimedOut) yield { type: "error", error: { code: "timeout", message: "AI streamがタイムアウトしました。", retryable: true } };
    } catch (error) {
      yield { type: "error", error: streamCancelled ? { code: "cancelled", message: "AI streamがキャンセルされました。", retryable: false } : streamTimedOut ? { code: "timeout", message: "AI streamがタイムアウトしました。", retryable: true } : error instanceof AiAdapterError ? error.projection : { code: "provider_failure", message: "providerのstreamを読み取れませんでした。", retryable: true } };
    } finally {
      clearTimeout(streamTimer);
      this.context.signal?.removeEventListener("abort", onAbort);
      reader.releaseLock();
    }
  }

  async testConnection(model?: string): Promise<AiAdapterConnectionResult> {
    let response: Response;
    try {
      response = await fetchWithTimeout(this.context, `${endpointBase(this.context)}/models`, { headers: authHeaders(this.context) });
    } catch (error) {
      if (error instanceof AiAdapterError) throw error;
      throw new AiAdapterError({ code: "provider_failure", message: "providerへの接続に失敗しました。endpointとネットワークを確認してください。", retryable: true });
    }
    const payload = await readJsonWithTimeout(response, this.context.timeoutMs, this.context.signal).catch((error) => {
      if (error instanceof AiAdapterError) throw error;
      return null;
    }) as unknown;
    if (!response.ok) {
      const code = errorCodeForStatus(response.status);
      throw new AiAdapterError({ code, message: redactProviderMessage(readErrorMessage(payload), this.context.credential) || `providerがHTTP ${response.status}を返しました。`, retryable: retryableForCode(code), httpStatus: response.status });
    }
    if (model) {
      const models = objectRecord(payload).data;
      if (!Array.isArray(models) || !models.some((entry) => objectRecord(entry).id === model)) {
        const label = this.context.profile.adapterKind === "azure-openai" ? `deployment「${model}」` : `model「${model}」`;
        return { status: "model_unavailable", capabilities: this.capabilities, message: `${label}はこのproviderで利用できません。provider接続は確認しましたが、指定値は確認できませんでした。`, httpStatus: 404 };
      }
    }
    return { status: "connected", capabilities: this.capabilities, message: "接続できました。" };
  }
}

export class UnsupportedAiAdapter implements AiAdapter {
  readonly capabilities: AiCapability[] = [];
  private readonly context: AiAdapterContext;

  constructor(context: AiAdapterContext) {
    this.context = context;
  }

  get kind() {
    return this.context.profile.adapterKind;
  }

  async complete(): Promise<AiResponse> {
    throw new AiAdapterError({ code: "unsupported", message: `${this.context.profile.adapterKind} adapterは未実装です。接続成功とは表示しません。`, retryable: false });
  }

  async *stream(): AsyncIterable<AiStreamEvent> {
    yield { type: "error", error: { code: "unsupported", message: `${this.context.profile.adapterKind} adapterは未実装です。`, retryable: false } };
  }

  async testConnection(): Promise<AiAdapterConnectionResult> {
    throw new AiAdapterError({ code: "unsupported", message: `${this.context.profile.adapterKind} adapterは未実装です。`, retryable: false });
  }
}
