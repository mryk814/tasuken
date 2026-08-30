const BURST_WINDOW_MINUTES = 20;
const BURST_MINIMUM_EVENTS = 3;

type ActivityTimelineLayout = {
  start_minutes: number;
  end_minutes: number;
  top: number;
  height: number;
  lane: number;
  lane_count: number;
};

type BurstSource = ActivityTimelineLayout & {
  id: string;
  item_type: string;
  start_at: string;
  end_at: string;
  display_kind: string;
  origin?: string | { kind?: unknown } | null;
  event?: { origin?: string | { kind?: unknown } | null };
  theme_ids: string[];
};

export type ActivityTimelineBurstOrigin = "tasken" | "ai" | "imported" | "unknown" | "mixed";

export type ActivityTimelineBurst<T extends BurstSource> = ActivityTimelineLayout & {
  id: string;
  item_type: "burst";
  start_at: string;
  end_at: string;
  display_kind: T["display_kind"] | "mixed";
  origin: ActivityTimelineBurstOrigin;
  theme_ids: string[];
  events: T[];
};

type CalendarItem<T extends BurstSource> = T | ActivityTimelineBurst<T>;

function isStandalonePoint<T extends BurstSource>(item: T): boolean {
  return item.item_type === "event" && item.end_minutes <= item.start_minutes;
}

function rawOrigin(item: BurstSource): string {
  const value = item.origin ?? item.event?.origin;
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value && typeof value === "object")
    return String(value.kind || "")
      .trim()
      .toLowerCase();
  return "";
}

function originKind(item: BurstSource): Exclude<ActivityTimelineBurstOrigin, "mixed"> {
  const value = rawOrigin(item);
  if (["ai", "agent", "ai_agent", "mcp", "ai_suggested"].includes(value)) return "ai";
  if (value === "imported") return "imported";
  if (
    [
      "tasken",
      "manual",
      "renderer_save",
      "application_command",
      "quick_capture",
      "user",
      "human",
      "system",
    ].includes(value)
  )
    return "tasken";
  return "unknown";
}

function uniformOrMixed<T extends string>(values: T[]): T | "mixed" {
  return values.every((value) => value === values[0]) ? values[0] : "mixed";
}

function assignVisualLanes<T extends BurstSource>(
  items: Array<CalendarItem<T>>,
): Array<CalendarItem<T>> {
  const ordered = [...items].sort(
    (left, right) =>
      left.top - right.top || left.height - right.height || left.id.localeCompare(right.id),
  );
  const laidOut: Array<CalendarItem<T> & { lane: number; lane_count: number }> = [];
  let active: Array<CalendarItem<T> & { lane: number; lane_count: number }> = [];
  let cluster: Array<CalendarItem<T> & { lane: number; lane_count: number }> = [];
  let maxLanes = 0;

  const finishCluster = () => {
    for (const item of cluster) item.lane_count = Math.max(1, maxLanes);
    cluster = [];
    maxLanes = 0;
  };

  for (const candidate of ordered) {
    active = active.filter((item) => item.top + item.height > candidate.top);
    if (!active.length && cluster.length) finishCluster();

    const usedLanes = new Set(active.map((item) => item.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane += 1;
    const item = { ...candidate, lane, lane_count: 1 };
    active.push(item);
    cluster.push(item);
    maxLanes = Math.max(maxLanes, active.length);
    laidOut.push(item);
  }
  finishCluster();
  return laidOut;
}

/**
 * Condenses visually colliding standalone points without changing their source
 * events. Sessions remain individual blocks; a burst keeps all event details
 * for the calendar detail panel.
 */
export function buildActivityTimelineBursts<T extends BurstSource>(
  items: T[],
): Array<CalendarItem<T>> {
  const points = items
    .filter(isStandalonePoint)
    .sort(
      (left, right) => left.start_minutes - right.start_minutes || left.id.localeCompare(right.id),
    );
  const bursts: T[][] = [];
  let cluster: T[] = [];

  const finishCluster = () => {
    if (cluster.length >= BURST_MINIMUM_EVENTS) bursts.push(cluster);
    cluster = [];
  };

  for (const point of points) {
    const previous = cluster.at(-1);
    if (previous && point.start_minutes - previous.start_minutes > BURST_WINDOW_MINUTES) {
      finishCluster();
    }
    cluster.push(point);
  }
  finishCluster();

  const firstByEventId = new Map(bursts.map((burst) => [burst[0].id, burst]));
  const hiddenEventIds = new Set(bursts.flatMap((burst) => burst.slice(1).map((item) => item.id)));
  const condensed = items.flatMap<CalendarItem<T>>((item) => {
    const burst = firstByEventId.get(item.id);
    if (!burst) return hiddenEventIds.has(item.id) ? [] : [item];
    const top = Math.min(...burst.map((event) => event.top));
    const bottom = Math.max(...burst.map((event) => event.top + event.height));
    return [
      {
        id: `burst:${burst[0].id}`,
        item_type: "burst",
        start_at: burst[0].start_at,
        end_at: burst.at(-1)?.end_at || burst[0].end_at,
        display_kind: uniformOrMixed(burst.map((event) => event.display_kind)),
        origin: uniformOrMixed(burst.map(originKind)),
        theme_ids: [...new Set(burst.flatMap((event) => event.theme_ids))],
        events: burst,
        start_minutes: Math.min(...burst.map((event) => event.start_minutes)),
        end_minutes: Math.max(...burst.map((event) => event.end_minutes)),
        top,
        height: bottom - top,
        lane: 0,
        lane_count: 1,
      },
    ];
  });

  return assignVisualLanes(condensed);
}
