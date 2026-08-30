import {
  formatTaskLocator,
  mobileTaskContextPreviewResponseSchema,
  type MobileTaskContextPreviewResponse,
} from "../../../shared/contracts/mobile/public.ts";
import { entityIdSchema } from "../../../shared/kernel/public.ts";
import { sha256Hex } from "../../../shared/canonicalMarkdown.mjs";
import { safeReceiptText, safeReceiptValue } from "../../../shared/taskContext.mjs";

type RecordValue = Record<string, unknown>;

export const MOBILE_TASK_CONTEXT_INPUT = Object.freeze({
  include: [
    "theme",
    "repository",
    "notes",
    "conversations",
    "artifacts",
    "resources",
    "activity",
  ] as Array<
    "theme" | "repository" | "notes" | "conversations" | "artifacts" | "resources" | "activity"
  >,
  max_items_per_type: 10,
  max_text_length: 50_000,
  include_archived: false,
});

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function string(value: unknown, limit: number): string {
  return safeReceiptText(value).trim().slice(0, limit);
}

function nullableString(value: unknown, limit: number): string | null {
  return string(value, limit) || null;
}

function identifier(value: unknown): string {
  return entityIdSchema.parse(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["generated_at", "generatedAt", "request_id", "requestId"].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stable(entry)]),
  );
}

/** Fingerprint the canonical, public producer result rather than a Mobile-only policy copy. */
export function taskContextFingerprint(value: unknown): string {
  const canonical = stable(safeReceiptValue(value));
  return `sha256:${sha256Hex(new TextEncoder().encode(JSON.stringify(canonical)))}`;
}

function ref(value: unknown) {
  const input = record(value);
  return { type: string(input.type, 100), id: identifier(input.id) };
}

function ai(value: unknown) {
  const input = record(value);
  if (!Object.keys(input).length) return null;
  const visibility = Array.isArray(input.ai_visibility)
    ? input.ai_visibility.filter((entry: unknown) =>
        ["m365", "coding_agent", "external_ai"].includes(String(entry)),
      )
    : [];
  return {
    visibility: [...new Set(visibility)],
    visibilitySource: ["entity", "theme", "workspace_default"].includes(
      String(input.ai_visibility_source),
    )
      ? input.ai_visibility_source
      : null,
    authority: [
      "user_confirmed",
      "imported",
      "ai_generated",
      "inferred",
      "external_source",
    ].includes(String(input.authority))
      ? input.authority
      : null,
    freshness: ["current", "stale", "superseded", "unknown"].includes(String(input.freshness))
      ? input.freshness
      : "unknown",
    summaryAuthority: ["user_confirmed", "rule_generated", "ai_generated", "excerpt"].includes(
      String(input.summary_authority),
    )
      ? input.summary_authority
      : null,
  };
}

function relationPath(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((entry) => {
    const input = record(entry);
    return {
      from: ref(input.from || input.source),
      predicate: nullableString(input.predicate, 300),
      to: ref(input.to || input.target),
      status: nullableString(input.status, 100),
      reason: nullableString(input.reason, 1000),
    };
  });
}

function contextEntity(type: string, value: unknown) {
  const input = record(value);
  const artifact =
    type === "artifact"
      ? {
          filename: nullableString(input.filename, 500),
          fileType: nullableString(input.file_type, 200),
          mimeType: nullableString(input.mime_type, 200),
          fileSize: Number.isFinite(Number(input.file_size))
            ? Math.max(0, Number(input.file_size))
            : null,
        }
      : null;
  return {
    ref: { type, id: identifier(input.id) },
    version: Number(input.version),
    title: nullableString(input.title || input.name, 500),
    summary: nullableString(input.summary || input.excerpt || input.description, 4000),
    includedBecause: nullableString(input.included_because, 1000),
    ai: ai(input.ai),
    relationPath: relationPath(input.relation_path),
    artifact,
  };
}

function selection(value: unknown) {
  const input = record(value);
  const included = Array.isArray(input.included) ? input.included : [];
  const excluded = Array.isArray(input.excluded) ? input.excluded : [];
  return {
    schema: "tasken-context-selection/v1" as const,
    included: included.slice(0, 200).map((entry: unknown) => {
      const item = record(entry);
      return {
        ref: ref(item.ref),
        reason: nullableString(item.reason, 1000),
        title: nullableString(item.title, 500),
        ai: ai(item.ai),
        relationPath: relationPath(item.relation_path),
      };
    }),
    excluded: excluded.slice(0, 200).map((entry: unknown) => {
      const item = record(entry);
      return {
        ref: ref(item.ref),
        reason: string(item.reason, 1000) || "policy_excluded",
        count: Math.max(1, Number(item.count) || 1),
      };
    }),
    truncated: Boolean(input.truncated),
  };
}

