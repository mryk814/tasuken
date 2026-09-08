import { buildActivityEvent } from "../../src/shared/activityEvent.mjs";

// Entirely synthetic. IDs and dates are fixed so a source can be checked across snapshots.
export const evaluationIdentity = {
  workspaceId: "tasken-publication-evaluation-548",
  timezone: "Asia/Tokyo",
  fromDate: "2026-09-01",
  today: "2026-09-08",
  initialAt: "2026-09-08T01:00:00.000Z",
  updatedAt: "2026-09-08T02:00:00.000Z",
  historicalDates: ["2025-12-31", "2026-01-01", "2026-08-15"],
};

function event(id, type, entity, date, kind, summary, extra = {}) {
  return buildActivityEvent({
    id,
    entity_type: type,
    entity_id: entity.id,
    event_kind: kind,
    occurred_at: `${date}T01:00:00.000Z`,
    after: entity,
    summary,
    metadata: { dedupe_key: id },
    ...extra,
  });
}

function workLog(id, date, body, enteredAt = `${date}T02:00:00.000Z`, extra = {}) {
  const report = {
    schema: "tasken-work-log/v1",
    performed_date: date,
    date_precision: "day",
    assertion: "user_report",
  };
  const note = {
    id,
    title: body.split("。")[0],
    body_markdown: body,
    project_id: "theme-a",
    version: 1,
    properties_json: { work_log: report },
    ...extra,
  };
  return {
    note,
    event: event(`event-${id}`, "note", note, date, "note_created", body, {
      occurred_at: enteredAt,
      metadata: { dedupe_key: `event-${id}`, work_log: report },
    }),
  };
}

export function publicationFixture(snapshot = "initial") {
  if (!["initial", "updated"].includes(snapshot)) throw new Error("Unknown fixture snapshot");
  const updated = snapshot === "updated";
  const themes = [
    { id: "theme-a", name: "材料Aの探索", version: 1, default_ai_visibility: ["m365"] },
    { id: "theme-b", name: "材料Bの探索", version: 1, default_ai_visibility: ["m365"] },
  ];
  const taskOld = {
    id: "task-history",
    title: "材料Aの前処理を比較",
    project_id: "theme-a",
    state: "in_progress",
    version: 1,
  };
  const taskCurrent = {
    ...taskOld,
    title: "材料Bで前処理を再検討",
    project_id: "theme-b",
    version: 2,
  };
  const planned = {
    id: "task-planned",
    title: "材料Aを加熱する予定",
    project_id: "theme-a",
    state: "todo",
    version: 1,
  };
  const ai = {
    id: "task-ai-unconfirmed",
    title: "AIの文献照合",
    project_id: "theme-a",
    state: "in_progress",
    version: 1,
    ai_authority: "ai_generated",
  };
  const calibration = {
    id: "task-calibration",
    title: "校正用の架空Task",
    project_id: "theme-a",
    state: "done",
    version: 1,
  };
  const logs = [
    workLog("log-january", "2026-01-01", "材料Aの試行は失敗した。原因は未確定である。"),
    workLog(
      "log-september",
      "2026-09-06",
      "材料Aの試料TEST-Aを測定した。再測定が必要で、結論はまだない。",
    ),
    workLog(
      "log-hypothesis",
      "2026-09-07",
      "前処理が関係するかもしれない。原因が判明したわけではない。",
    ),
    workLog(
      "log-private",
      "2026-09-06",
      "NEVER_EXPORT_548 個人でも業務でもない非公開の架空文字列。",
      undefined,
      { ai_visibility: [] },
    ),
    workLog(
      "log-withdraw",
      "2026-09-06",
      "WITHDRAW_548 公開取消しを検証するための架空記録。",
      undefined,
      updated ? { ai_visibility: [], version: 2 } : {},
    ),
  ];
  if (updated)
    logs.push(
      workLog(
        "log-late",
        "2026-09-04",
        "LATE_548 9月4日に試料TEST-Lを観察した。",
        "2026-09-08T01:30:00.000Z",
      ),
    );
  const capture = {
    id: "capture-corrected",
    title: "未整理の測定値メモ",
    state: "untriaged",
    project_id: "theme-a",
    captured_at: "2026-09-06T03:00:00.000Z",
    version: updated ? 2 : 1,
    text:
      (updated ? "CORRECTED_548 訂正後の記録値は10.2。" : "SUPERSEDED_548 暫定の記録値は12.4。") +
      "これは全文リンク確認用の架空入力であり、検証済み実績ではない。\n".repeat(180) +
      "FULL_TEXT_END_548",
  };
  const historical = event(
    "history-august",
    "task",
    taskOld,
    "2026-08-15",
    "task_work_recorded",
    "材料Aの前処理条件を二つ比較した。優劣はまだ結論がない。",
  );
  return {
    themes,
    tasks: [taskCurrent, planned, ai, calibration],
    notes: logs.map(({ note }) => note),
    capture_entries: [capture],
    change_events: [
      ...themes.map((theme) =>
        event(`created-${theme.id}`, "theme", theme, "2025-01-01", "theme_created", theme.name),
      ),
      event(
        "calibration-december",
        "task",
        calibration,
        "2025-12-31",
        "task_completed",
        "校正手順の確認を完了した。",
      ),
      historical,
      // A replay must not become a second unit of work or a second source.
      { ...historical, id: "history-august-replayed" },
      event(
        "planning-september",
        "task",
        planned,
        "2026-09-06",
        "task_created",
        "加熱する予定を立てた。まだ実施していない。",
      ),
      event(
        "ai-september",
        "task",
        ai,
        "2026-09-06",
        "task_ai_reported",
        "AIが比較完了を報告した。人間はまだ確認していない。",
      ),
      ...logs.map(({ event: row }) => row),
    ],
  };
}

