import { useEffect, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { todayIso } from "../../../utils/dataFormat.js";
import { THEME_NONE_VALUE } from "../../../../../shared/themeRef.mjs";
import { buildActivityLog, collectActivityLogEntries } from "../lib/activityLog";
import { resolveActivityLogDirectory } from "../lib/activityLogDirectory";
import { findReminderSettingsView, normalizeReminderSettings } from "../lib/reminders";
import type { PageProps } from "../types";
import { Button, EmptyState, ThemePickerSelect } from "./common";

type StructuredActivityEvent = {
  id?: string;
  occurred_at?: string;
  local_time?: string;
  event_kind?: string;
  summary?: string;
  entity_ref?: { type?: string; id?: string };
  theme_ref?: { kind?: "theme" | "none"; id?: string | null };
};

const EVENT_LABELS: Record<string, string> = {
  task_checklist_checked: "チェック済み",
  task_checklist_unchecked: "チェックを戻す",
  task_completed: "完了",
  task_reopened: "再開",
  task_work_recorded: "作業を記録",
  task_ai_reported: "作業報告",
  task_ai_accepted: "作業を受領",
  task_ai_returned: "作業を差し戻し",
  waiting_received: "待ちを受領",
  waiting_updated: "待ちを更新",
  plan_node_created: "計画を追加",
  plan_node_updated: "計画を更新",
  note_created: "Noteを作成",
  note_updated: "Noteを更新",
  report_created: "レポートを作成",
  report_updated: "レポートを更新",
  prompt_created: "依頼文を作成",
  prompt_updated: "依頼文を更新",
  resource_added: "資料を追加",
  resource_updated: "資料を更新",
  artifact_added: "成果物を追加",
  artifact_updated: "成果物を更新",
  knowledge_created: "Knowledgeを追加",
  knowledge_updated: "Knowledgeを更新",
  sketch_created: "Sketchを作成",
  sketch_updated: "Sketchを更新",
  reference_created: "関連付けを追加",
  reference_updated: "関連付けを更新",
  capture_formalized: "メモを整理",
  entity_deleted: "削除",
  status_updated: "現在地を更新",
};

function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] || "活動";
}

function eventTitle(event: StructuredActivityEvent, ref: { id?: string }, entity: unknown): string {
  const record = entity && typeof entity === "object" ? (entity as Record<string, unknown>) : {};
  const current = String(record.title || record.name || "").trim();
  if (current) return current;
  const summary = String(event.summary || "")
    .trim()
    .replace(/^[a-z_]+:\s*/i, "");
  return summary && (!ref.id || !summary.includes(ref.id)) ? summary : "履歴の項目";
}

