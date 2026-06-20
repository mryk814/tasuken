import type { CaptureEntry, PlanNode, Schedule, Task, Waiting } from "./types";

export type TodayEntry =
  | { type: "task"; task: Task; schedule?: Schedule }
  | { type: "waiting"; waiting: Waiting; schedule?: Schedule }
  | { type: "milestone"; planNode: PlanNode; schedule?: Schedule }
  | { type: "capture"; captureEntry: CaptureEntry };

export interface TodoView {
  tasks: Array<{ task: Task; schedule?: Schedule }>;
}

export interface InboxView {
  entries: CaptureEntry[];
}

export interface WaitingView {
  waitings: Array<{ waiting: Waiting; schedule?: Schedule }>;
}

export interface TimelineRow {
  planNode: PlanNode;
  schedule?: Schedule;
  children: TimelineRow[];
}

export interface TimelineView {
  rows: TimelineRow[];
}
