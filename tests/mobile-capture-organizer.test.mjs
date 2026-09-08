import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/main/gateway/mobile/captureOrganizer.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { createCaptureOrganizerFromEnvironment: create } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const secret = "fake-private-api-key";
const env = (provider = "openai", model = "test-model") => ({
  TASKEN_CAPTURE_LLM_PROVIDER: provider,
  TASKEN_CAPTURE_LLM_MODEL: model,
  TASKEN_CAPTURE_LLM_API_KEY: secret,
  TASKEN_CAPTURE_LLM_VOCABULARY: "Tasken\n固有語,Galaxy",
});
const input = {
  text: "明日は牛乳と卵を買う。",
  capturedAt: "2026-09-05T15:30:00Z",
  timeZone: "Asia/Tokyo",
  themeId: "home",
  themes: [{ id: "home", title: "生活" }],
};
const proposal = {
  title: "牛乳と卵を買う",
  themeId: "home",
  startDate: "2026-09-07",
  endDate: null,
  rangeSemantics: null,
  checklist: ["牛乳", "卵"],
  supplement: "",
  warnings: [],
};
const batch = (tasks = [proposal], warnings = []) => ({ tasks, warnings });
const chat = (value = batch()) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
});
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

test("work-log organization preserves whole uncertain sentences and permits zero actions", async () => {
  const cases = [
    [
      "調査を始めたがまだ途中。",
      { done: [], observations: [], unresolved: ["調査を始めたがまだ途中。"], nextActions: [] },
    ],
    [
      "条件Aで試したが失敗した。",
      { done: ["条件Aで試したが失敗した。"], observations: [], unresolved: [], nextActions: [] },
    ],
    [
      "原因は温度が怪しい。",
      { done: [], observations: [], unresolved: ["原因は温度が怪しい。"], nextActions: [] },
    ],
    [
      "今日は疲れた。",
      { done: [], observations: ["今日は疲れた。"], unresolved: [], nextActions: [] },
    ],
    [
      "結果を眺めた。次の行動は決めていない。",
      {
        done: ["結果を眺めた。"],
        observations: [],
        unresolved: ["次の行動は決めていない。"],
        nextActions: [],
      },
    ],
  ];
  for (const [source, proposal] of cases) {
    const organizer = create(env(), async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.response_format.json_schema.name, "work_log_organization");
      assert.match(body.messages[0].content, /never rewrite it as 原因と判明/);
      return json(chat(proposal));
    });
    assert.deepEqual(await organizer.organizeWorkLog(source), proposal);
  }
  const source = "原因と判明していない。温度が怪しい。";
  for (const invented of ["原因と判明", "温度が原因と判明。", "30分で完了。", "2026-09-09に実施。"])
    await assert.rejects(
      create(env(), async () =>
        json(chat({ done: [invented], observations: [], unresolved: [], nextActions: [] })),
      ).organizeWorkLog(source),
    );
});

test("fixed planned-time cases preserve provider fields and the capture-day anchor after midnight", async (t) => {
  // Fixed model responses verify the wire contract and retention, not model inference quality.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T00:10:00Z") });
  const cases = [
    {
      text: "明日15時30分から30分、条件を確認",
      startDate: "2026-09-07",
      plannedStartTime: "15:30",
      plannedDurationMinutes: 30,
    },
    {
      text: "明日15時、いや16時に条件を確認",
      startDate: "2026-09-07",
      plannedStartTime: "16:00",
      plannedDurationMinutes: null,
    },
    {
      text: "条件の確認は30分",
      startDate: null,
      plannedStartTime: null,
      plannedDurationMinutes: 30,
    },
    {
      text: "条件を確認する",
      startDate: null,
      plannedStartTime: null,
      plannedDurationMinutes: null,
    },
    {
      text: "明日の午後に条件を確認",
      startDate: "2026-09-07",
      plannedStartTime: null,
      plannedDurationMinutes: null,
      warnings: ["午後の開始時刻は未指定です"],
    },
    {
      text: "金曜17時までに提出",
      startDate: null,
      endDate: "2026-09-11",
      plannedStartTime: null,
      plannedDurationMinutes: null,
      supplement: "金曜17時は提出期限",
      warnings: ["期限時刻は補足に保持しています"],
    },
  ];
  for (const { text, ...fields } of cases) {
    const expected = {
      ...proposal,
      title: text,
      startDate: null,
      endDate: null,
      checklist: [],
      supplement: "",
      warnings: [],
      ...fields,
    };
    const capturedAt = "2026-09-06T14:59:00Z";
    const organizer = create(env(), async (_target, options) => {
      const data = JSON.parse(JSON.parse(options.body).messages[1].content);
      assert.equal(data.text, text);
      assert.equal(data.capturedAt, capturedAt);
      assert.equal(data.timeZone, "Asia/Tokyo");
      assert.equal(data.capturedLocalDate, "2026-09-06");
      assert.equal(data.capturedLocalTime, "23:59:00");
      assert.equal(data.relativeDateAnchors.tomorrow, "2026-09-07");
      return json(chat(batch([expected])));
    });
    assert.deepEqual(
      await organizer.organize({ ...input, text, capturedAt, includePlannedTime: true }),
      batch([expected]),
    );
  }
});

