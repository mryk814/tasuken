import assert from "node:assert/strict";
import test from "node:test";

import { AiAdapterError, OpenAiResponsesAdapter } from "../src/main/services/ai/adapters.ts";
import { adapterCapabilities, resolveFeatureAvailability } from "../src/main/services/ai/capabilities.ts";

function profile(overrides = {}) {
  return {
    id: "provider-1",
    label: "Fixture OpenAI",
    adapterKind: "openai-compatible",
    authKind: "api_key",
    endpoint: "https://fixture.example/v1",
    organization: null,
    project: null,
    region: null,
    deployment: null,
    apiSurface: "responses",
    endpointExposure: "external",
    requestTimeoutMs: 120000,
    enabled: true,
    credentialConfigured: true,
    adapterStatus: "implemented",
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    model: "fixture-model",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    stream: false,
    ...overrides,
  };
}

test("Responses adapter maps canonical request and keeps credentials in Main headers", async () => {
  let seen;
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 1000,
    fetcher: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({
        id: "resp-1",
        model: "fixture-model",
        output_text: "result",
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-1" } });
    },
  });

  const result = await adapter.complete(request({
    tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
    structuredOutput: { name: "answer", schema: { type: "object" }, strict: true },
  }));
  const body = JSON.parse(seen.init.body);
  assert.equal(seen.url, "https://fixture.example/v1/responses");
  assert.equal(seen.init.headers.Authorization, "Bearer fixture-secret");
  assert.equal(body.input[0].content[0].type, "input_text");
  assert.equal(body.tools[0].name, "lookup");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(result.text, "result");
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 2, totalTokens: 5, cachedInputTokens: null });
  assert.equal(result.rawMetadata.requestId, "req-1");
});

test("Responses stream projects text, tool deltas, usage and malformed event errors", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"r\"}}\n\n"));
      controller.enqueue(encoder.encode("event: response.in_progress\ndata: {\"type\":\"response.in_progress\",\"response\":{\"id\":\"r\"}}\n\n"));
      controller.enqueue(encoder.encode("data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\n\n"));
      controller.enqueue(encoder.encode("data: {bad-json}\n\n"));
      controller.close();
    },
  });
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 1000,
    fetcher: async () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const events = [];
  for await (const event of adapter.stream(request({ stream: true }))) events.push(event);
  assert.equal(events[0].type, "message_start");
  assert.equal(events.filter((event) => event.type === "message_start").length, 1);
  assert.deepEqual(events[1], { type: "text_delta", text: "Hi" });
  assert.equal(events[2].type, "error");
  assert.equal(events[2].error.retryable, false);
});

test("Responses tool round-trip maps function_call_output and correlates streamed item_id", async () => {
  let completeSeen;
  let streamSeen;
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 1000,
    fetcher: async (url, init) => {
      if (init.headers.Accept === "text/event-stream") streamSeen = { url, init };
      else completeSeen = { url, init };
      if (init.headers.Accept !== "text/event-stream") return new Response(JSON.stringify({ output_text: "ok" }), { status: 200 });
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode([
            "event: response.output_item.added",
            `data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "function_call", id: "item-1", call_id: "call-1", name: "lookup" } })}`,
            "",
            `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":' })}`,
            "",
            `data: ${JSON.stringify({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"q":"x"}' })}`,
            "",
          ].join("\n")));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  await adapter.complete(request({
    messages: [
      { role: "assistant", content: [], toolCalls: [{ id: "call-1", name: "lookup", argumentsJson: "{\"q\":\"x\"}" }] },
      { role: "tool", toolCallId: "call-1", content: [{ type: "text", text: "result" }] },
    ],
  }));
  assert.equal(completeSeen.url, "https://fixture.example/v1/responses");
  const body = JSON.parse(completeSeen.init.body);
  assert.deepEqual(body.input[0], { type: "function_call", call_id: "call-1", name: "lookup", arguments: "{\"q\":\"x\"}" });
  assert.deepEqual(body.input[1], { type: "function_call_output", call_id: "call-1", output: [{ type: "input_text", text: "result" }] });

  const events = [];
  for await (const event of adapter.stream(request({ stream: true }))) events.push(event);
  assert.deepEqual(events.slice(0, 3), [
    { type: "tool_call_start", id: "call-1", name: "lookup" },
    { type: "tool_call_delta", id: "call-1", argumentsDelta: '{"q":' },
    { type: "tool_call_end", id: "call-1" },
  ]);
  assert.equal(streamSeen.url, "https://fixture.example/v1/responses");
});

test("Responses stream redacts credentials from non-2xx provider error projections", async () => {
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 1000,
    fetcher: async () => new Response(JSON.stringify({ error: { message: "invalid fixture-secret" } }), { status: 401 }),
  });
  const events = [];
  for await (const event of adapter.stream(request({ stream: true }))) events.push(event);
  assert.equal(events[0].type, "error");
  assert.equal(events[0].error.message.includes("fixture-secret"), false);
  assert.equal(events[0].error.message.includes("[REDACTED]"), true);
});

test("Responses stream cancellation is normalized after headers arrive", async () => {
  const controller = new AbortController();
  const body = new ReadableStream({ start() {} });
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 1000,
    signal: controller.signal,
    fetcher: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const events = [];
  const consume = (async () => {
    for await (const event of adapter.stream(request({ stream: true }))) events.push(event);
  })();
  setTimeout(() => controller.abort(), 5);
  await consume;
  assert.deepEqual(events.at(-1), { type: "error", error: { code: "cancelled", message: "AI streamがキャンセルされました。", retryable: false } });
});

test("Responses stream cancels its reader when AbortSignal fires between fetch and reader listener", async () => {
  const controller = new AbortController();
  let readerCancelled = false;
  const body = new ReadableStream({
    start() {},
    cancel() { readerCancelled = true; },
  });
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 1000,
    signal: controller.signal,
    fetcher: async () => {
      controller.abort();
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  const events = [];
  for await (const event of adapter.stream(request({ stream: true }))) events.push(event);
  assert.equal(readerCancelled, true);
  assert.deepEqual(events.at(-1), { type: "error", error: { code: "cancelled", message: "AI streamがキャンセルされました。", retryable: false } });
});

test("capability resolver intersects model claims with implemented adapter surface", () => {
  const provider = profile();
  const model = {
    id: "model-1",
    providerProfileId: provider.id,
    model: "fixture-model",
    displayName: "Fixture",
    capabilities: ["text", "vision"],
    contextLimit: null,
    outputLimit: null,
    costHint: null,
    lifecycle: "available",
  };
  assert.equal(adapterCapabilities("openai-compatible", "responses").includes("text"), true);
  assert.equal(adapterCapabilities("openai-compatible", "chat_completions").length, 0);
  assert.equal(adapterCapabilities("anthropic", "native").length, 0);
  assert.equal(resolveFeatureAvailability("vision", provider, model).available, false);
  assert.equal(resolveFeatureAvailability("note_assistant", provider, model).available, true);
  assert.equal(resolveFeatureAvailability("note_assistant", { ...provider, apiSurface: "chat_completions", adapterStatus: "planned" }, model).available, false);
});

test("adapter timeout is bounded and normalized", async () => {
  const adapter = new OpenAiResponsesAdapter({
    profile: profile(),
    credential: "fixture-secret",
    timeoutMs: 10,
    fetcher: async (_url, init) => await new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  await assert.rejects(() => adapter.complete(request()), (error) => {
    assert.ok(error instanceof AiAdapterError);
    assert.equal(error.projection.code, "timeout");
    return true;
  });
});
