import * as z from "zod/v4";

import { parseTaskenMarkdownBody, taskenMarkdownNonBodyRanges } from "./taskenMarkdownAst.ts";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const safeFileName = (max: number) =>
  boundedText(max).refine((value) => !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(value));

export interface TaskenUploadImagePlaceholder {
  referenceId: string;
  urlStart: number;
  urlEnd: number;
}

interface MarkdownNode {
  type: string;
  url?: unknown;
  identifier?: unknown;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  children?: MarkdownNode[];
}

interface MarkdownImageNode {
  url: string;
  start: number;
  end: number;
}

const TASKEN_UPLOAD_SCHEME = "tasken-upload://";

function startsWithAsciiCaseInsensitive(value: string, index: number, expected: string): boolean {
  if (index + expected.length > value.length) return false;
  for (let offset = 0; offset < expected.length; offset += 1) {
    const code = value.charCodeAt(index + offset);
    const lowerCode = code >= 65 && code <= 90 ? code + 32 : code;
    if (lowerCode !== expected.charCodeAt(offset)) return false;
  }
  return true;
}

function hasUnescapedTaskenUploadImageSyntax(value: string): boolean {
  let state: "text" | "label" | "destination" = "text";
  let precedingBackslashes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (state === "text") {
      if (character === "\\") {
        precedingBackslashes += 1;
        continue;
      }
      const escaped = precedingBackslashes % 2 === 1;
      precedingBackslashes = 0;
      if (character === "!" && !escaped && value[index + 1] === "[") {
        state = "label";
        index += 1;
      }
      continue;
    }

    if (character === "\r" || character === "\n") {
      state = "text";
      precedingBackslashes = 0;
      continue;
    }
    if (state === "label") {
      if (character !== "]") continue;
      if (value[index + 1] === "(") {
        state = "destination";
        index += 1;
      } else {
        state = "text";
      }
      continue;
    }

    if (character === ")") {
      state = "text";
      precedingBackslashes = 0;
      continue;
    }
    if (startsWithAsciiCaseInsensitive(value, index, TASKEN_UPLOAD_SCHEME)) return true;
  }
  return false;
}