for (const provider of ["openai", "gemini"]) {
  test(`${provider} planned-time schema requires nullable fields and rejects malformed model values`, async () => {
    let result = { ...proposal, plannedStartTime: "16:00", plannedDurationMinutes: 90 };
    const organizer = create(env(provider), async (_target, options) => {
      const request = JSON.parse(options.body);
      const schema =
        provider === "gemini"
          ? request.generationConfig.responseJsonSchema
          : request.response_format.json_schema.schema;
      const instructions =
        provider === "gemini"
          ? request.systemInstruction.parts[0].text
          : request.messages[0].content;
      assert.ok(schema.properties.tasks.items.required.includes("plannedStartTime"));
      assert.ok(schema.properties.tasks.items.required.includes("plannedDurationMinutes"));
      assert.deepEqual(schema.properties.tasks.items.properties.plannedStartTime.type, [
        "string",
        "null",
      ]);
      assert.match(instructions, /not a deadline time/);
      assert.match(instructions, /never estimate effort/);
      assert.match(instructions, /15時、いや16時/);
      const value = batch([result]);
      return json(
        provider === "gemini"
          ? {
              candidates: [
                { finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } },
              ],
            }
          : chat(value),
      );
    });
    const timedInput = { ...input, includePlannedTime: true };
    assert.deepEqual(await organizer.organize(timedInput), batch([result]));
    result = { ...proposal, plannedStartTime: null, plannedDurationMinutes: null };
    assert.deepEqual(await organizer.organize(timedInput), batch([result]));
    for (const invalid of [
      { plannedStartTime: "24:00" },
      { plannedStartTime: "16:60" },
      { plannedStartTime: "午後" },
      { plannedDurationMinutes: 0 },
      { plannedDurationMinutes: 1.5 },
      { plannedDurationMinutes: 10081 },
      { plannedDurationMinutes: "90" },
    ]) {
      result = { ...proposal, plannedStartTime: null, plannedDurationMinutes: null, ...invalid };
      await assert.rejects(organizer.organize(timedInput), /原文は保持/);
    }
    result = proposal;
    await assert.rejects(organizer.organize(timedInput), /原文は保持/);
  });
}

test("unset provider, key or model leaves organizer disabled without network", () => {
  for (const name of [
    "TASKEN_CAPTURE_LLM_PROVIDER",
    "TASKEN_CAPTURE_LLM_MODEL",
    "TASKEN_CAPTURE_LLM_API_KEY",
  ]) {
    assert.equal(
      create({ ...env(), [name]: "" }, () => assert.fail("network")),
      null,
    );
  }
});

for (const [provider, model, url, label] of [
  ["openai", "test-model", "https://api.openai.com/v1/chat/completions", "OpenAI"],
  [
    "azure",
    "deployment",
    "https://test-resource.openai.azure.com/openai/v1/chat/completions",
    "Azure OpenAI",
  ],
  ["opencode-zen", "kimi-k2.6", "https://opencode.ai/zen/v1/chat/completions", "OpenCode Zen"],
  ["opencode-go", "glm-5.3", "https://opencode.ai/zen/go/v1/chat/completions", "OpenCode Go"],
]) {
  test(`${provider} sends schema, separate untrusted data, recording-local day and bounded request`, async () => {
    let request;
    const organizer = create(
      {
        ...env(provider, model),
        TASKEN_CAPTURE_LLM_ENDPOINT: "https://test-resource.openai.azure.com/",
      },
      async (target, options) => {
        request = options;
        assert.equal(target, url);
        assert.equal(options.redirect, "error");
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, `Bearer ${secret}`);
        assert.ok(options.signal instanceof AbortSignal);
        const body = JSON.parse(options.body);
        assert.equal(body.model, model);
        assert.equal(body.response_format.type, "json_schema");
        assert.equal(body.response_format.json_schema.strict, true);
        assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
        assert.deepEqual(
          body.response_format.json_schema.schema.properties.tasks.items.properties.themeId.enum,
          [null, "home"],
        );
        assert.match(body.messages[0].content, /no date reference/);
        assert.equal(body.messages[1].role, "user");
        const data = JSON.parse(body.messages[1].content);
        assert.equal(data.capturedLocalDate, "2026-09-06");
        assert.equal(data.capturedLocalTime, "00:30:00");
        assert.equal(data.capturedLocalWeekday, "Sunday");
        assert.deepEqual(data.relativeDateAnchors, {
          today: "2026-09-06",
          tomorrow: "2026-09-07",
          dayAfterTomorrow: "2026-09-08",
        });
        assert.deepEqual(data.calendarAnchors.slice(0, 7), [
          { date: "2026-09-06", weekday: "Sunday" },
          { date: "2026-09-07", weekday: "Monday" },
          { date: "2026-09-08", weekday: "Tuesday" },
          { date: "2026-09-09", weekday: "Wednesday" },
          { date: "2026-09-10", weekday: "Thursday" },
          { date: "2026-09-11", weekday: "Friday" },
          { date: "2026-09-12", weekday: "Saturday" },
        ]);
        assert.deepEqual(data.vocabulary, ["Tasken", "固有語", "Galaxy"]);
        assert.equal(data.text, input.text);
        assert.ok(!options.body.includes(secret));
        return json(chat());
      },
    );
    assert.equal(organizer.providerLabel, label);
    assert.deepEqual(await organizer.organize(input), batch());
    assert.equal(request.signal.aborted, true);
  });
}

