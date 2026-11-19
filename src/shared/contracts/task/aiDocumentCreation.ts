import * as z from "zod/v4";

import { entityIdSchema } from "../../kernel/public.ts";
import { aiCreationOriginSchema } from "./aiCreationOrigin.ts";

export { aiCreationOriginSchema };

export const documentAssetMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
]);

/**
 * Documentに同梱する画像・動画（#789）。
 *
 * バイナリはHTML本文へbase64で転記させず、部品として分けて送る（note画像と同じ作法。
 * 転記は壊れやすく、#790の二の舞になる）。HTML本文からは
 * `tasken-upload://<reference_id>` で参照し、書き込み時にCoreが検証して実データへ
 * 差し替え、自己完結した1ファイルに仕上げる。
 */
export const documentAssetSchema = z
  .object({
    reference_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    file_name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((value) => !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(value)),
    media_type: documentAssetMediaTypeSchema,
    data_base64: z.string().min(1).max(16_777_216),
  })
  .strict();

/**
 * AIがTask配下へDocument（HTML文書）を直接作る入力。identity・作成者・経路はCoreが決める。
 * 提案→採用は通らない：作られたDocumentにはTask/Noteの直接作成と同じAI作成の印が付き、
 * 本人は後から直せない代わりに削除できる（改訂はAIの再作成）。
 */
export const aiDocumentCreationFields = {
  task_id: entityIdSchema.describe(
    "Task the Document belongs to. Take the ID from get_task_context or search_items.",
  ),
  title: z.string().trim().min(1).max(200),
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .refine((value) => !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(value))
    .refine((value) => /\.html?$/i.test(value), "file_nameは.htmlで終わる名前にしてください。")
    .describe("File name only, no path. Must end in .html."),
  content: z
    .string()
    .min(1)
    .max(1_000_000)
    .describe(
      "Finished HTML document. Reference bundled images/videos as tasken-upload://reference-id and send their bytes in assets; never transcribe base64 into the HTML.",
    ),
  assets: z
    .array(documentAssetSchema)
    .min(1)
    .max(8)
    .optional()
    .describe(
      "Images/videos the HTML references as tasken-upload://reference-id. Each asset must be referenced from the HTML and every reference must have an asset; at most 8 assets, 12MiB each, 24MiB total.",
    ),
  idempotency_key: z.string().trim().min(1).max(200),
  caller: z.string().trim().min(1).max(200),
  source_app: z.string().trim().min(1).max(120).default("mcp-client"),
  source_session: z.string().trim().min(1).max(200).optional(),
  reason: z.string().max(2_000).default(""),
};

export const aiDocumentCreationRequestSchema = z.object(aiDocumentCreationFields).strict();

export const aiDocumentCreationResponseSchema = z
  .object({
    schema: z.literal("tasken-ai-document-creation/v1"),
    status: z.enum(["created", "duplicate"]),
    workspace_id: z.string(),
    canonical_node: z.literal("this_node"),
    entity: z
      .object({
        type: z.literal("document"),
        id: entityIdSchema,
        version: z.number().int().positive(),
        title: z.string(),
        file_name: z.string(),
        task_id: entityIdSchema,
        theme_id: z.string().nullable(),
        deleted_at: z.string().nullable(),
        ai_creation: aiCreationOriginSchema,
        ai_seen_at: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type DocumentAsset = z.output<typeof documentAssetSchema>;
export type DocumentAssetMediaType = z.output<typeof documentAssetMediaTypeSchema>;
export type AiDocumentCreationRequest = z.input<typeof aiDocumentCreationRequestSchema>;
export type AiDocumentCreationResponse = z.output<typeof aiDocumentCreationResponseSchema>;
