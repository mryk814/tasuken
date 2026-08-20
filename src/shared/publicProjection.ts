import { safeExternalUrl, safeReceiptText, safeReceiptValue } from "./taskContext.mjs";

const MAX_DEPTH = 6;
const MAX_ARRAY = 100;
const MAX_KEYS = 100;
const MAX_TEXT = 8_000;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SECRET_KEYS = new Set([
  "authorization", "authorizationtoken", "clientsecret", "accesstoken", "refreshtoken",
  "sessiontoken", "privatekey", "credential", "credentials", "cookie", "password",
  "passwd", "pwd", "token", "secret", "apikey",
]);
const REDACTED_MARKER = /\[redacted(?:-url|-local-path)?\]/i;

export interface PublicProjectionOptions {
  maxDepth?: number;
  maxArray?: number;
  maxKeys?: number;
  maxText?: number;
}

function normalizedKey(value: unknown) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

export function isUnsafePublicKey(value: unknown) {
  const key = String(value || "");
  return UNSAFE_KEYS.has(key) || SECRET_KEYS.has(normalizedKey(key));
}

export function sanitizePublicText(value: unknown, limit = MAX_TEXT) {
  return safeReceiptText(value)
    .slice(0, Math.max(0, Math.min(Number(limit) || MAX_TEXT, MAX_TEXT)));
}

export function sanitizePublicIdentifier(value: unknown, limit = 500) {
  const sanitized = sanitizePublicText(value, limit).trim();
  return sanitized && !REDACTED_MARKER.test(sanitized) ? sanitized : null;
}

export function sanitizePublicUrl(value: unknown) {
  return safeExternalUrl(value);
}

function sanitizeSanitizedValue(value: unknown, options: PublicProjectionOptions, depth: number): unknown {
  if (depth > (options.maxDepth ?? MAX_DEPTH)) return undefined;
  if (typeof value === "string") return sanitizePublicText(value, options.maxText ?? MAX_TEXT);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.slice(0, options.maxArray ?? MAX_ARRAY)
      .map((entry) => sanitizeSanitizedValue(entry, options, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(value).sort().slice(0, options.maxKeys ?? MAX_KEYS)) {
    if (isUnsafePublicKey(key)) continue;
    const sanitized = sanitizeSanitizedValue(source[key], options, depth + 1);
    if (sanitized !== undefined) Object.defineProperty(result, key, {
      value: sanitized,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

export function sanitizePublicValue(value: unknown, options: PublicProjectionOptions = {}, depth = 0): unknown {
  return sanitizeSanitizedValue(safeReceiptValue(value), options, depth);
}

export function pickPublicFields(record: unknown, fields: readonly string[]): Record<string, unknown> {
  const source: Record<string, unknown> = record && typeof record === "object" && !Array.isArray(record)
    ? record as Record<string, unknown>
    : {};
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field) || isUnsafePublicKey(field)) continue;
    const sanitized = sanitizePublicValue(source[field]);
    if (sanitized !== undefined) result[field] = sanitized;
  }
  return result;
}
