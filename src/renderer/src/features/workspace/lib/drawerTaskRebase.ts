import type { Entity, SaveOperation } from "../types";

/**
 * 編集ドロワーのTask保存を、利用者がフォームで変えた欄だけに絞り、最新のTaskへ乗せる。
 *
 * ドロワーは開いた時点のTaskとフォームの値からTask全体を組み立てる。一方で保存時の
 * expected versionは最新のstoreから取るため、そのまま送ると版の照合を通り抜け、開いて
 * いる間に外（Android・MCP・別window）で入った変更を開いた時点の値へ黙って巻き戻す。
 *
 * そこで、前回の保存（または開いた時点）のフォームから作った計画と、今のフォームから
 * 作った計画を比べ、違う欄だけを利用者の変更とみなす。同じ組み立てを両方に通すので、
 * 正規化だけで生じる差（null と空文字など）は変更に数えない。
 */
export interface DrawerTaskRebaseInput {
  /** 前回の保存（または開いた時点）のフォームから作った計画。 */
  initial: SaveOperation[];
  /** 今のフォームから作った計画。 */
  edited: SaveOperation[];
  /** storeにある最新のTask。新規作成や見つからないときはundefined。 */
  currentTask: Entity | undefined;
  /** storeにある、そのTaskの最新のSchedule。 */
  currentSchedule: Entity | undefined;
}

export interface DrawerTaskRebaseResult {
  operations: SaveOperation[];
  /** 外でも変わっていたが、この画面の値を優先して保存する欄。 */
  overwritten: string[];
}

const SCHEDULE_KEY = "schedule";
// 計画ごとに作り直される時刻は、利用者の変更に数えない。
const VOLATILE_SCHEDULE_KEYS = new Set(["created_at", "updated_at"]);

function normalized(value: unknown): unknown {
  return value === undefined || value === "" ? null : value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function changedKeys(before: Entity, after: Entity): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !sameValue(before[key], after[key]),
  );
}

function scheduleOf(operations: SaveOperation[]): Entity | undefined {
  return operations.find((operation) => operation.type === "schedule")?.entity;
}

function sameSchedule(left: Entity | undefined, right: Entity | undefined): boolean {
  if (!left || !right) return !left && !right;
  return changedKeys(left, right).every((key) => VOLATILE_SCHEDULE_KEYS.has(key));
}

export function rebaseDrawerTaskOperations(input: DrawerTaskRebaseInput): DrawerTaskRebaseResult {
  const { initial, edited, currentTask, currentSchedule } = input;
  const initialTask = initial.find((operation) => operation.type === "task")?.entity;
  const editedTask = edited.find((operation) => operation.type === "task")?.entity;
  if (!currentTask || !initialTask || !editedTask || initialTask.id !== currentTask.id) {
    return { operations: edited, overwritten: [] };
  }

  const userChanged = changedKeys(initialTask, editedTask);
  const overwritten = userChanged.filter(
    (key) =>
      !sameValue(currentTask[key], initialTask[key]) &&
      !sameValue(currentTask[key], editedTask[key]),
  );
  const task: Entity = { ...currentTask };
  for (const key of userChanged) task[key] = editedTask[key];

  const initialSchedule = scheduleOf(initial);
  const editedSchedule = scheduleOf(edited);
  const scheduleChanged = !sameSchedule(initialSchedule, editedSchedule);
  if (
    scheduleChanged &&
    currentSchedule &&
    !sameSchedule(currentSchedule, initialSchedule) &&
    !sameSchedule(currentSchedule, editedSchedule)
  ) {
    overwritten.push(SCHEDULE_KEY);
  }

  const operations = edited
    // 日程に触れていなければScheduleを送らない（送らなければCoreは日程を変えない）。
    .filter((operation) => operation.type !== "schedule" || scheduleChanged)
    .map((operation) =>
      operation.type === "task" && operation.entity.id === task.id
        ? { ...operation, entity: task }
        : operation,
    );
  return { operations, overwritten };
}

const FIELD_LABELS: Record<string, string> = {
  title: "題名",
  description: "メモ",
  state: "状態",
  project_id: "Theme",
  section_id: "セクション",
  priority: "優先度",
  planning_shelf: "棚",
  planned_start_time: "開始時刻",
  planned_duration_minutes: "所要時間",
  reminder_at: "リマインダー",
  place_reminder: "場所",
  checklist_items: "チェックリスト",
  completion_note: "完了メモ",
  repeat_rule: "繰り返し",
  [SCHEDULE_KEY]: "日程",
};

/** 外の変更を上書きした欄を、トーストで示す短い文にする。 */
export function describeOverwrittenFields(fields: string[]): string {
  const labels = [...new Set(fields.map((field) => FIELD_LABELS[field] || "ほかの欄"))];
  return `${labels.join("・")}は、ほかで変わっていた値をこの画面の値で上書きしました。`;
}
