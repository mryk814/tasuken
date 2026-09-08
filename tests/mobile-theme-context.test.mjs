import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { createMobileOfflineGateway } from "./helpers/mobile-offline-gateway.mjs";

const bundle = await build({
  stdin: {
    contents: `export { MobileGatewayAdapter } from './src/main/gateway/mobile/mobileGatewayAdapter.ts';
      export { createMobileThemeContextReadPort } from './src/main/composition/mobileThemeContextReadPort.ts';
      export { mobileThemeContextResponseSchema } from './src/shared/contracts/mobile/public.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { MobileGatewayAdapter, createMobileThemeContextReadPort, mobileThemeContextResponseSchema } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
const golden = JSON.parse(
  readFileSync(
    new URL("../contracts/mobile/v1/theme-context-response.golden.json", import.meta.url),
    "utf8",
  ),
);

function fixture() {
  const expected = golden.data.theme;
  const theme = {
    id: expected.id,
    name: expected.title,
    version: expected.version,
    updated_at: expected.updatedAt,
    theme_charter: structuredClone(expected.charter),
    theme_state: structuredClone(expected.currentState),
    ai_visibility: [],
    source_locator: "C:/private/document",
    secret: "hidden-secret",
    color: "chart-3",
  };
  const port = createMobileThemeContextReadPort({
    get: (type, id) => (type === "theme" && id === theme.id && !theme.deleted_at ? theme : null),
  });
  const core = {
    status: () => ({ apiVersion: "1", capabilities: ["task.query", "task.command"] }),
    getThemeContext: port,
    listThemes: () => [{ id: theme.id, name: theme.name, color: theme.color }],
  };
  const adapter = new MobileGatewayAdapter({ core, state: { current: () => golden.meta } });
  const request = (query = {}, options = {}) =>
    adapter.handle({
      method: "GET",
      path: "/v1/theme-context",
      query: { apiVersion: "1", schemaVersion: "7", themeId: theme.id, ...query },
      principal: { kind: "mobile_device", deviceId: "phone", scopes: ["mobile:read"] },
      ...options,
    });
  return { theme, core, request };
}

test("paired owner reads canonical Theme intent regardless of AI policy with Kotlin golden parity", async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(mobileThemeContextResponseSchema.parse(response.body), golden);
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /source_locator|hidden-secret|ai_visibility|color/,
  );
  const health = await f.request({}, { path: "/v1/health", query: {} });
  assert.ok(health.body.data.capabilities.includes("mobile.theme-context.read"));
});

test("Theme detail is read-only, strict, owner-scoped and optional on older Core ports", async () => {
  const f = fixture();
  assert.equal((await f.request({}, { principal: null })).status, 401);
  assert.equal(
    (
      await f.request(
        {},
        {
          principal: { kind: "mobile_device", deviceId: "phone", scopes: ["mobile:context-read"] },
        },
      )
    ).status,
    403,
  );
  assert.equal((await f.request({}, { method: "POST", body: {} })).status, 405);
  for (const query of [{ themeId: "" }, { locator: "file:///secret" }, { apiVersion: "999" }]) {
    assert.equal((await f.request(query)).status, 400);
  }
  delete f.core.getThemeContext;
  assert.equal((await f.request()).body.error.code, "capability_unavailable");
  const catalog = await f.request(
    {},
    { path: "/v1/themes", query: { apiVersion: "1", schemaVersion: "7", requestId: "catalog" } },
  );
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.body.data.themes, [{ id: f.theme.id, title: f.theme.name }]);
  const colored = await f.request(
    {},
    {
      path: "/v1/themes",
      query: { apiVersion: "1", schemaVersion: "7", requestId: "colored", includeColors: "true" },
    },
  );
  assert.equal(colored.body.data.themes[0].color, "chart-3");
});

test("unset and deleted Theme remain distinct; canonical bounds retain long content without AI truncation", async () => {
  const f = fixture();
  f.theme.theme_charter = null;
  f.theme.theme_state = null;
  assert.equal((await f.request()).body.data.status, "available");
  assert.equal((await f.request()).body.data.theme.charter, null);
  f.theme.theme_charter = {
    purpose: "測".repeat(8000),
    principles: Array.from({ length: 20 }, (_, i) => `${i}${"条".repeat(996)}`),
  };
  let response = (await f.request()).body;
  assert.equal(response.data.theme.charter.purpose.length, 8000);
  assert.equal(response.data.theme.charter.principles.length, 20);
  assert.equal(response.meta.truncated, false);
  f.theme.deleted_at = "2026-09-06T09:00:00Z";
  response = (await f.request()).body;
  assert.deepEqual(response.data, { themeId: f.theme.id, status: "not_found", theme: null });
});

test("Desktop update survives real SQLite restart and received deletion has no old Theme body", async () => {
  const gateway = await createMobileOfflineGateway();
  try {
    const read = async () => {
      const response = await fetch(
        `${gateway.config.origin}/v1/theme-context?apiVersion=1&schemaVersion=7&themeId=theme-context-fixture`,
        { headers: { authorization: `Bearer ${gateway.config.accessToken}` } },
      );
      assert.equal(response.status, 200);
      return mobileThemeContextResponseSchema.parse(await response.json());
    };
    await gateway.control({ themeContextPhase: "initial" });
    assert.equal((await read()).data.theme.charter.purpose, golden.data.theme.charter.purpose);
    await gateway.control({ themeContextPhase: "updated" });
    const updated = await read();
    assert.equal(
      updated.data.theme.currentState.current_direction,
      "濃度と温度を分けて再測定する。",
    );
    await gateway.control({ restartDesktop: true });
    const restarted = await read();
    assert.deepEqual(restarted.data.theme.charter, updated.data.theme.charter);
    assert.deepEqual(restarted.data.theme.currentState, updated.data.theme.currentState);
    await gateway.control({ themeContextPhase: "deleted" });
    assert.deepEqual((await read()).data, {
      themeId: "theme-context-fixture",
      status: "not_found",
      theme: null,
    });
  } finally {
    await gateway.close();
  }
});
