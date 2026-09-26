import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyClientCheck,
  clientIdFingerprint,
  resolveClientId,
  runClientCheck,
} from "../scripts/calendar-client-check.mjs";

/**
 * Google OAuthクライアントの種類判定（#273のM単位）。
 *
 * 実測（2026-09-26）: Googleは「デスクトップ アプリ」種別でもtoken交換にsecretを要求し、
 * secret無しだと `client_secret is missing.` を返す。この文言は「Web アプリ種別だから」では
 * なく「secretを送っていないから」を意味するため、種別の判定には使わない。
 * 秘密情報は扱わない（本文も残さない）。
 */
test("secretが無いと言われても種別はデスクトップのまま扱い、secret設定を案内する", () => {
  const result = classifyClientCheck({
    status: 400,
    body: '{ "error": "invalid_request", "error_description": "client_secret is missing." }',
  });
  assert.equal(result.kind, "public_client");
  assert.equal(result.oauthError, "invalid_request");
  assert.match(result.guidance, /TASKEN_GOOGLE_CLIENT_SECRET/u);
});

test("無効なcodeが拒否されたらデスクトップ アプリ種別として扱う", () => {
  const result = classifyClientCheck({
    status: 400,
    body: JSON.stringify({ error: "invalid_grant", error_description: "Malformed auth code." }),
  });
  assert.equal(result.kind, "public_client");
  assert.equal(result.oauthError, "invalid_grant");
});

test("登録の無いclient IDはそれとして伝える", () => {
  const result = classifyClientCheck({
    status: 401,
    body: JSON.stringify({
      error: "invalid_client",
      error_description: "The OAuth client was not found.",
    }),
  });
  assert.equal(result.kind, "unknown_client");
});

test("判定できない応答はunknownのままにする", () => {
  const result = classifyClientCheck({ status: 500, body: "<html>error</html>" });
  assert.equal(result.kind, "unknown");
  assert.equal(result.oauthError, "unknown");
});

test("client IDの指紋は短く、同じ入力では同じになる", () => {
  const fingerprint = clientIdFingerprint("1234567890-abcdef.apps.googleusercontent.com");
  assert.equal(fingerprint.length, 8);
  assert.equal(fingerprint, clientIdFingerprint("1234567890-abcdef.apps.googleusercontent.com"));
  assert.notEqual(fingerprint, clientIdFingerprint("other.apps.googleusercontent.com"));
});

test("環境変数が無い場合は空を返し、引数を優先する", () => {
  assert.equal(
    resolveClientId({ argument: "from-argument", environment: {}, platform: "linux" }),
    "from-argument",
  );
  assert.equal(
    resolveClientId({ environment: { TASKEN_GOOGLE_CLIENT_ID: "from-env" }, platform: "linux" }),
    "from-env",
  );
  assert.equal(resolveClientId({ environment: {}, platform: "linux" }), "");
});

test("実際の判定はtoken endpointの応答だけで決まる（fetchを差し替える）", async () => {
  const report = await runClientCheck({
    clientId: "fixture.apps.googleusercontent.com",
    fetchImpl: async (_url, init) => {
      // 秘密情報は送らない。無効なcodeだけを送る。
      assert.match(String(init.body), /code=tasken-client-check-invalid-code/u);
      assert.doesNotMatch(String(init.body), /client_secret/u);
      return new Response(
        JSON.stringify({
          error: "invalid_request",
          error_description: "client_secret is missing.",
        }),
        { status: 400 },
      );
    },
  });
  assert.equal(report.client_kind, "public_client");
  assert.equal(report.status, 400);
  assert.equal(report.client_id_fingerprint.length, 8);
  assert.equal(report.endpoint, "https://oauth2.googleapis.com/token");
});
