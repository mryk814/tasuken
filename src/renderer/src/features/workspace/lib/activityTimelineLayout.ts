export const ACTIVITY_TIMELINE_PIXELS_PER_HOUR = 36;
export const ACTIVITY_TIMELINE_DAY_MINUTES = 24 * 60;
export const ACTIVITY_TIMELINE_DAY_HEIGHT =
  (ACTIVITY_TIMELINE_DAY_MINUTES / 60) * ACTIVITY_TIMELINE_PIXELS_PER_HOUR;
export const ACTIVITY_TIMELINE_POINT_HEIGHT = 32;

export type ActivityTimelineLayoutItem = {
  id: string;
  start_at: string;
  end_at?: string | null;
};

export type ActivityTimelineLayoutOptions = {
  date: string;
  pixelsPerHour?: number;
  pointHeight?: number;
};

export type ActivityTimelineLayout = {
  start_minutes: number;
  end_minutes: number;
  top: number;
  height: number;
  lane: number;
  lane_count: number;
};

type Candidate<T extends ActivityTimelineLayoutItem> = T &
  Omit<ActivityTimelineLayout, "lane" | "lane_count"> & {
    render_start_minutes: number;
    render_end_minutes: number;
  };

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function minuteOffset(timestamp: number, dayStart: number): number {
  return (timestamp - dayStart) / 60_000;
}

function dayBounds(date: string): { start: number; end: number } | null {
  const start = Date.parse(`${date}T00:00:00+09:00`);
  return Number.isFinite(start)
    ? { start, end: start + ACTIVITY_TIMELINE_DAY_MINUTES * 60_000 }
    : null;
}

/**
 * Projects a selected JST day onto a fixed 24-hour coordinate system.
 * Point events retain their semantic timestamp and get a minimum visual height;
 * their rendered height is also used for lane allocation so nearby controls do
 * not sit on top of one another.
 */
export function buildActivityTimelineLayout<T extends ActivityTimelineLayoutItem>(
  items: T[],
  {
    date,
    pixelsPerHour = ACTIVITY_TIMELINE_PIXELS_PER_HOUR,
    pointHeight = ACTIVITY_TIMELINE_POINT_HEIGHT,
  }: ActivityTimelineLayoutOptions,
): Array<T & ActivityTimelineLayout> {
  const bounds = dayBounds(date);
  if (!bounds || !Number.isFinite(pixelsPerHour) || pixelsPerHour <= 0) return [];

  const pixelsPerMinute = pixelsPerHour / 60;
  const dayHeight = ACTIVITY_TIMELINE_DAY_MINUTES * pixelsPerMinute;
  const minimumEventHeight = Math.min(pointHeight, dayHeight);
  const candidates: Candidate<T>[] = items
    .flatMap((item) => {
      const start = Date.parse(text(item.start_at));
      if (!text(item.id) || !Number.isFinite(start) || start >= bounds.end) return [];
      const parsedEnd = Date.parse(text(item.end_at));
      const isPoint = !Number.isFinite(parsedEnd) || parsedEnd <= start;
      const end = isPoint ? start : parsedEnd;
      if (end <= bounds.start) return [];

      const clippedStart = Math.max(start, bounds.start);
      const clippedEnd = Math.min(end, bounds.end);
      const startMinutes = minuteOffset(clippedStart, bounds.start);
      const endMinutes = Math.max(startMinutes, minuteOffset(clippedEnd, bounds.start));
      const semanticHeight = Math.max(0, (endMinutes - startMinutes) * pixelsPerMinute);
      const height = Math.max(minimumEventHeight, semanticHeight);
      const top = Math.min(startMinutes * pixelsPerMinute, dayHeight - height);
      const renderStartMinutes = top / pixelsPerMinute;
      return [
        {
          ...item,
          start_minutes: startMinutes,
          end_minutes: endMinutes,
          top,
          height,
          render_start_minutes: renderStartMinutes,
          render_end_minutes: renderStartMinutes + height / pixelsPerMinute,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.start_minutes - right.start_minutes ||
        left.render_end_minutes - right.render_end_minutes ||
        left.id.localeCompare(right.id),
    );

  const laidOut: Array<Candidate<T> & { lane: number; lane_count: number }> = [];
  let active: Array<Candidate<T> & { lane: number; lane_count: number }> = [];
  let cluster: Array<Candidate<T> & { lane: number; lane_count: number }> = [];
  let maxLanes = 0;

  const finishCluster = () => {
    for (const item of cluster) item.lane_count = Math.max(1, maxLanes);
    cluster = [];
    maxLanes = 0;
  };

  for (const candidate of candidates) {
    active = active.filter((item) => item.render_end_minutes > candidate.render_start_minutes);
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

  return laidOut.map(
    ({
      render_start_minutes: _renderStartMinutes,
      render_end_minutes: _renderEndMinutes,
      ...item
    }) => item as T & ActivityTimelineLayout,
  );
}
