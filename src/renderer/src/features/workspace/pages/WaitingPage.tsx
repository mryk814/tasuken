import { useState } from "react";
import { IconCheck, IconPlus, IconX } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { playCompleteSound } from "../../../utils/sounds";
import type { PageProps } from "../types";
import { formatDate } from "../lib/format";
import { themeColor } from "../lib/domain";
import { EmptyState, PageHeader, StatusBadge } from "../components/common";
import { WAITING_STATE_LABELS } from "../domain-model/labels";
import { buildSaveWaitingOperations, buildSaveScheduleOperations } from "../domain-model/persistence";
import type { Schedule, Waiting } from "../domain-model/types";

function scheduledDate(schedule?: Schedule): string {
  return String(schedule?.end_date || schedule?.start_date || "");
}

export function WaitingPage({ data, domain: v2, themes, items, openDrawer, saveEntities, setToast }: PageProps) {
  const [filter, setFilter] = useState<Waiting["state"]>("waiting");
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addWaitingFor, setAddWaitingFor] = useState("");
  const [addTheme, setAddTheme] = useState("");
  const [addDate, setAddDate] = useState("");
  const schedulesByOwner = new Map(v2.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const allRows = v2.waitings
    .map((w) => ({ waiting: w, schedule: schedulesByOwner.get(`waiting:${w.id}`) }))
    .sort((a, b) => scheduledDate(a.schedule).localeCompare(scheduledDate(b.schedule)) || a.waiting.title.localeCompare(b.waiting.title, "ja"));
  const counters = {
    waiting: allRows.filter((r) => r.waiting.state === "waiting").length,
    received: allRows.filter((r) => r.waiting.state === "received").length,
    cancelled: allRows.filter((r) => r.waiting.state === "cancelled").length,
  };
  const visible = allRows.filter((r) => r.waiting.state === filter);

  async function addWaiting() {
    const title = addTitle.trim();
    const waitingFor = addWaitingFor.trim();
    if (!title) { setToast("タイトルを入力してください。"); return; }
    if (!waitingFor) { setToast("誰に・何を待っているか入力してください。"); return; }
    const waitingId = crypto.randomUUID();
    const waiting: Waiting = {
      id: waitingId,
      project_id: addTheme || null,
      title,
      waiting_for: waitingFor,
      state: "waiting",
      created_at: new Date().toISOString(),
    };
    const ops = buildSaveWaitingOperations(waiting);
    if (addDate) {
      const schedule: Schedule = {
        id: crypto.randomUUID(),
        owner_type: "waiting",
        owner_id: waitingId,
        end_date: addDate,
        date_kind: "deadline",
        confidence: "tentative",
        granularity: "day",
      };
      ops.push(...buildSaveScheduleOperations(schedule));
    }
    await saveEntities(ops, "待ちを追加しました。");
    setAddTitle("");
    setAddWaitingFor("");
    setAddDate("");
  }

  async function changeState(waiting: Waiting, nextState: Waiting["state"]) {
    const next: Waiting = { ...waiting, state: nextState };
    if (nextState === "received") playCompleteSound();
    await saveEntities(
      buildSaveWaitingOperations(next),
      nextState === "received" ? "受領しました。" : nextState === "cancelled" ? "中止しました。" : "待ちに戻しました。",
    );
  }

  function openDetail(waiting: Waiting, schedule?: Schedule) {
    openDrawer({ type: "waiting", entity: { ...waiting, _schedule: schedule } as Record<string, unknown> });
  }

  function copy() {
    const header = "タスク\t相手\t状態\tTheme\t期限";
    const rows = visible.map(({ waiting, schedule }) =>
      `${waiting.title}\t${waiting.waiting_for}\t${WAITING_STATE_LABELS[waiting.state]}\t${themes.find((t) => t.id === waiting.project_id)?.name || "—"}\t${scheduledDate(schedule) || "—"}`);
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("Waiting一覧をコピーしました。"));
  }

  return (
    <div className="page">
      <PageHeader title="Waiting" subtitle="誰を、何を、いつまで待っているかを確認します。">
        <button className="secondary-button" onClick={copy}>一覧をコピー</button>
        <button className="primary-button" onClick={() => setShowAdd((c) => !c)}><IconPlus size={16} /> 待ちを追加</button>
      </PageHeader>
      {showAdd && (
        <section className="panel">
          <div className="section-heading"><h2>待ちを追加</h2></div>
          <div className="inline-actions" style={{ gap: "var(--space-sm)" }}>
            <input
              style={{ flex: 1 }}
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWaiting()}
              placeholder="何を待っているか"
              autoFocus
            />
            <input
              value={addWaitingFor}
              onChange={(e) => setAddWaitingFor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWaiting()}
              placeholder="相手（必須）"
            />
            <select value={addTheme} onChange={(e) => setAddTheme(e.target.value)}>
              <option value="">個人業務</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
            <button className="primary-button compact" onClick={addWaiting}>追加</button>
          </div>
        </section>
      )}
      <div className="todo-filter-tabs">
        {([["waiting", "待ち中", counters.waiting], ["received", "受領", counters.received], ["cancelled", "中止", counters.cancelled]] as const).map(([id, label, count]) => (
          <button key={id} className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}<span className="tab-count">{count}</span></button>
        ))}
      </div>
      <section className="panel list-page">
        <div className="data-table waiting-table">
          <div className="table-head"><span /><span /><span>タスク</span><span>相手</span><span>状態</span><span>Theme</span><span>期限</span></div>
          {visible.map(({ waiting, schedule }) => {
            const theme = themes.find((t) => t.id === waiting.project_id);
            const themeIndex = Math.max(0, themes.findIndex((t) => t.id === waiting.project_id));
            const chipColor = `var(--color-${themeColor(theme, themeIndex)})`;
            const received = waiting.state === "received";
            const cancelled = waiting.state === "cancelled";
            return (
              <div
                className={`table-row ${cancelled ? "is-cancelled" : ""}`}
                key={waiting.id}
                style={{ "--chip-color": chipColor } as React.CSSProperties}
              >
                <span className="todo-theme-bar" />
                <button
                  className={`todo-check-circle ${received ? "is-done" : ""}`}
                  onClick={() => changeState(waiting, received ? "waiting" : "received")}
                  disabled={cancelled}
                  aria-label={received ? `${waiting.title}を待ちに戻す` : `${waiting.title}を受領`}
                  title={received ? "待ちに戻す" : "受領する"}
                >
                  {received && <IconCheck size={13} stroke={2.4} />}
                </button>
                <button className="row-title" onClick={() => openDetail(waiting, schedule)}>{waiting.title}</button>
                <span>{waiting.waiting_for}</span>
                <span className="waiting-state-actions">
                  {waiting.state === "waiting" ? (
                    <button className="danger-button compact waiting-cancel-button" onClick={() => changeState(waiting, "cancelled")}>
                      <IconX size={14} /> 中止
                    </button>
                  ) : (
                    <span className="inline-actions" style={{ gap: "var(--space-xs)" }}>
                      <StatusBadge value={waiting.state} label={WAITING_STATE_LABELS[waiting.state]} />
                      <button className="text-button compact" onClick={() => changeState(waiting, "waiting")}>戻す</button>
                    </span>
                  )}
                </span>
                <span className="theme-inline"><span className="chip-dot" />{theme?.name || "個人業務"}</span>
                <span className="num">{formatDate(scheduledDate(schedule))}</span>
              </div>
            );
          })}
        </div>
        {!visible.length && <EmptyState title={`${WAITING_STATE_LABELS[filter]}の待ちはありません`} action="待ちを追加" onAction={() => setShowAdd(true)} />}
      </section>
    </div>
  );
}
