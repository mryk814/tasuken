import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WorkspaceDatabase } from "../src/main/repositories/workspaceRepository.mjs";
import { createSnapshot } from "../src/main/services/snapshotService.mjs";
import { resolveTaskenDatabasePath } from "../src/shared/taskenPaths.mjs";

const localDatabasePath = resolveTaskenDatabasePath();

const ids = {
  theme: {
    personal: "theme-personal-default",
    llzo: "a1000000-0000-4000-8000-000000000001",
    aluminum: "a1000000-0000-4000-8000-000000000002",
  },
  plan: {
    activeLearning: "a2000000-0000-4000-8000-000000000004",
    candidateBatch: "a2000000-0000-4000-8000-000000000005",
    validation: "a2000000-0000-4000-8000-000000000006",
  },
  task: {
    candidateReview: "a3000000-0000-4000-8000-000000000005",
    weighCandidates: "a3000000-0000-4000-8000-000000000006",
    sinterCandidates: "a3000000-0000-4000-8000-000000000007",
    eisMeasure: "a3000000-0000-4000-8000-000000000008",
    xrdCandidates: "a3000000-0000-4000-8000-000000000009",
    conferenceAbstract: "a3000000-0000-4000-8000-000000000013",
    labSafety: "a3000000-0000-4000-8000-000000000011",
    weeklyBackup: "a3000000-0000-4000-8000-000000000012",
    uncertaintyCheck: "a3000000-0000-4000-8000-000000000021",
  },
  schedule: {
    candidateReview: "a5000000-0000-4000-8000-000000000012",
    weighCandidates: "a5000000-0000-4000-8000-000000000013",
    sinterCandidates: "a5000000-0000-4000-8000-000000000014",
    eisMeasure: "a5000000-0000-4000-8000-000000000015",
    xrdCandidates: "a5000000-0000-4000-8000-000000000016",
    labSafety: "a5000000-0000-4000-8000-000000000018",
    weeklyBackup: "a5000000-0000-4000-8000-000000000019",
    conferenceAbstract: "a5000000-0000-4000-8000-000000000020",
    uncertaintyCheck: "a5000000-0000-4000-8000-000000000026",
  },
};

const scenarios = new Set(["experiment", "model", "report", "waiting"]);

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`日付はYYYY-MM-DDで指定してください: ${value}`);
  const parsed = new Date(`${value}T12:00:00+09:00`);
  if (Number.isNaN(parsed.valueOf()) || localDateString(parsed) !== value) throw new Error(`実在しない日付です: ${value}`);
  return value;
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function timestamp(value, hour = 9, minute = 0) {
  return new Date(`${value}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`).toISOString();
}

