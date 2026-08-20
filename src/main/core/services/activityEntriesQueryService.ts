import { projectEntityForAi } from "../../../shared/aiMetadata.mjs";
import { projectActivityJson, queryActivityEvents } from "../../../shared/activityProjection.mjs";
import {
  getActivityEntriesRequestSchema,
  getActivityEntriesResponseSchema,
  type GetActivityEntriesRequest,
  type GetActivityEntriesResponse,
} from "../../../shared/contracts/task/activityEntries.ts";
import type { ActivityEntriesReadPort } from "../ports/activityEntriesReadPort.ts";

const AUDIENCE = "coding_agent";
const DEFAULT_LIMIT = 50;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function notFound(taskId: string): GetActivityEntriesResponse {
  return getActivityEntriesResponseSchema.parse({
    error: {
      code: "not_found",
      message: "Taskが見つかりません。IDまたはAI公開範囲を確認してください。",
      task_id: taskId,
    },
    read_only: true,
    ai_audience: AUDIENCE,
  });
}

export class ActivityEntriesQueryService {
  constructor(private readonly readPort: ActivityEntriesReadPort) {}

  execute(input: GetActivityEntriesRequest): GetActivityEntriesResponse {
    const request = getActivityEntriesRequestSchema.parse(input);
    const snapshot = this.readPort.readActivityEntriesSnapshot(Boolean(request.include_archived));
    const workspace = snapshot.workspace;
    const taskId = request.task_id;
    const task = (workspace.tasks || []).find((candidate) => text(candidate.id) === taskId);
    if (!task) return notFound(taskId);

    const themesById = new Map(snapshot.visibilityThemes.map((theme) => [text(theme.id), theme]));
    const themeId = text(task.project_id || task.theme_id);
    const visibility = projectEntityForAi("task", task, {
      audience: AUDIENCE,
      theme: themeId ? themesById.get(themeId) || null : null,
      workspaceDefault: snapshot.workspaceAiVisibilityDefault,
    });
    // Missing and policy-hidden Tasks deliberately share one public response.
    if (!visibility.included) return notFound(taskId);

    const sourceEvents = (workspace.change_events || [])
      .filter((event) => text(event.entity_ref?.id || event.entity_id) === taskId);
    const activity = projectActivityJson(queryActivityEvents({
      events: sourceEvents,
      workspace,
      themes: snapshot.visibilityThemes,
      references: workspace.references || [],
      entity_type: "task",
      timezone: "Asia/Tokyo",
      audience: AUDIENCE,
      workspaceDefault: snapshot.workspaceAiVisibilityDefault,
      roots: workspace.canonical_root_status || {},
      limit: request.limit ?? DEFAULT_LIMIT,
      sort_direction: "desc",
      include_match_metadata: true,
    }));
    const limit = request.limit ?? DEFAULT_LIMIT;
    const events = activity.events;
    const matchedVisible = Number(activity.matched_count);
    const truncated = activity.truncated;

    return getActivityEntriesResponseSchema.parse({
      task_id: taskId,
      events,
      limit,
      truncated,
      result_meta: {
        contract_version: 1,
        returned_count: events.length,
        matched_visible_count: matchedVisible,
        truncated,
      },
      read_only: true,
      ai_audience: AUDIENCE,
    });
  }
}