test("Gemini uses native generateContent schema and header authentication", async () => {
  const organizer = create(env("gemini", "gemini-test"), async (url, options) => {
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    assert.equal(options.headers["x-goog-api-key"], secret);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseJsonSchema.type, "object");
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).capturedLocalDate, "2026-09-06");
    return json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [{ thought: true, text: "not the answer" }, { text: JSON.stringify(batch()) }],
          },
        },
      ],
    });
  });
  assert.equal(organizer.providerLabel, "Gemini");
  assert.deepEqual(await organizer.organize(input), batch());
});

test("invalid Azure origins and other OpenCode wire models fail before network without exposing settings", () => {
  for (const endpoint of [
    "http://test.openai.azure.com",
    "https://127.0.0.1",
    "https://test.openai.azure.com.evil.test",
    `https://${secret}@test.openai.azure.com`,
    "https://test.openai.azure.com/openai/v1/",
    `https://test.openai.azure.com/?key=${secret}`,
    "https://test.openai.azure.com:8443",
  ]) {
    assert.throws(
      () => create({ ...env("azure"), TASKEN_CAPTURE_LLM_ENDPOINT: endpoint }),
      (error) => {
        assert.ok(!String(error).includes(endpoint));
        assert.ok(!String(error).includes(secret));
        return true;
      },
    );
  }
  for (const [provider, model] of [
    ["unknown", secret],
    ["openai", "../path"],
    ["opencode-zen", "gpt-5.4"],
    ["opencode-go", "minimax-m3"],
  ]) {
    assert.throws(() => create(env(provider, model)), /設定が無効/);
  }
});

test("invalid request does not transmit and error does not quote input", async () => {
  const organizer = create(env(), async () => assert.fail("invalid input transmitted"));
  for (const data of [
    { ...input, text: "" },
    { ...input, text: secret.repeat(1000) },
    { ...input, capturedAt: "not-a-date" },
    { ...input, timeZone: secret },
    { ...input, themeId: "missing" },
    { ...input, themes: [...input.themes, ...input.themes] },
  ]) {
    await assert.rejects(organizer.organize(data), (error) => {
      assert.ok(!String(error).includes(secret));
      return /AIで整理できませんでした/.test(String(error));
    });
  }
});

test("recording time, not request time, anchors tomorrow across local month boundaries", async () => {
  let data;
  const organizer = create(env(), async (_url, options) => {
    data = JSON.parse(JSON.parse(options.body).messages[1].content);
    return json(chat(batch([{ ...proposal, startDate: null }])));
  });
  for (const [timeZone, today, tomorrow] of [
    ["Asia/Tokyo", "2026-10-01", "2026-10-02"],
    ["America/Los_Angeles", "2026-09-30", "2026-10-01"],
  ]) {
    await organizer.organize({
      ...input,
      text: "明日、牛乳を買う",
      capturedAt: "2026-09-30T15:30:00Z",
      timeZone,
    });
    assert.equal(data.relativeDateAnchors.today, today);
    assert.equal(data.relativeDateAnchors.tomorrow, tomorrow);
    assert.equal(
      data.calendarAnchors[14].date,
      timeZone === "Asia/Tokyo" ? "2026-10-15" : "2026-10-14",
    );
  }
});

