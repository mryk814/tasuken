import { IconSparkles } from "@tabler/icons-react";

/**
 * Meaningful icon registry. AI icons are intentionally not selected ad hoc in
 * feature code: callers must use this name only for an AI request, generated
 * result, proposal, or provider connection.
 */
export const SEMANTIC_ICONS = {
  aiAction: IconSparkles,
  aiGenerated: IconSparkles,
} as const;

export const AI_ICON = SEMANTIC_ICONS.aiAction;
