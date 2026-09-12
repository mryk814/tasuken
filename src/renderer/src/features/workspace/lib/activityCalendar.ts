import type { CalendarEvent } from "../../../../../shared/calendar";

export interface ActivityCalendarTimelineItem {
  id: string;
  item_type: "calendar";
  start_at: string;
  end_at: string;
  display_kind: "calendar";
  theme_ids: string[];
  calendar_event: CalendarEvent;
}

export function buildActivityCalendarTimelineItems(
  events: CalendarEvent[],
): ActivityCalendarTimelineItem[] {
  return events
    .filter((event) => Boolean(event.id) && Number.isFinite(Date.parse(event.startTime)))
    .map((event) => ({
      id: `calendar:${event.id}`,
      item_type: "calendar" as const,
      start_at: event.startTime,
      end_at: event.endTime,
      display_kind: "calendar" as const,
      theme_ids: [],
      calendar_event: event,
    }));
}
