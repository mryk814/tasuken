import * as z from "zod/v4";

import { appErrorSchema, zodIssues, type AppError } from "./error.ts";

export type Result<T, TError = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: TError };

export function resultSchema<TValue extends z.ZodType, TError extends z.ZodType = typeof appErrorSchema>(
  valueSchema: TValue,
  errorSchema?: TError,
) {
  const resolvedErrorSchema = errorSchema ?? appErrorSchema;
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), error: resolvedErrorSchema }).strict(),
  ]);
}

export function parseWithSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  code = "INVALID_PAYLOAD",
): Result<z.output<TSchema>> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: {
      code,
      message: "入力内容がcontractに適合しません。",
      issues: zodIssues(parsed.error),
      retryable: false,
    },
  };
}

export function parseVersionedWithSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  currentVersion: number,
  code = "INVALID_PAYLOAD",
): Result<z.output<TSchema>> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const version = (value as Record<string, unknown>).schemaVersion;
    if (typeof version === "number" && Number.isInteger(version) && version > currentVersion) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_FUTURE_SCHEMA_VERSION",
          message: `schemaVersion ${version}は、このアプリが対応するv${currentVersion}より新しい形式です。`,
          issues: [{
            code: "too_big",
            message: `schemaVersionは${currentVersion}以下である必要があります。`,
            path: ["schemaVersion"],
          }],
          retryable: false,
          details: { receivedVersion: version, currentVersion },
        },
      };
    }
    if (typeof version === "number" && Number.isInteger(version) && version >= 0 && version < currentVersion) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: `schemaVersion ${version}にはmigrationが登録されていません。`,
          issues: [{
            code: "invalid_value",
            message: `schemaVersion ${version}をv${currentVersion}へ移行できません。`,
            path: ["schemaVersion"],
          }],
          retryable: false,
          details: { receivedVersion: version, currentVersion },
        },
      };
    }
  }
  return parseWithSchema(schema, value, code);
}