export function ActivityLogPanel({
  data,
  domain,
  themes,
  openDrawer,
  setToast,
}: Pick<PageProps, "data" | "domain" | "themes" | "openDrawer" | "setToast">) {
  const [date, setDate] = useState(todayIso());
  const [directory, setDirectory] = useState("");
  const [autoExportTime, setAutoExportTime] = useState("");
  const [filePath, setFilePath] = useState("");
  const [themeFilter, setThemeFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [rootStatus, setRootStatus] = useState(data.canonical_root_status || {});
  const [expanded, setExpanded] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let canceled = false;
    void workspaceApi
      .getActivityCanonicalRootStatus()
      .then((status) => {
        if (!canceled) setRootStatus(status);
      })
      .catch((error) => {
        if (!canceled)
          setToast(
            `Activityの保存先状態を読み込めませんでした。${error instanceof Error ? error.message : String(error)}`,
            "danger",
          );
      });
    return () => {
      canceled = true;
    };
  }, [setToast]);

  useEffect(() => setRootStatus(data.canonical_root_status || {}), [data.canonical_root_status]);

  useEffect(() => {
    void Promise.all([
      workspaceApi.getPreference("activityLogDirectory"),
      workspaceApi.getPreference("artifactDirectory"),
      workspaceApi.getPreference("activityLogAutoExportTime"),
    ])
      .then(([savedDirectory, artifactDirectory, savedTime]) => {
        setDirectory(resolveActivityLogDirectory(savedDirectory, artifactDirectory));
        if (typeof savedTime === "string" && savedTime) return setAutoExportTime(savedTime);
        const legacyTime = normalizeReminderSettings(
          findReminderSettingsView(data.views || []),
        ).activity_log_time;
        if (legacyTime) {
          setAutoExportTime(legacyTime);
          void workspaceApi
            .setPreference("activityLogAutoExportTime", legacyTime)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [data.views]);

  const input = {
    date,
    domain,
    statusUpdates: data.status_updates || [],
    themes,
    changeEvents: domain.change_events as unknown as Array<Record<string, unknown>>,
    references: domain.references as unknown as Array<Record<string, unknown>>,
    artifacts: data.artifacts as unknown as Array<Record<string, unknown>>,
    roots: rootStatus,
    timezone: "Asia/Tokyo",
  };
  const entries = collectActivityLogEntries(input);
  const groups = [
    { label: "完了", rows: entries.completedTasks.map((entry) => entry.title) },
    { label: "受領", rows: entries.receivedWaitings.map((entry) => entry.title) },
    { label: "Notes", rows: entries.notes.map((entry) => entry.title) },
    { label: "資料", rows: entries.resources.map((entry) => entry.title) },
    { label: "Knowledge", rows: entries.knowledge.map((entry) => entry.title) },
    {
      label: "現在地",
      rows: entries.updates.map(
        (entry) => entry.summary || entry.next_actions || entry.risks || "更新",
      ),
    },
    { label: "Capture", rows: entries.captures.map((entry) => entry.title || entry.text) },
  ].filter((group) => group.rows.length > 0);
  const events = (entries.events as StructuredActivityEvent[]).filter(
    (event) => event.event_kind !== "schedule_updated",
  );
  const kinds = [...new Set(events.map((event) => String(event.event_kind || "")))]
    .filter(Boolean)
    .sort();
  const visibleEvents = events.filter(
    (event) =>
      (themeFilter === "all" ||
        (themeFilter === THEME_NONE_VALUE
          ? event.theme_ref?.kind === "none"
          : event.theme_ref?.id === themeFilter)) &&
      (!typeFilter || event.event_kind === typeFilter),
  );
  const count = events.length
    ? visibleEvents.length
    : groups.reduce((sum, group) => sum + group.rows.length, 0);

  async function chooseDirectory() {
    try {
      const result = await workspaceApi.chooseDirectory("Activity Logの出力先を変更");
      if (result.canceled || !result.path) return;
      setDirectory(result.path);
      await workspaceApi.setPreference("activityLogDirectory", result.path);
      setToast("Activity Logの出力先を変更しました。", "success");
    } catch (error) {
      setToast(
        `出力先を設定できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function updateAutoExportTime(value: string) {
    setAutoExportTime(value);
    try {
      await workspaceApi.setPreference("activityLogAutoExportTime", value);
      setToast(
        value
          ? `Activity Logを毎日${value}に自動出力します。`
          : "Activity Logの自動出力を停止しました。",
        "success",
      );
    } catch (error) {
      setToast(
        `自動出力時刻を保存できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function exportLog(choose: boolean) {
    setExporting(true);
    try {
      const result = await workspaceApi.exportMarkdownFile({
        title: `Tasken Activity Log ${date}`,
        fileName: `tasken-activity-${date}.md`,
        content: buildActivityLog(input),
        directory: directory || null,
        chooseDirectory: choose,
      });
      if (result.canceled) return setToast("Activity Log出力をキャンセルしました。");
      if (result.directory) {
        setDirectory(result.directory);
        if (choose)
          void workspaceApi
            .setPreference("activityLogDirectory", result.directory)
            .catch(() => undefined);
      }
      if (result.filePath) setFilePath(result.filePath);
      setToast(`Activity Logを出力しました。${result.filePath || ""}`, "success");
    } catch (error) {
      setToast(
        `Activity Logを出力できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <section id="daily-activity" className="panel activity-log-strip debrief-activity-panel">
      <div className="section-heading">
        <div>
          <h2>
            Activity <span className="activity-count">{count}</span>
          </h2>
          <p>Debriefの前に、Taskenが観測した動きを確認します。</p>
        </div>
        <div className="inline-actions">
          {expanded && (
            <>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="Activity対象日"
              />
              {events.length > 0 && (
                <>
                  <ThemePickerSelect
                    themes={themes}
                    value={themeFilter}
                    onChange={setThemeFilter}
                    allowAll
                    allowNone
                    allLabel="すべてのTheme"
                    ariaLabel="Activity Theme filter"
                  />
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    aria-label="Activity event type filter"
                  >
                    <option value="">すべての種類</option>
                    {kinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {eventLabel(kind)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <Button
                variant="secondary"
                compact
                onClick={() =>
                  void workspaceApi
                    .copyText(buildActivityLog(input))
                    .then(() => setToast("Activity Logをコピーしました。", "success"))
                }
              >
                コピー
              </Button>
              <Button
                variant="secondary"
                compact
                onClick={() => void exportLog(!directory)}
                disabled={exporting}
              >
                出力
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            compact
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "閉じる" : "開く"}
          </Button>
        </div>
      </div>
      {expanded &&
        (events.length ? (
          visibleEvents.length ? (
            <ul className="activity-event-list" aria-label="Activity events">
              {visibleEvents.slice(0, 30).map((event) => {
                const ref = event.entity_ref || {};
                const records =
                  ref.type === "task"
                    ? domain.tasks
                    : ref.type === "waiting"
                      ? domain.waitings
                      : ref.type === "note"
                        ? domain.notes
                        : ref.type === "resource"
                          ? domain.resources
                          : ref.type === "plan_node"
                            ? domain.plan_nodes
                            : ref.type === "capture_entry"
                              ? domain.capture_entries
                              : ref.type === "sketch"
                                ? domain.sketches
                                : [];
                const entity = records.find((record) => record.id === ref.id);
                const openable = Boolean(entity);
                return (
                  <li key={String(event.id)} className="activity-event-row">
                    <time dateTime={String(event.occurred_at)}>
                      {String(event.local_time || "--:--")}
                    </time>
                    <span className="activity-event-main">
                      <span className="activity-event-kind">
                        {eventLabel(String(event.event_kind || ""))}
                      </span>
                      {openable ? (
                        <button
                          type="button"
                          className="text-button activity-event-title"
                          onClick={() =>
                            openDrawer({
                              type: ref.type as
                                | "task"
                                | "waiting"
                                | "note"
                                | "resource"
                                | "plan_node"
                                | "capture_entry"
                                | "sketch",
                              mode: "view",
                              entity: entity as unknown as Record<string, unknown>,
                            })
                          }
                        >
                          {eventTitle(event, ref, entity)}
                        </button>
                      ) : (
                        <span
                          className="activity-event-title"
                          title="現在のEntityがないため、履歴のみ表示しています。"
                        >
                          {eventTitle(event, ref, entity)}
                        </span>
                      )}
                      {!openable && <span className="activity-event-state">履歴のみ</span>}
                    </span>
                  </li>
                );
              })}
              {visibleEvents.length > 30 && (
                <li className="activity-more">ほか{visibleEvents.length - 30}件</li>
              )}
            </ul>
          ) : (
            <EmptyState title="条件に一致するActivityはありません" />
          )
        ) : groups.length ? (
          <div className="activity-summary-grid">
            {groups.map((group) => (
              <section className="activity-summary-group" key={group.label}>
                <div className="shelf-lane-heading">
                  <h3>{group.label}</h3>
                  <span>{group.rows.length}件</span>
                </div>
                <ul>
                  {group.rows.slice(0, 3).map((row, index) => (
                    <li key={`${group.label}-${index}`}>{row}</li>
                  ))}
                  {group.rows.length > 3 && (
                    <li className="activity-more">ほか{group.rows.length - 3}件</li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState title="タスクの完了やNoteの更新が自動でここにまとまります" />
        ))}
      {expanded && (
        <div className="activity-auto-export">
          <label>
            <span>毎日自動出力</span>
            <input
              type="time"
              value={autoExportTime}
              onChange={(event) => void updateAutoExportTime(event.target.value)}
              disabled={!directory}
              aria-label="Activity Log自動出力時刻"
            />
          </label>
          <span className="activity-output-path">
            {filePath
              ? `最新の手動出力: ${filePath}`
              : directory
                ? `出力先: ${directory}`
                : "Rootを設定すると自動で出力先を作ります。"}
          </span>
          <Button
            variant="secondary"
            compact
            disabled={exporting}
            onClick={() => void chooseDirectory()}
          >
            出力先を変更
          </Button>
          <small>アプリ停止中の未出力分は、次回起動時に日ごとに補完します。</small>
        </div>
      )}
    </section>
  );
}
