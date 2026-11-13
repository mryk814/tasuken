import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { apiErrorStatus, toolResultValue } from "./toolErrorStatus.mjs";

const TOOL_NAME = /^tasken\.[a-z][a-z0-9_]{0,63}$/;
// 道具以外のMCPの要求のうち、入口の名前に使ってよいmethod（閉じた集合）。ほかは{unknown}。
// initializeとpingはSDKがconstructorで登録するので包めない。HTTPでは httpServer.mjs の行で数える。
const OTHER_METHODS = new Set([
  "tools/list",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "prompts/list",
  "prompts/get",
  "completion/complete",
  "logging/setLevel",
]);
const CODE = /^[A-Z][A-Z0-9_]{0,47}$/;

function statsCode(code) {
  return typeof code === "string" && CODE.test(code.toUpperCase()) ? code.toUpperCase() : "OTHER";
}

/**
 * toolの結果を、計測の status と code にする。
 * 結果の本文・エラー文は読むが、返すのは状態の種類だけ（題名・本文・引数は返さない）。
 * - 成功は 200。
 * - `{error:{code}}`の形のisErrorは、HTTPの`/api/v1`と同じ対応（apiErrorStatus）。
 * - 入力検証の失敗（-32602）は 400 INVALID_ARGUMENTS、存在しないtoolは 404 UNKNOWN_TOOL。
 * - それ以外のisErrorは toolの想定外の失敗として 500 INTERNAL_ERROR。
 */
export function classifyToolResult(result, known = true) {
  if (!result?.isError) return { status: 200, code: "" };
  const value = toolResultValue(result);
  const errorCode = value?.error?.code;
  if (typeof errorCode === "string") {
    return { status: apiErrorStatus(value), code: statsCode(errorCode) };
  }
  // SDKは存在しないtoolと入力検証の失敗の両方を、-32602のisErrorの結果で返す。
  if (!known) return { status: 404, code: "UNKNOWN_TOOL" };
  return apiErrorStatus(value) === 400
    ? { status: 400, code: "INVALID_ARGUMENTS" }
    : { status: 500, code: "INTERNAL_ERROR" };
}

function classifyToolError(error, known) {
  if (error?.code === -32601) return { status: 404, code: "UNKNOWN_METHOD" };
  if (error?.code === -32602) {
    return known
      ? { status: 400, code: "INVALID_ARGUMENTS" }
      : { status: 404, code: "UNKNOWN_TOOL" };
  }
  return { status: 500, code: "INTERNAL_ERROR" };
}

/** 結果のcontentのtextのバイト数の合計。結果全体をJSONへ直さない。 */
function resultBytes(result) {
  let bytes = 0;
  if (Array.isArray(result?.content)) {
    for (const part of result.content) {
      if (part?.type === "text" && typeof part.text === "string") {
        bytes += Buffer.byteLength(part.text);
      }
    }
  }
  return bytes;
}

/** stdioのclientがinitializeで名乗る名前を、呼び手の名前に使える形（小文字・[a-z0-9._-]・32文字）にする。 */
export function stdioStatsCaller(server) {
  let name;
  try {
    name = String(server.getClientVersion?.()?.name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "")
      .slice(0, 32);
  } catch {
    name = "";
  }
  return `mcp:local/${name || "unknown"}`;
}

/**
 * MCPの要求のhandlerを時間計測つきにする。compactToolDiscoveryと同じく`setRequestHandler`を包むので、
 * 包んだ後に登録されるすべてのhandler（tools/call・tools/list・resources/*など）が数えられ、
 * SDKの入力検証の失敗や存在しないtoolも数えられる。toolごとのhandlerを一つずつ包まずに済む。
 *
 * 入口の名前は`POST /mcp:<tool名>`（tools/call）か`POST /mcp:<method>`（それ以外）。
 * tool名は`isKnownTool`で登録済みと分かったものだけ、methodは閉じた集合のものだけを使い、
 * ほかは`{unknown}`にする（呼び手が書いた文字列を入口の名前にしない）。引数は読まない。
 * 送る処理(`send`)は結果を返した後に待たずに呼ぶ。送れなくても呼び出しは失敗させない。
 */
export function instrumentToolCalls(server, { isKnownTool, caller, send }) {
  const setRequestHandler = server.setRequestHandler.bind(server);
  server.setRequestHandler = (schema, handler) =>
    setRequestHandler(schema, async (...args) => {
      const startedAt = process.hrtime.bigint();
      const isCall = schema === CallToolRequestSchema;
      const method = schema?.shape?.method?.value;
      const name = args[0]?.params?.name;
      const known = isCall
        ? typeof name === "string" && TOOL_NAME.test(name) && isKnownTool(name)
        : OTHER_METHODS.has(method);
      const report = (outcome, bytes) => {
        try {
          const row = {
            entry: `POST /mcp:${known ? (isCall ? name : method) : "{unknown}"}`,
            caller: caller(),
            status: outcome.status,
            code: outcome.code,
            us: Number((process.hrtime.bigint() - startedAt) / 1000n),
            bytes,
          };
          // 結果を返す処理の後で送る。
          setImmediate(() => {
            try {
              send(row);
            } catch {
              // 計測の失敗で呼び出しを失敗させない。
            }
          });
        } catch {
          // 同上。
        }
      };
      let result;
      try {
        result = await handler(...args);
      } catch (error) {
        // tool以外の-32602は未知のtoolではなく引数の誤り。
        report(classifyToolError(error, isCall ? known : true), 0);
        throw error;
      }
      // tools/call以外は、返せれば200。中身（resources/readの本文など）は数えない。
      if (isCall) report(classifyToolResult(result, known), resultBytes(result));
      else report({ status: 200, code: "" }, 0);
      return result;
    });
}
