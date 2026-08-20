import * as z from "zod/v4";

export const getThemeContextRequestSchema = z.object({
  theme_id: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(100).optional(),
  max_chars: z.number().int().positive().max(8_000).optional(),
  include_raw_body: z.boolean().optional(),
  max_hops: z.number().int().positive().max(2).optional(),
  max_nodes: z.number().int().positive().max(100).optional(),
  max_edges: z.number().int().nonnegative().max(200).optional(),
  token_budget: z.number().int().positive().max(12_000).optional(),
  include_archived: z.boolean().optional(),
}).strict();

// The response preserves the established MCP envelope while the graph
// projection remains evolvable without silently dropping legacy fields.
export const getThemeContextResponseSchema = z.looseObject({
  read_only: z.literal(true),
  ai_audience: z.literal("coding_agent"),
});

export type GetThemeContextRequest = z.output<typeof getThemeContextRequestSchema>;
export type GetThemeContextResponse = z.output<typeof getThemeContextResponseSchema>;
