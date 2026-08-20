import {
  projectEntityForAi,
  summarizeAiExclusions,
  type AiExclusion,
} from "../../../shared/aiMetadata.mjs";
import type {
  ItemQueryRecord,
  ItemQuerySnapshot,
} from "../ports/itemQueryReadPort.ts";

const ITEM_ENTITY_TYPES = {
  task: "task",
  waiting: "waiting",
  milestone: "plan_node",
  period: "plan_node",
} as const;

export class ItemQueryAiProjectionPolicy {
  project(records: ItemQueryRecord[], snapshot: ItemQuerySnapshot) {
    const themesById = new Map(snapshot.themes.map((theme) => [theme.id, theme]));
    const included: ItemQueryRecord[] = [];
    const exclusions: AiExclusion[] = [];

    for (const record of records) {
      const kind = String(record.kind || "");
      const entityType = ITEM_ENTITY_TYPES[kind as keyof typeof ITEM_ENTITY_TYPES] || "item";
      const themeId = String(record.theme_id || record.project_id || "");
      const projected = projectEntityForAi(entityType, record, {
        audience: "coding_agent",
        theme: themesById.get(themeId) || null,
        workspaceDefault: snapshot.workspaceAiVisibilityDefault,
      });
      if (!projected.included) {
        if (projected.exclusion) exclusions.push(projected.exclusion);
        continue;
      }
      included.push({ ...record, ai: projected.header });
    }

    return { records: included, ...summarizeAiExclusions(exclusions) };
  }
}
