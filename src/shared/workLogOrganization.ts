import { z } from "zod";
import { entityIdSchema, entityVersionSchema, isoTimestampSchema } from "./kernel/public.ts";

const quoteSchema = z
  .string()
  .min(1)
  .max(12000)
  .refine((value) => value.trim().length > 0);

/** Extractive proposals preserve the user's uncertainty instead of introducing new assertions. */
export const workLogOrganizationSchema = z.strictObject({
  done: z.array(quoteSchema).max(10),
  observations: z.array(quoteSchema).max(10),
  unresolved: z.array(quoteSchema).max(10),
  nextActions: z.array(quoteSchema.refine((value) => value.length <= 500)).max(3),
});

export type WorkLogOrganization = z.infer<typeof workLogOrganizationSchema>;

export const adoptWorkLogOrganizationSchema = z.strictObject({
  commandId: entityIdSchema,
  issuedAt: isoTimestampSchema,
  sourceId: entityIdSchema,
  sourceVersion: entityVersionSchema,
  proposal: workLogOrganizationSchema,
});
export type AdoptWorkLogOrganizationCommand = z.input<typeof adoptWorkLogOrganizationSchema>;
export const workLogOrganizationRequestSchema = z.strictObject({
  sourceId: entityIdSchema,
  sourceVersion: entityVersionSchema,
});

export function validateWorkLogOrganization(value: unknown, source: string): WorkLogOrganization {
  const proposal = workLogOrganizationSchema.parse(value);
  const quotes = Object.values(proposal).flat();
  const sourceSentences = source
    .split(/(?<=[。！？])\s*|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (quotes.length === 0 || quotes.some((quote) => !sourceSentences.includes(quote)))
    throw new Error("整理案の引用が原文と一致しません。原文は保持されています。");
  return proposal;
}

export function workLogOrganizationMarkdown(
  proposal: WorkLogOrganization,
  sourceId: string,
  sourceVersion: number,
): string {
  const sections = [
    ["やったこと（本人の記録から引用）", proposal.done],
    ["気づき・所感（本人の記録から引用）", proposal.observations],
    ["未解決・仮説（本人の記録から引用）", proposal.unresolved],
  ] as const;
  return [
    "# AIで整理した作業記録",
    "AIによる分類です。確認済みの知識や実績を示すものではありません。",
    `元の記録: ${sourceId} / version ${sourceVersion}`,
    ...sections.map(
      ([title, quotes]) =>
        `## ${title}\n\n${
          quotes.length
            ? quotes
                .map((quote) =>
                  quote
                    .split(/\r?\n/)
                    .map((line) => `> ${line}`)
                    .join("\n"),
                )
                .join("\n\n")
            : "該当する記述なし"
        }`,
    ),
  ].join("\n\n");
}