function deterministicId(...parts) {
  const hex = crypto.createHash("sha256").update(`tasken-materials-demo:${parts.join(":")}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function save(type, entity) {
  return { action: "save", type, entity, options: { source: "development-refresh", skipSync: true } };
}

function scheduleEntity(id, ownerType, ownerId, startDate, endDate, dateKind, confidence = "fixed", extras = {}) {
  return {
    id,
    owner_type: ownerType,
    owner_id: ownerId,
    start_date: startDate,
    end_date: endDate,
    date_kind: dateKind,
    confidence,
    granularity: extras.granularity || "day",
    range_semantics: extras.range_semantics ?? null,
    baseline_start: extras.baseline_start || null,
    baseline_end: extras.baseline_end || null,
    actual_start: extras.actual_start || null,
    actual_end: extras.actual_end || null,
    source: "development-refresh",
  };
}

function updateExistingSchedule(repository, scheduleId, changes) {
  const existing = repository.get("schedule", scheduleId);
  if (!existing) throw new Error(`更新対象のScheduleがありません: ${scheduleId}`);
  return save("schedule", { ...existing, ...changes, source: "development-refresh" });
}

function assertMaterialsDemo(repository) {
  const llzo = repository.get("theme", ids.theme.llzo);
  const aluminum = repository.get("theme", ids.theme.aluminum);
  if (llzo?.code !== "MI-LLZO-26" || aluminum?.code !== "CIRC-AL-07") {
    throw new Error("材料MI開発Workspaceではないため更新を中止しました。先に npm.cmd run workspace:materials-demo を実行してください。");
  }
}

function createBackup(repository, targetPath, date, mode, scenario) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupDirectory = path.join(path.dirname(targetPath), "development-data-backups", `${stamp}-${mode}${scenario ? `-${scenario}` : ""}`);
  fs.mkdirSync(backupDirectory, { recursive: true });
  const snapshotPath = path.join(backupDirectory, `workspace-before-update-${date}.tasken.zip`);
  createSnapshot(repository.loadWorkspace(true)).writeZip(snapshotPath);
  return snapshotPath;
}

function buildRefreshOperations(repository, date) {
  const existingDailyNote = repository.list("note").find((entry) => entry.properties_json?.document_role === "daily_scratchpad" && entry.properties_json?.scratchpad_date === date);
  const existingStatus = repository.list("status_update").find((entry) => entry.theme_id === ids.theme.llzo && entry.date === date);
  const dailyNoteId = existingDailyNote?.id || deterministicId(date, "refresh", "daily-note");
  const statusId = existingStatus?.id || deterministicId(date, "refresh", "status");
  const eventId = deterministicId(date, "refresh", "event");
  return [
    updateExistingSchedule(repository, ids.schedule.candidateReview, { start_date: date, end_date: date }),
    updateExistingSchedule(repository, ids.schedule.weighCandidates, { start_date: date, end_date: date, actual_start: date }),
    updateExistingSchedule(repository, ids.schedule.sinterCandidates, { start_date: addDays(date, -1), end_date: addDays(date, 4), actual_start: addDays(date, -1) }),
    updateExistingSchedule(repository, ids.schedule.eisMeasure, { start_date: addDays(date, 3), end_date: addDays(date, 7) }),
    updateExistingSchedule(repository, ids.schedule.xrdCandidates, { start_date: addDays(date, 2), end_date: addDays(date, 4) }),
    updateExistingSchedule(repository, ids.schedule.labSafety, { start_date: addDays(date, -2), end_date: addDays(date, -2) }),
    updateExistingSchedule(repository, ids.schedule.weeklyBackup, { start_date: date, end_date: date }),
    updateExistingSchedule(repository, ids.schedule.conferenceAbstract, { start_date: date, end_date: addDays(date, 6) }),
    updateExistingSchedule(repository, ids.schedule.uncertaintyCheck, { start_date: date, end_date: date, actual_start: date }),
    save("note", {
      ...existingDailyNote,
      id: dailyNoteId,
      project_id: ids.theme.personal,
      theme_id: ids.theme.personal,
      title: `Daily Scratchpad ${date}`,
      note_type: "note",
      content_format: "markdown",
      body_markdown: "## 朝\n\n- 候補バッチの進捗を確認\n- 今日の測定・解析ブロックを確保\n\n## あとで整理\n\n- 実測値と予測値の差を残す\n- 判断を変えた理由をStatus Updateへ書く",
      properties_json: { document_role: "daily_scratchpad", scratchpad_date: date },
      source: "development-refresh",
    }),
    save("status_update", {
      ...existingStatus,
      id: statusId,
      theme_id: ids.theme.llzo,
      date,
      status: "on_track",
      summary: "候補バッチの合成とモデル診断を並行中。今日の実験・解析・報告の導線を更新した。",
      progress: 64,
      risks: "XRD測定枠とロット差の原因が未確定",
      next_actions: "焼成ログ確認、測定枠確定、calibration curve更新",
      source: "development-refresh",
    }),
    save("change_event", {
      id: eventId,
      entity_type: "note",
      entity_id: dailyNoteId,
      changed_at: timestamp(date, 9, 5),
      change_type: "created",
      reason: `${date}の開発用Workspaceを今日の状態へ更新`,
      source: "manual",
    }),
  ];
}

function buildScenarioOperations(date, scenario) {
  const taskId = deterministicId(date, scenario, "task");
  const taskScheduleId = deterministicId(date, scenario, "task-schedule");
  const noteId = deterministicId(date, scenario, "note");
  const eventId = deterministicId(date, scenario, "event");
  const commonTask = { id: taskId, project_id: ids.theme.llzo, priority: "high", source: "development-refresh" };
  const commonNote = { id: noteId, project_id: ids.theme.llzo, theme_id: ids.theme.llzo, note_type: "note", content_format: "markdown", source: "development-refresh" };
  const definitions = {
    experiment: {
      task: { ...commonTask, plan_node_id: ids.plan.candidateBatch, title: `候補バッチ ${date} の焼成後密度を測定`, state: "doing", planned_start_time: "10:00", planned_duration_minutes: 90, checklist_items: [
        { id: `${taskId}-1`, title: "乾燥質量を記録", done: true, sort_order: 0, completed_at: timestamp(date, 10, 5) },
        { id: `${taskId}-2`, title: "寸法を3点測定", done: false, sort_order: 1, completed_at: null },
        { id: `${taskId}-3`, title: "相対密度を計算", done: false, sort_order: 2, completed_at: null },
      ] },
      schedule: scheduleEntity(taskScheduleId, "task", taskId, date, date, "point", "fixed", { actual_start: date }),
      note: { ...commonNote, title: `候補バッチ ${date} 実験ログ`, body_markdown: "# 観察\n\n候補2のペレット端部に微小クラック。測定値は除外せず、成形圧と炉内位置を併記する。\n\n## 次の判断\n\n密度5.0 g/cm³未満ならEIS前に再成形を検討する。" },
      capture: { id: deterministicId(date, scenario, "capture"), text: "候補2の端部に微小クラック。写真と炉内位置を実験ログへ付ける", title: "候補2 ペレット表面", kind: "inbox", content_type: "text", project_id: ids.theme.llzo, captured_at: timestamp(date, 10, 25), state: "untriaged", source: "development-refresh" },
    },
    model: {
      task: { ...commonTask, plan_node_id: ids.plan.activeLearning, title: `${date} のロット別calibration curveを更新`, state: "doing", planned_start_time: "13:30", planned_duration_minutes: 120 },
      schedule: scheduleEntity(taskScheduleId, "task", taskId, date, date, "point", "fixed", { actual_start: date }),
      note: { ...commonNote, title: `モデル診断メモ ${date}`, body_markdown: "# 今日の診断\n\nLOCO-CVとleave-one-composition-outを並べ、平均MAEだけでなくロット別coverageを確認する。\n\n> [!WARNING]\n> calibrationに使ったfoldで被覆率を評価しない。\n\n## 保留\n\nSEM特徴量は受領後に追加し、現モデルとの差分を残す。" },
      knowledge: { id: deterministicId(date, scenario, "knowledge"), theme_id: ids.theme.llzo, title: `${date}: coverage低下は全ロット共通ではない`, body: "ロット別calibration curveを確認し、全体指標だけでは見えない偏りを再確認する。", node_type: "evidence", confidence: "medium", status: "active", source_type: "note", source_id: noteId, source: "development-refresh" },
    },
    report: {
      task: { ...commonTask, plan_node_id: ids.plan.validation, title: `${date} の週報へ予測と実測の差を追記`, state: "review", planned_start_time: "16:30", planned_duration_minutes: 45 },
      schedule: scheduleEntity(taskScheduleId, "task", taskId, date, date, "deadline"),
      note: { ...commonNote, title: `Ta置換LLZO 進捗メモ ${date}`, note_type: "report", body_markdown: "# 現在地\n\n候補バッチは合成中。性能向上はまだ断定せず、得られた証拠と未確定要因を分ける。\n\n## Evidence\n\n- 実験制約の確認状況\n- ロット別coverage\n- 焼成後密度\n\n## Next\n\nXRDとEISの結果を同じ試料IDで結合する。", properties_json: { report_type: "progress", period_start: addDays(date, -6), period_end: date } },
    },
    waiting: {
      task: { ...commonTask, title: `${date} 共同研究先のSEM画像を受領確認`, state: "waiting", planned_start_time: "15:00", planned_duration_minutes: 20 },
      schedule: scheduleEntity(taskScheduleId, "task", taskId, addDays(date, 3), addDays(date, 3), "deadline", "tentative"),
      note: { ...commonNote, title: `SEM画像 受領後チェック ${date}`, body_markdown: "# 受領後に確認\n\n- 試料IDと原料ロット\n- 倍率とスケールバー\n- 粒径分布の算出条件\n\n欠けている場合はモデルへ入れず、再送依頼する。" },
      waiting: { id: deterministicId(date, scenario, "waiting"), project_id: ids.theme.llzo, task_id: taskId, title: "共同研究先からロットL2407-BのSEM画像", waiting_for: "東都大学 材料解析室", next_action: `${addDays(date, 3)}までに未着ならメールで確認`, check_reminder_at: `${addDays(date, 3)}T10:00`, state: "waiting", source: "development-refresh" },
    },
  };
  const definition = definitions[scenario];
  const operations = [save("task", definition.task), save("schedule", definition.schedule), save("note", definition.note)];
  if (definition.capture) operations.push(save("capture_entry", definition.capture));
  if (definition.knowledge) operations.push(save("knowledge_node", definition.knowledge));
  if (definition.waiting) {
    operations.push(save("waiting", definition.waiting));
    operations.push(save("schedule", scheduleEntity(deterministicId(date, scenario, "waiting-schedule"), "waiting", definition.waiting.id, addDays(date, 3), addDays(date, 3), "deadline", "tentative")));
  }
  operations.push(
    save("reference", { id: deterministicId(date, scenario, "reference"), source_type: "note", source_id: noteId, target_type: "task", target_id: taskId, relation_type: "related_to", note: `${scenario}シナリオ`, source: "development-refresh" }),
    save("change_event", { id: eventId, entity_type: "task", entity_id: taskId, changed_at: timestamp(date, 9, 10), change_type: "created", reason: `開発データへ${scenario}シナリオを追加`, source: "manual" }),
  );
  return operations;
}

export function updateWorkspace({ targetPath, date, mode, scenario = "" }) {
  if (!fs.existsSync(targetPath)) throw new Error(`Workspace DBがありません: ${targetPath}`);
  const repository = new WorkspaceDatabase(targetPath);
  try {
    assertMaterialsDemo(repository);
    const backupPath = createBackup(repository, targetPath, date, mode, scenario);
    const beforeCounts = Object.fromEntries(["task", "schedule", "note", "capture_entry", "waiting", "knowledge_node", "status_update", "change_event"].map((type) => [type, repository.list(type).length]));
    const operations = mode === "refresh" ? buildRefreshOperations(repository, date) : buildScenarioOperations(date, scenario);
    repository.saveMany(operations);
    repository.validateSnapshotWorkspace(repository.loadWorkspace(true));
    const afterCounts = Object.fromEntries(Object.keys(beforeCounts).map((type) => [type, repository.list(type).length]));
    repository.db.pragma("wal_checkpoint(TRUNCATE)");
    return { targetPath, date, mode, scenario: scenario || null, backupPath, saved: operations.length, beforeCounts, afterCounts };
  } finally {
    repository.db.close();
  }
}

function parseArguments(argv) {
  const result = { targetPath: "", applyLocal: false, date: localDateString(), mode: "refresh", scenario: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply-local") result.applyLocal = true;
    else if (value === "--target") result.targetPath = path.resolve(argv[++index] || "");
    else if (value === "--date") result.date = assertDate(argv[++index] || "");
    else if (value === "--mode") result.mode = argv[++index] || "";
    else if (value === "--scenario") result.scenario = argv[++index] || "";
    else throw new Error(`未知の引数です: ${value}`);
  }
  if (result.applyLocal && result.targetPath) throw new Error("--apply-localと--targetは同時に指定できません。");
  result.targetPath ||= result.applyLocal ? localDatabasePath : "";
  if (!result.targetPath) throw new Error("--apply-local または --target <sqlite path> を指定してください。");
  if (!new Set(["refresh", "add"]).has(result.mode)) throw new Error("--modeはrefreshまたはaddです。");
  if (result.mode === "add" && !scenarios.has(result.scenario)) throw new Error(`--scenarioは${[...scenarios].join(" / ")}から選んでください。`);
  if (result.mode === "refresh" && result.scenario) throw new Error("refreshでは--scenarioを指定しません。");
  return result;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  console.log(JSON.stringify(updateWorkspace(options), null, 2));
}
