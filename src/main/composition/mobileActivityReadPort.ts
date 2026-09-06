import { queryActivityEvents } from "../../shared/activityProjection.mjs";
import { domainCollectionKeyForEntityType } from "../../shared/entityRegistry.mjs";
import {
  mobileActivityDataSchema,
  type MobileActivityRequest,
  type MobileActivityData,
} from "../../shared/contracts/mobile/public.ts";

interface MobileActivityPersistence {
  readWorkspaceSnapshot(includeDeleted?: boolean): Record<string, unknown>;
}

/** Device authorization belongs to the Gateway; this is the owner's read projection. */
export function createMobileActivityReadPort(persistence: MobileActivityPersistence) {
  return (request: MobileActivityRequest): MobileActivityData => {
    const workspace = persistence.readWorkspaceSnapshot(true);
    const result = queryActivityEvents({
      workspace,
      events: Array.isArray(workspace.change_events) ? workspace.change_events : [],
      profile: "recall",
      audience: null,
      date: request.date,
      timezone: request.timezone,
      limit: request.limit,
      cursor: request.cursor,
      sort_direction: "desc",
    });
    return mobileActivityDataSchema.parse({
      ...result,
      events: result.events.map((event) => {
        const source = event.recall?.source_ref || event.entity_ref;
        const collectionKey = domainCollectionKeyForEntityType(source.type);
        const records = collectionKey ? workspace[collectionKey] : null;
        const record = Array.isArray(records)
          ? records.find((candidate) => candidate.id === source.id)
          : null;
        const workLog =
          source.type === "note" &&
          record?.properties_json?.work_log?.schema === "tasken-work-log/v1";
        const type = workLog ? "work_log" : source.type;
        const reason = !["task", "capture_entry", "work_log"].includes(type)
          ? "unsupported_type"
          : !record || record.deleted_at
            ? "not_found"
            : null;
        return {
          ...event,
          mobile_source: {
            type,
            id: source.id,
            status: reason ? "unavailable" : "available",
            reason,
          },
        };
      }),
    });
  };
}
