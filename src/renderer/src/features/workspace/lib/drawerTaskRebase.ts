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
/** 期限の時刻と知らせ（#785）。本人が触れていない時は送らず、Core に保存値を残させる。 */
const SCHEDULE_END_KEYS = ["end_time", "notify_before_minutes"] as const;
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

/**
 * storeの日程（保存済みのEntity）と、フォームから作った日程を比べる。フォームが持つ欄だけを見る
 * （version・source・device_id など保存の時に付く欄は、フォームの日程には無い）。全部の欄で比べると
 * 外で何も変わっていなくても毎回「上書きしました」と出ていた（#785 で時刻を足した時に見つけた）。
 */
function sameStoredSchedule(stored: Entity | undefined, planned: Entity | undefined): boolean {
  if (!stored || !planned) return !stored && !planned;
  return Object.keys(planned)
    .filter((key) => !VOLATILE_SCHEDULE_KEYS.has(key))
    .every((key) => sameValue(stored[key], planned[key]));
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
    !sameStoredSchedule(currentSchedule, initialSchedule) &&
    !sameStoredSchedule(currentSchedule, editedSchedule)
  ) {
    overwritten.push(SCHEDULE_KEY);
  }

  // 期限の時刻と知らせの欄に本人が触れていなければ、その 2 つは送らない（#785）。引き出しを開いた後に
  // スマホや AI が付けた時刻を、日付だけの保存が null で消さないため（省いた欄は Core が保存値を残す）。
  const untouchedEndKeys = SCHEDULE_END_KEYS.filter((key) =>
    sameValue(initialSchedule?.[key] ?? null, editedSchedule?.[key] ?? null),
  );
  const operations = edited
    // 日程に触れていなければScheduleを送らない（送らなければCoreは日程を変えない）。
    .filter((operation) => operation.type !== "schedule" || scheduleChanged)
    .map((operation) => {
      if (operation.type === "task" && operation.entity.id === task.id)
        return { ...operation, entity: task };
      if (operation.type === "schedule" && untouchedEndKeys.length > 0) {
        const entity = { ...operation.entity };
        for (const key of untouchedEndKeys) delete entity[key];
        return { ...operation, entity };
      }
      return operation;
    });
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
