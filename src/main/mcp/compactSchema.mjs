import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const REDUNDANT_CONSTRAINTS = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "pattern",
  "$schema",
]);

/** Discoveryだけを軽量化する。呼び出し時のZod schemaには触れない。 */
export function compactDiscoverySchema(value) {
  if (Array.isArray(value)) return value.map(compactDiscoverySchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          !REDUNDANT_CONSTRAINTS.has(key) && !(key === "additionalProperties" && entry === false),
      )
      .map(([key, entry]) => [
        key,
        // propertiesのキーはJSON Schema keywordでなく利用者のフィールド名。
        ["properties", "$defs", "definitions"].includes(key)
          ? Object.fromEntries(
              Object.entries(entry).map(([name, schema]) => [name, compactDiscoverySchema(schema)]),
            )
          : compactDiscoverySchema(entry),
      ]),
  );
}

/** SDKの一覧生成をそのまま使い、公開APIで登録されるhandlerの応答だけ縮小する。 */
export function compactToolDiscovery(server) {
  const setRequestHandler = server.setRequestHandler.bind(server);
  server.setRequestHandler = (schema, handler) =>
    setRequestHandler(
      schema,
      schema === ListToolsRequestSchema
        ? async (...args) => {
            const result = await handler(...args);
            return {
              ...result,
              tools: result.tools.map((tool) => ({
                ...tool,
                inputSchema: compactDiscoverySchema(tool.inputSchema),
              })),
            };
          }
        : handler,
    );
}