test("reported September 6 shopping capture grounds tomorrow as September 7", async () => {
  const organizer = create(env(), async (_url, options) => {
    const body = JSON.parse(options.body);
    const data = JSON.parse(body.messages[1].content);
    assert.equal(data.capturedLocalDate, "2026-09-06");
    assert.equal(data.capturedLocalTime, "02:14:04");
    assert.equal(data.relativeDateAnchors.tomorrow, "2026-09-07");
    assert.deepEqual(
      data.calendarAnchors.find(({ date }) => date === "2026-09-10"),
      {
        date: "2026-09-10",
        weekday: "Thursday",
      },
    );
    return json(chat(batch([{ ...proposal, startDate: "2026-09-07" }])));
  });
  await organizer.organize({
    ...input,
    text: "明日の帰りに牛乳、コーヒー豆、洗剤を買う",
    capturedAt: "2026-09-05T17:14:04.735Z",
  });
});

test("multiple proposals require an explicit batch limit and every proposal is validated", async () => {
  const tasks = [proposal, { ...proposal, title: "会場を予約", themeId: null }];
  const organizer = create(env(), async () => json(chat(batch(tasks))));
  await assert.rejects(organizer.organize(input), /AIで整理できませんでした/);
  assert.deepEqual(await organizer.organize({ ...input, maxTasks: 8 }), batch(tasks));
  const invalid = create(env(), async () =>
    json(chat(batch([proposal, { ...tasks[1], startDate: "2026-02-30" }]))),
  );
  await assert.rejects(invalid.organize({ ...input, maxTasks: 8 }), /AIで整理できませんでした/);
});

test("strict local validation rejects invalid dates, foreign themes, bounds and extra properties", async () => {
  for (const changes of [
    { startDate: "2026-02-30" },
    { startDate: "2026-2-03" },
    { startDate: "2026-09-10", endDate: "2026-09-01" },
    { rangeSemantics: "ongoing" },
    { endDate: proposal.startDate, rangeSemantics: "ongoing" },
    { rangeSemantics: "invented" },
    { themeId: "not-a-candidate" },
    { title: " " },
    { title: "a".repeat(501) },
    { checklist: Array(21).fill("item") },
    { checklist: ["a".repeat(201)] },
    { checklist: [" "] },
    { supplement: "a".repeat(12001) },
    { warnings: Array(11).fill("warning") },
    { extra: true },
  ]) {
    const organizer = create(env(), async () => json(chat(batch([{ ...proposal, ...changes }]))));
    await assert.rejects(organizer.organize(input), /AIで整理できませんでした/);
  }
  const minimal = {
    ...proposal,
    themeId: null,
    startDate: null,
    endDate: null,
    checklist: [],
  };
  assert.deepEqual(
    await create(env(), async () => json(chat(batch([minimal])))).organize(input),
    batch([minimal]),
  );
});

test("provider refusals, truncation, JSON errors and raw failures stay sanitized", async () => {
  for (const payload of [
    {
      choices: [{ finish_reason: "stop", message: { refusal: secret, content: "" } }],
    },
    {
      choices: [
        {
          finish_reason: "length",
          message: { content: JSON.stringify(batch()) },
        },
      ],
    },
    { choices: [{ finish_reason: "stop", message: { content: secret } }] },
    { error: { message: secret } },
  ]) {
    await assert.rejects(create(env(), async () => json(payload)).organize(input), (error) => {
      assert.ok(!String(error).includes(secret));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  for (const fetcher of [
    async () => new Response(secret, { status: 401 }),
    async () =>
      new Response(secret, {
        status: 302,
        headers: { location: `https://evil.test/${secret}` },
      }),
    async () => {
      throw new Error(`request with ${secret} failed`);
    },
  ]) {
    await assert.rejects(
      create(env(), fetcher).organize(input),
      (error) => !String(error).includes(secret),
    );
  }
  for (const payload of [
    {
      candidates: [
        {
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: JSON.stringify(batch()) }] },
        },
      ],
    },
    { promptFeedback: { blockReason: "SAFETY" } },
  ]) {
    await assert.rejects(
      create(env("gemini"), async () => json(payload)).organize(input),
      /AIで整理できませんでした/,
    );
  }
});

test("oversized declared and streamed responses are rejected and body is cancelled", async () => {
  await assert.rejects(
    create(
      env(),
      async () =>
        new Response("{}", {
          headers: { "content-length": String(256 * 1024 + 1) },
        }),
    ).organize(input),
  );
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(128 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(create(env(), async () => new Response(stream)).organize(input));
  assert.equal(cancelled, true);
});

test("request is aborted after 30 seconds without exposing provider errors", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const organizer = create(env(), async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error(secret))),
    );
  });
  const pending = organizer.organize(input);
  const rejection = assert.rejects(pending, (error) => !String(error).includes(secret));
  context.mock.timers.tick(29_999);
  assert.equal(signal.aborted, false);
  context.mock.timers.tick(1);
  await rejection;
  assert.equal(signal.aborted, true);
});