function taskenUploadMarkdownImages(body: string): {
  inline: MarkdownImageNode[];
  hasUploadImage: boolean;
} {
  const root = parseTaskenMarkdownBody(body) as MarkdownNode;
  const nonBodyRanges = taskenMarkdownNonBodyRanges(body);
  const hasNonBodyUploadImage = nonBodyRanges.some((range) =>
    hasUnescapedTaskenUploadImageSyntax(body.slice(range.start, range.end)),
  );
  const inline: MarkdownImageNode[] = [];
  let hasDirectUploadImage = false;
  const uploadDefinitions = new Set<string>();
  const imageReferences = new Set<string>();
  const visit = (node: MarkdownNode): void => {
    if (
      node.type === "image" &&
      typeof node.url === "string" &&
      /^tasken-upload:\/\//i.test(node.url)
    ) {
      hasDirectUploadImage = true;
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      const isNonBody =
        typeof start === "number" &&
        nonBodyRanges.some((range) => start >= range.start && start < range.end);
      if (typeof start === "number" && typeof end === "number" && !isNonBody) {
        inline.push({ url: node.url, start, end });
      }
    } else if (
      node.type === "definition" &&
      typeof node.identifier === "string" &&
      typeof node.url === "string" &&
      /^tasken-upload:\/\//i.test(node.url)
    ) {
      uploadDefinitions.add(node.identifier);
    } else if (node.type === "imageReference" && typeof node.identifier === "string") {
      imageReferences.add(node.identifier);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return {
    inline,
    hasUploadImage:
      hasDirectUploadImage ||
      hasNonBodyUploadImage ||
      [...imageReferences].some((identifier) => uploadDefinitions.has(identifier)),
  };
}

export function findTaskenUploadImagePlaceholders(body: string): TaskenUploadImagePlaceholder[] {
  return taskenUploadMarkdownImages(body).inline.flatMap((node) => {
    const source = body.slice(node.start, node.end);
    const match = source.match(
      /^!\[[^\]\r\n]*\]\(\s*(?:<(tasken-upload:\/\/([a-z0-9][a-z0-9._-]{0,63}))>|(tasken-upload:\/\/([a-z0-9][a-z0-9._-]{0,63})))(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?[ \t]*\)$/,
    );
    if (!match) return [];
    const url = match[1] ?? match[3];
    const referenceId = match[2] ?? match[4];
    if (url !== node.url) return [];
    const urlStart = node.start + source.indexOf(url);
    return [{ referenceId, urlStart, urlEnd: urlStart + url.length }];
  });
}

export function hasTaskenUploadImageDestination(body: string): boolean {
  return taskenUploadMarkdownImages(body).hasUploadImage;
}

export const noteProposalImageMediaTypeSchema = z.enum(["image/png", "image/jpeg"]);

export const noteProposalImageSchema = z
  .object({
    reference_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    file_name: safeFileName(180),
    media_type: noteProposalImageMediaTypeSchema,
    data_base64: z.string().min(1).max(16_777_216),
  })
  .strict();

export const contentProposalActorSchema = z
  .object({
    kind: z.literal("ai_agent"),
    id: boundedText(200).optional(),
  })
  .strict();

export const contentProposalRepositoryContextSchema = z
  .object({
    repository_context_id: boundedText(200).optional(),
    provider: z
      .enum(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"])
      .optional(),
    repository_slug: boundedText(500)
      .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
      .optional(),
    branch: boundedText(500)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "branchに制御文字は使えません。")
      .optional(),
  })
  .strict();

const requestBase = {
  idempotency_key: boundedText(200),
  caller: boundedText(200),
  actor: contentProposalActorSchema,
  source: z.literal("mcp"),
  source_session: boundedText(200).optional(),
  source_app: boundedText(120).optional(),
  repository_context: contentProposalRepositoryContextSchema.optional(),
};

export const proposeContentRequestSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...requestBase,
        kind: z.literal("note_create"),
        title: boundedText(200),
        body: z.string().min(1).max(200_000),
        theme: optionalText(500),
        note_type: z.enum(["memo", "report", "prompt"]).optional(),
        report_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        reason: optionalText(2_000),
        images: z.array(noteProposalImageSchema).min(1).max(8).optional(),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("note_edit"),
        note_id: boundedText(200),
        base_version: z.number().int().positive(),
        title: boundedText(200),
        body: z.string().max(200_000),
        reason: boundedText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("knowledge_create"),
        title: boundedText(200),
        body: optionalText(20_000),
        node_type: z.enum(["question", "claim", "evidence", "decision", "insight"]).optional(),
        theme: optionalText(500),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        reason: optionalText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("sketch_create"),
        title: boundedText(200),
        svg: z.string().min(1).max(500_000),
        theme: optionalText(500),
        reason: optionalText(2_000),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        kind: z.literal("artifact_create"),
        title: boundedText(200),
        file_name: boundedText(180),
        media_type: z.enum(["image/svg+xml", "text/markdown", "text/plain", "application/json"]),
        content: z.string().min(1).max(1_000_000),
        theme: optionalText(500),
        reason: optionalText(2_000),
      })
      .strict(),
  ])
  .superRefine((request, context) => {
    if (request.kind === "note_create" && request.report_date && request.note_type !== "report") {
      context.addIssue({
        code: "custom",
        path: ["report_date"],
        message: "report_date is only supported for report Notes",
      });
    }
  });

export const contentProposalPayloadTypeSchema = z.enum([
  "notes",
  "knowledge_nodes",
  "sketches",
  "artifacts",
]);

export const proposeContentResponseSchema = z
  .object({
    proposal_id: z.string().uuid(),
    status: z.enum(["queued", "duplicate"]),
    payload_type: contentProposalPayloadTypeSchema,
    message: boundedText(500),
  })
  .strict();

export type ProposeContentRequest = z.output<typeof proposeContentRequestSchema>;
export type ProposeContentResponse = z.output<typeof proposeContentResponseSchema>;
export type ContentProposalPayloadType = z.output<typeof contentProposalPayloadTypeSchema>;
export type NoteProposalImage = z.output<typeof noteProposalImageSchema>;
export type NoteProposalImageMediaType = z.output<typeof noteProposalImageMediaTypeSchema>;