function truncation(value: unknown) {
  const input = record(value);
  return Object.entries(input)
    .slice(0, 50)
    .map(([section, raw]) => {
      const item = record(raw);
      return {
        section: string(section, 100),
        reason: string(item.reason, 100) || "bounded",
        omittedCount: Number.isInteger(item.omitted_count)
          ? Math.max(0, Number(item.omitted_count))
          : null,
        used: Number.isInteger(item.used) ? Math.max(0, Number(item.used)) : null,
        limit: Number.isInteger(item.limit) ? Math.max(0, Number(item.limit)) : null,
      };
    });
}

export function projectTaskContextPreview(
  context: unknown,
  meta: MobileTaskContextPreviewResponse["meta"],
): MobileTaskContextPreviewResponse {
  const source = record(context);
  const task = record(source.task);
  const assignment = record(source.assignment);
  const related = record(source.related);
  const list = (key: string, type: string) =>
    (Array.isArray(related[key]) ? related[key] : [])
      .slice(0, 25)
      .map((entry: unknown) => contextEntity(type, entry));
  const warnings = (Array.isArray(source.warnings) ? source.warnings : [])
    .slice(0, 50)
    .map((entry: unknown) => {
      const item = record(entry);
      return {
        code: string(item.code, 100) || "warning",
        message: string(item.message, 1000) || "Contextの一部を含められませんでした。",
      };
    });
  return mobileTaskContextPreviewResponseSchema.parse({
    ok: true,
    meta,
    data: {
      contextFingerprint: taskContextFingerprint(source),
      task: {
        id: identifier(task.id),
        version: Number(task.version),
        title: string(task.title, 500),
        description: nullableString(task.description, 4000),
        state: string(task.state, 100),
        workState: string(assignment.work_state, 100),
        updatedAt: task.updated_at || null,
        ai: ai(task.ai),
      },
      theme: source.theme ? contextEntity("theme", source.theme) : null,
      repositoryContexts: (Array.isArray(source.repository_contexts)
        ? source.repository_contexts
        : []
      )
        .slice(0, 25)
        .map((entry: unknown) => {
          const item = record(entry);
          return {
            id: identifier(item.id),
            label: string(item.label, 500),
            provider: string(item.provider, 100) || "unknown",
            repositorySlug: nullableString(item.repository_slug, 500),
            defaultBranch: nullableString(item.default_branch, 500),
          };
        }),
      related: {
        notes: list("notes", "note"),
        conversations: list("conversations", "resource"),
        artifacts: list("artifacts", "artifact"),
        resources: list("resources", "resource"),
        activity: (Array.isArray(related.activity) ? related.activity : [])
          .slice(0, 25)
          .map((entry: unknown) => {
            const item = record(entry);
            return {
              id: identifier(item.id),
              eventKind: string(item.event_kind, 100),
              occurredAt: item.occurred_at,
              summary: string(item.summary, 2000),
              includedBecause: "recent_activity" as const,
            };
          }),
      },
      contextSelection: selection(source.context_selection),
      warnings,
      truncation: truncation(source.truncation),
    },
  });
}

function shareText(value: unknown, limit: number): string {
  const withoutControls = [...safeReceiptText(value)]
    .map((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint <= 31 || codePoint === 127 ? " " : character;
    })
    .join("");
  return withoutControls
    .replace(/@(everyone|here|[!&]?\d+)/giu, "@\u200b$1")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

/** Deliberately accepts no Context DTO; expectedResult/instruction are non-persistent share draft text. */
export function createTaskDelegationSafeShare(input: {
  taskId: string;
  title: string;
  expectedResult?: string;
  instruction?: string;
}) {
  const taskLocator = formatTaskLocator(input.taskId);
  const title = shareText(input.title, 500) || "Task";
  const expectedResult = shareText(input.expectedResult, 2000);
  const instruction = shareText(input.instruction, 2000);
  const draftInstruction = [instruction, expectedResult ? `期待する結果: ${expectedResult}` : ""]
    .filter(Boolean)
    .join("\n");
  return {
    mimeType: "text/plain" as const,
    title,
    taskId: input.taskId,
    taskLocator,
    instruction: draftInstruction || null,
    text: [
      title,
      `Task: ${taskLocator}`,
      "Context: MCP tasken.get_task_context で上記 locator の Task を取得してください。",
      draftInstruction,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
