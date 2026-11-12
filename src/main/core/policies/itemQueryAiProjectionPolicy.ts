import { buildAiEntityHeader } from "../../../shared/aiMetadata.mjs";
import type { ItemQueryRecord } from "../ports/itemQueryReadPort.ts";

const ITEM_ENTITY_TYPES = {
  task: "task",
  waiting: "waiting",
  milestone: "plan_node",
  period: "plan_node",
} as const;

/** Attaches the shared AI metadata header to each record. Every record is returned. */
export class ItemQueryAiProjectionPolicy {
  project(records: ItemQueryRecord[]) {
    return {
      records: records.map((record) => {
        const kind = String(record.kind || "");
        const entityType = ITEM_ENTITY_TYPES[kind as keyof typeof ITEM_ENTITY_TYPES] || "item";
        return { ...record, ai: buildAiEntityHeader(entityType, record) };
      }),
    };
  }
}
