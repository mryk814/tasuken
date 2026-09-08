import { migrateChangeEvent } from "../../shared/activityEvent.mjs";
import { workLogPerformedDate } from "../../shared/activityRecall.mjs";
import { localDate } from "../../shared/activityProjection.mjs";
import { markdownSignature } from "../../shared/canonicalMarkdown.mjs";
import { entityDefinitions } from "../../shared/entityRegistry.mjs";
import type { PublishedContextDay } from "../../shared/periodContext";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const key = (type: unknown, id: unknown) => JSON.stringify([type, id]);

/** Calendar arithmetic on already-normalized dates, independent of the host timezone. */
function datesBetween(from: string, to: string) {
  const result: string[] = [];
  for (let date = from; date <= to;) {
    if (result.length >= 50000)
      throw new Error("公開対象期間を確認してください。期間が長すぎます。");
    result.push(date);
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  return result;
}

/** Detect received/imported changes without relying on the local mobile sequence. */
export function collectDailyContextAutoChanges({
  workspace,
  workspaceDefault,
  sourceHashes: previous,
  checkedThrough,
  fromDate,
  today,
  timezone,
  publishedDays,
}: {
  workspace: Record<string, unknown>;
  workspaceDefault: unknown;
  sourceHashes: Record<string, string>;
  checkedThrough: string | null;
  fromDate: string;
  today: string;
  timezone: string;
  publishedDays: Record<string, PublishedContextDay>;
}) {
  const entities = new Map<string, Record<string, unknown>>();
  for (const definition of entityDefinitions) {
    for (const collection of new Set([definition.collectionKey, definition.domainCollectionKey])) {
      if (!collection || !Array.isArray(workspace[collection])) continue;
      for (const value of workspace[collection] as unknown[]) {
        const entity = record(value);
        if (typeof entity.id === "string") entities.set(key(definition.type, entity.id), entity);
      }
    }
  }
  const sourceHashes = Object.fromEntries(
    [...entities].map(([id, entity]) => [id, markdownSignature(JSON.stringify(entity))]),
  );
  sourceHashes.$policy = markdownSignature(JSON.stringify(workspaceDefault));
  const changed = new Set(
    [...new Set([...Object.keys(previous), ...Object.keys(sourceHashes)])].filter(
      (id) => sourceHashes[id] !== previous[id],
    ),
  );
  const dates = new Set<string>();
  const add = (date: string) => {
    // Previously published days remain tracked even before the initial backfill range.
    if (date && date <= today && (date >= fromDate || publishedDays[date])) dates.add(date);
  };
  if (!checkedThrough) datesBetween(fromDate, today).forEach(add);
  else if (checkedThrough < today) datesBetween(checkedThrough, today).forEach(add);

  const broadChange =
    changed.has("$policy") ||
    [...changed].some((id) =>
      /^(?:\["(?:theme|project|reference|schedule|work_receipt|ai_proposal)",)/.test(id),
    );
  if (broadChange) {
    datesBetween(fromDate, today).forEach(add);
    Object.keys(publishedDays).forEach(add);
  }
  for (const [date, day] of Object.entries(publishedDays)) {
    if (day.sources.some((source) => changed.has(key(source.type, source.id)))) add(date);
  }
  for (const [entityKey, entity] of entities) {
    const [type] = JSON.parse(entityKey) as string[];
    if (type === "capture_entry" && changed.has(entityKey)) {
      add(localDate(entity.captured_at, timezone));
    }
    if (type !== "change_event") continue;
    const rawRef = record(entity.entity_ref);
    const sourceType = rawRef.type || entity.entity_type;
    const sourceId = rawRef.id || entity.entity_id;
    const event = migrateChangeEvent(entity);
    const refs = [
      { type: sourceType, id: sourceId },
      event.entity_ref,
      ...event.source_refs,
      ...event.relation_refs,
    ];
    if (changed.has(entityKey) || refs.some((ref) => ref && changed.has(key(ref.type, ref.id)))) {
      add(workLogPerformedDate(event) || localDate(event.occurred_at, timezone));
    }
  }
  return { dates: [...dates].sort(), sourceHashes, checkedThrough: today };
}