export const publicationQuestions = [
  {
    id: "day-work",
    question: "2026年9月6日に何をしたか。予定ではなく記録された実績を、出典付きで挙げて。",
    from: "2026-09-06",
    to: "2026-09-06",
    stages: ["work_recorded"],
    expectedSources: {
      initial: ["note:log-september", "note:log-withdraw"],
      updated: ["note:log-september"],
    },
    allowedFacts: ["試料TEST-Aを測定したという本人の記録がある。", "再測定が必要で結論はない。"],
    forbiddenClaims: [
      "予定した加熱を実施した。",
      "AI報告を本人が確認した。",
      "未整理メモの10.2を検証済み測定結果として扱う。",
      "作業時間を推測する。",
    ],
  },
  {
    id: "week-uncertainty",
    question: "2026年9月7日から13日の週、材料Aで分かったことと、まだ結論がないことは何か。",
    from: "2026-09-07",
    to: "2026-09-13",
    stages: ["work_recorded"],
    themeId: "theme-a",
    expectedSources: { initial: ["note:log-hypothesis"], updated: ["note:log-hypothesis"] },
    allowedFacts: [
      "前処理が関係するかもしれないという仮説がある。",
      "9月8日時点の公開物で、9月9日以降は未公開。",
    ],
    forbiddenClaims: ["前処理が原因と判明した。", "記録がない日は何もしなかった。"],
  },
  {
    id: "month-history",
    question:
      "2026年8月にTheme A（材料Aの探索）にいたTaskは何を進めていたか。現在の所属と区別して。",
    from: "2026-08-01",
    to: "2026-08-31",
    stages: ["work_recorded"],
    themeId: "theme-a",
    expectedSources: { initial: ["task:task-history"], updated: ["task:task-history"] },
    allowedFacts: ["当時のTaskは材料Aの前処理条件を二つ比較していた。", "優劣はまだ結論がない。"],
    forbiddenClaims: [
      "当時から材料Bに所属していた。",
      "再送を2回の実績として数える。",
      "比較に勝った条件を補う。",
    ],
  },
  {
    id: "year-evidence",
    question:
      "2025年9月9日から2026年9月8日の記録で、出典を確認できる実績と、未公開・未反映の範囲を示して。",
    from: "2025-09-09",
    to: "2026-09-08",
    stages: ["work_recorded"],
    expectedSources: {
      initial: [
        "task:task-calibration",
        "task:task-history",
        "note:log-january",
        "note:log-september",
        "note:log-hypothesis",
        "note:log-withdraw",
      ],
      updated: [
        "task:task-calibration",
        "task:task-history",
        "note:log-january",
        "note:log-september",
        "note:log-hypothesis",
        "note:log-late",
      ],
    },
    allowedFacts: [
      "公開済み日の出典だけを挙げられる。",
      "更新後に9月4日実施・9月8日入力の遅延記録が加わる。",
      "期間の全日が公開されているわけではない。",
    ],
    forbiddenClaims: [
      "一年の全活動を網羅した。",
      "Android未送信が0件だ。",
      "クラウド同期やAI索引が最新だ。",
      "非公開の内容を推測する。",
    ],
  },
];

export function truncationFixture() {
  const task = {
    id: "task-truncation",
    title: "取得上限の架空Task",
    version: 1,
    ai_visibility: ["m365"],
  };
  return {
    tasks: [task],
    change_events: Array.from({ length: 501 }, (_, index) =>
      event(
        `truncated-${String(index).padStart(4, "0")}`,
        "task",
        task,
        "2026-09-08",
        "task_work_recorded",
        `取得上限の架空記録 ${index}`,
      ),
    ),
  };
}
