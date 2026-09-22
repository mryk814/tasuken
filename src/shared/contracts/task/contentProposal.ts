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

/**
 * 外部リンクのURL。
 *
 * 公開HTTP(S)だけを扱い、credential付きURLとtoken類のqueryは保存しない
 * （`src/shared/externalReference.mjs` と同じ規則）。取得の可否はここでは
 * 判定せず、Main側の取得サービスが解決後のアドレスを見て拒否する。
 */
const feedExternalLinkUrl = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      if (parsed.username || parsed.password) return false;
      return true;
    } catch {
      return false;
    }
  }, "外部リンクはhttp / httpsの公開URLを指定してください。")
  .refine((value) => {
    try {
      for (const [key] of new URL(value).searchParams) {
        if (
          /(?:token|secret|password|passwd|credential|authorization|cookie|private[_-]?key|api[_-]?key)/i.test(
            key,
          )
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  }, "外部リンクのqueryにcredential/tokenを含めることはできません。");

/**
 * 投稿に添える一つの入口（計画フェーズ3）。
 *
 * 画像は毎回生成せず、既存Artifactを参照する。外部URLは投稿者が付けた一言だけを
 * 正本とし、題名・説明・サムネイルは取得できたときだけ派生として重ねる。
 */
export const feedPostArtifactMediaSchema = z
  .object({
    kind: z.literal("artifact"),
    artifact_id: boundedText(200),
    /** 画像の役割。実測・作業成果、参考元、説明図を区別する。 */
    role: z.enum(["result", "source", "explanation"]),
    alt_text: boundedText(500),
    caption: optionalText(500),
  })
  .strict();

export const feedPostExternalLinkMediaSchema = z
  .object({
    kind: z.literal("external_link"),
    url: feedExternalLinkUrl,
    /** 投稿者の一言。取得できなかったときの説明を兼ねる。 */
    comment: optionalText(500),
    /** 投稿者が付けた題名。取得結果より優先する。 */
    label: optionalText(200),
  })
  .strict();

export const feedPostMediaSchema = z.discriminatedUnion("kind", [
  feedPostArtifactMediaSchema,
  feedPostExternalLinkMediaSchema,
]);

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
        /**
         * 読む面への投稿（2026-09-21計画の第2段階）。
         * 本文は読み物として保持し、正式データ（Note/Task）は変更しない。
         * 記事を正式Noteにするときは、添えたNote草稿の採用を別途行う。
         */
        kind: z.literal("feed_post"),
        /** 投稿の種類。表示の見出しと「学び」タブの絞り込みに使う。 */
        topic: z.enum(["work_report", "insight", "learning", "reference", "question", "own_note"]),
        /** 本文。段落ごとに分けて保持し、表示のたびに作り直さない。 */
        body: z.array(boundedText(2_000)).min(1).max(20),
        /** 任意のTask参照。 */
        task_id: boundedText(200).optional(),
        /** 任意のTheme参照（表示名またはID）。 */
        theme: optionalText(500),
        /** 任意のAgent Session参照。 */
        session_id: boundedText(200).optional(),
        /** 任意の記事。既存Noteを指すか、同じ送信でNote草稿を作る。 */
        note_id: boundedText(200).optional(),
        article: z
          .object({
            title: boundedText(200),
            body: z.string().min(1).max(200_000),
            /** 記事の種類。既定は読み物としてのNote。 */
            note_type: z.enum(["memo", "report", "prompt"]).optional(),
            /**
             * 記事に埋め込む画像。`tasken-upload://` のプレースホルダーを本文へ書き、
             * 対応する画像をここへ入れる（`tasken.propose_note` と同じ形式）。
             */
            images: z.array(noteProposalImageSchema).min(1).max(8).optional(),
          })
          .strict()
          .optional(),
        /**
         * 投稿に添える一つの入口。画像（既存Artifact）か外部リンクのどちらか。
         * 投稿一件に付く主画像は一枚までとし、複数の図は記事へまとめる。
         */
        media: feedPostMediaSchema.optional(),
        /** 添付の見出し（図や表の説明）。 */
        attachment_label: optionalText(200),
        /** 根拠。出所URLや確認日など、本文の主張を支える事実。 */
        evidence: z.array(boundedText(1_000)).max(20).optional(),
      })
      .strict(),
    z
      .object({
        ...requestBase,
        /**
         * 利用者の質問への返答（2026-09-21計画の第3段階）。
         * 質問（`ai_requested_at` 付きの返信）へ紐づけ、同じスレッドで読めるようにする。
         * 正式データは変更せず、要対応の判断にも数えない。
         */
        kind: z.literal("feed_reply"),
        /** 返答が属する投稿。`get_feed_context` が返した投稿ID。 */
        post_id: boundedText(200),
        /** 返答する質問（返信EntityのID）。 */
        reply_to: boundedText(200),
        /** 返答の本文。 */
        body: z.string().min(1).max(4_000),
        /** 返答したAIの表示名。投稿者の識別に使う。 */
        author_label: optionalText(120),
        /** 根拠。出所URLや確認日など。 */
        evidence: z.array(boundedText(1_000)).max(20).optional(),
      })
      .strict(),
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
  /** 読み物の投稿。要対応の判断ではない（`attentionQueue` が除外する）。 */
  "feed_posts",
  /** 読み物への返答。同じく要対応の判断ではない。 */
  "feed_replies",
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
