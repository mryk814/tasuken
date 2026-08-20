import {
  projectEntityForAi,
  summarizeAiExclusions,
  type AiAudience,
  type AiExclusion,
} from "../../../shared/aiMetadata.mjs";
import type {
  AgentReadyTaskSourceRecord,
  AgentReadyTaskThemeRecord,
} from "../ports/agentReadyTaskReadPort.ts";

const CODING_AGENT_AUDIENCE: AiAudience = "coding_agent";

/** AI visibility is applied before the public result limit. */
export class AgentReadyTaskAiProjectionPolicy {
  project(
    tasks: AgentReadyTaskSourceRecord[],
    themes: AgentReadyTaskThemeRecord[],
    workspaceDefault: AiAudience[],
  ) {
    const themesById = new Map(themes.map((theme) => [theme.id, theme]));
    const records: AgentReadyTaskSourceRecord[] = [];
    const exclusions: AiExclusion[] = [];

    for (const task of tasks) {
      const themeId = String(task.project_id || task.theme_id || "");
      const projected = projectEntityForAi("task", task, {
        audience: CODING_AGENT_AUDIENCE,
        theme: themesById.get(themeId) || null,
        workspaceDefault,
      });
      if (!projected.included) {
        if (projected.exclusion) exclusions.push(projected.exclusion);
        continue;
      }
      records.push({ ...task, ai: projected.header });
    }

    return { records, ...summarizeAiExclusions(exclusions) };
  }
}
