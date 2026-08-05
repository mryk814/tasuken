export type CalendarProvider = "microsoft";

export interface CalendarConnectionStatus {
  provider: CalendarProvider | null;
  accountName: string;
  connected: boolean;
  lastFetchedAt: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string;
  meetingUrl: string;
  calendarName: string;
  sensitivity: "normal" | "private";
}

export interface CalendarEventsResult {
  provider: CalendarProvider;
  events: CalendarEvent[];
  fetchedAt: string;
  stale: boolean;
  error?: string;
}

export interface CalendarConnectRequest {
  provider: CalendarProvider;
}

export interface CalendarDisconnectRequest {
  provider: CalendarProvider;
}
