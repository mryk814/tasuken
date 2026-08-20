import * as z from "zod/v4";

const optionalText = z.string().trim().optional();

export const searchItemsRequestSchema = z.object({
  query: optionalText,
  theme_id: optionalText,
  limit: z.number().int().min(1).max(100).optional(),
  include_archived: z.boolean().optional(),
}).strict();

export const listOpenItemsRequestSchema = z.object({
  theme_id: optionalText,
  limit: z.number().int().min(1).max(100).optional(),
  include_archived: z.boolean().optional(),
}).strict();

const aiHeaderSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string(),
});

export const itemLocatorSchema = z.object({
  entity_type: z.enum(["item", "task", "waiting", "plan_node"]),
  entity_id: z.string(),
  tool: z.string().optional(),
  arguments: z.record(z.string(), z.string()).optional(),
}).strict();

/** Legacy Item fields remain lossless while Core adds a stable source locator. */
export const publicItemSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  kind: z.string().optional(),
  status: z.string().optional(),
  theme_id: z.string().nullable().optional(),
  ai: aiHeaderSchema,
  locator: itemLocatorSchema,
});

export const nextToolSchema = z.object({
  tool: z.string(),
  description: z.string(),
}).strict();

const itemQueryResponseShape = {
  items: z.array(publicItemSchema),
  limit: z.number().int().min(1).max(100),
  ai_audience: z.literal("coding_agent"),
  read_only: z.literal(true),
  excluded_count: z.number().int().nonnegative(),
  excluded_reasons: z.array(z.object({
    type: z.string(),
    reason: z.string(),
    count: z.number().int().positive(),
  }).strict()),
  next_tools: z.array(nextToolSchema).max(4),
};

export const searchItemsResponseSchema = z.object(itemQueryResponseShape).strict();
export const listOpenItemsResponseSchema = z.object(itemQueryResponseShape).strict();

export type SearchItemsRequest = z.output<typeof searchItemsRequestSchema>;
export type ListOpenItemsRequest = z.output<typeof listOpenItemsRequestSchema>;
export type PublicItem = z.output<typeof publicItemSchema>;
export type SearchItemsResponse = z.output<typeof searchItemsResponseSchema>;
export type ListOpenItemsResponse = z.output<typeof listOpenItemsResponseSchema>;
