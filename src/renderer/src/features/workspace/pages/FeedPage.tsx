import { useCallback, useMemo, useRef, useState } from "react";

import type { PageProps } from "../types";
import { Button, PageHeader } from "../components/common";
import {
  FEED_ACTORS,
  FEED_PAGE_SIZE,
  buildFeedProjection,
  selectNeedsYou,
  selectRecent,
  type FeedItem,
} from "../lib/feedFixtures";
import { buildLiveFeed } from "../lib/feedProjection";
import { buildSaveTaskOperations } from "../domain-model/persistence";

type FeedTab = "now" | "needs" | "recent";

const TABS: ReadonlyArray<{ id: FeedTab; label: string }> = [
  { id: "now", label: "今見る" },
  { id: "needs", label: "対応待ち" },
  { id: "recent", label: "最近の更新" },
];

function formatReceived(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes >= 0 && minutes < 60) return `${Math.max(minutes, 1)}分前`;
  if (minutes >= 60 && minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDue(value: string | null): string | null {
  if (!value) return null;
  const [, month, day] = value.split("-");
  if (!month || !day) return null;
  return `${Number(month)}月${Number(day)}日`;
}

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Feed（#604後半）。
 *
 * 行は実データから作る。要対応は `buildAttentionQueue`（badge・Agent Deskと同じ導出）、
 * 今日の行はTaskの `today_date` から作るので、**Feedだけの状態管理は持たない**。
 * 回答は既存の `ReplyToAgentRequest`、扱う日は既存のTask保存を使う。
 * 画面内だけに留まるのは「後で見る」「今回は見送る」の再表示待ちと下書きで、
 * どちらも未解決の件数と正式な採否を変えない。
 */
export function FeedPage({
  data,
  domain,
  executeCommand,
  saveEntities,
  openDrawer,
  navigate,
  setToast,
}: PageProps) {
  const [tab, setTab] = useState<FeedTab>("now");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [limit, setLimit] = useState(FEED_PAGE_SIZE);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLHeadingElement>());

  const today = todayKey();

  const live = useMemo(
    () =>
      buildLiveFeed({
        tasks: domain.tasks as unknown[],
        proposals: domain.ai_proposals as unknown[],
        receipts: data.work_receipts as unknown[],
        themes: data.themes as unknown[],
        schedules: data.schedules as unknown[],
        today,
      }),
    [domain.tasks, domain.ai_proposals, data.work_receipts, data.themes, data.schedules, today],
  );

  // 「後で見る」「今回は見送る」は画面内の再表示待ちで、未解決の件数は変えない。
  const visibleItems = useMemo(
    () => live.items.filter((item) => !dismissed.has(item.id)),
    [live.items, dismissed],
  );

  const projection = useMemo(
    () => buildFeedProjection(visibleItems, { deferred }),
    [visibleItems, deferred],
  );

  const rows = useMemo(() => {
    if (tab === "needs") return selectNeedsYou(projection.items);
    if (tab === "recent") return selectRecent(visibleItems);
    return projection.items;
  }, [tab, projection.items, visibleItems]);

  const shown = rows.slice(0, limit);
  const unresolved = live.unresolved;
  const selected = shown.find((item) => item.id === selectedId) ?? null;
  const taskOf = useCallback(
    (item: FeedItem) => {
      if (!item.taskId) return null;
      return (
        (domain.tasks as unknown as Array<{ id: string }>).find(
          (task) => task.id === item.taskId,
        ) ?? null
      );
    },
    [domain.tasks],
  );

  const openItem = useCallback((item: FeedItem) => {
    setSelectedId(item.id);
    setDraftAnswer("");
    setNotice(null);
  }, []);

  const closeDetail = useCallback(() => {
    const origin = selectedId ? rowRefs.current.get(selectedId) : null;
    setSelectedId(null);
    // 下書きは破棄しない。閉じる操作は回答の送信でも採用でもない。
    setNotice("下書きを保持したまま一覧へ戻りました。");
    origin?.focus();
  }, [selectedId]);

  const deferItem = useCallback((item: FeedItem) => {
    setDeferred((current) => new Set(current).add(item.id));
    setSelectedId(null);
    setNotice("後で見るに回しました。未解決の件数は減りません。");
  }, []);

  const dismissItem = useCallback((item: FeedItem) => {
    setDismissed((current) => new Set(current).add(item.id));
    setSelectedId(null);
    setNotice("今回は見送りました。Task・Note・Proposalの正式な採否は変わっていません。");
  }, []);

  /** 回答は既存のCommand（#597）へ渡す。保存できたときだけ要対応から外れる。 */
  const submitAnswer = useCallback(
    async (item: FeedItem) => {
      const body = draftAnswer.trim();
      if (!body) {
        setToast("回答を入力してください。", "warning");
        return;
      }
      const task = taskOf(item) as { id: string; version?: number } | null;
      const requestId = item.requestId ?? null;
      if (!task || !requestId) {
        setToast("この質問のIDを確認できません。画面を再読み込みしてください。", "danger");
        return;
      }
      setBusy(true);
      try {
        await executeCommand({
          commandId: `${item.id}:reply:${Date.now()}`,
          name: "ReplyToAgentRequest",
          payload: { taskId: task.id, requestId, body },
          actor: { kind: "user" },
          source: "main_ui",
          expectedVersions: [{ type: "task", id: task.id, version: Number(task.version ?? 0) }],
          issuedAt: new Date().toISOString(),
        } as never);
        setNotice("回答を送りました。agentの再開を待ちます。");
        setDraftAnswer("");
        setToast("回答を送りました。agentの再開を待ちます。", "success");
      } catch (error) {
        setToast(
          `回答を送れませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [draftAnswer, executeCommand, setToast, taskOf],
  );

  const openTaskAction = useCallback(
    (item: FeedItem) => {
      const task = taskOf(item);
      if (task) {
        openDrawer({ type: "task", entity: task as never, commandSource: "main_ui" });
        return;
      }
      // Taskに紐づかない提案はAgent Deskで確認する。
      navigate("ai-io");
    },
    [navigate, openDrawer, taskOf],
  );

  const changeTodayDate = useCallback(
    async (item: FeedItem, target: string | null) => {
      const task = taskOf(item) as {
        id: string;
        today_date?: string | null;
        version?: number;
      } | null;
      if (!task) return;
      const previous = task.today_date ?? null;
      if (previous === target) return;
      const message = target === null ? "今日の選択を外しました。" : "今日扱います。";
      setBusy(true);
      try {
        await saveEntities(
          buildSaveTaskOperations({ ...task, today_date: target } as never),
          message,
          "main_ui",
        );
        setToast(`${message} 締切は変わりません。`, "success");
      } catch (error) {
        setToast(
          `扱う日を変更できませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        );
      } finally {
        setBusy(false);
      }
    },
    [saveEntities, setToast, taskOf],
  );

  /** 行の操作は型付きIDで分岐する。文言からCommandを推測しない。 */
  const runRowAction = useCallback(
    (item: FeedItem, actionId: FeedItem["actions"][number]["id"]) => {
      switch (actionId) {
        case "defer_attention":
          deferItem(item);
          return;
        case "dismiss":
          dismissItem(item);
          return;
        case "open_task":
        case "review_report":
        case "view_proposal":
        case "open_record":
          openTaskAction(item);
          return;
        case "change_today_date":
          void changeTodayDate(item, null);
          return;
        default:
          openItem(item);
      }
    },
    [changeTodayDate, deferItem, dismissItem, openItem, openTaskAction],
  );

  return (
    <div className="page feed-page">
      <PageHeader route="feed" />

      <div
        className="feed-layout"
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectedId) {
            event.stopPropagation();
            closeDetail();
          }
        }}
      >
        <section className="feed-main" aria-label="Feed">
          <div className="feed-notice" role="note">
            <strong>実データを表示しています。</strong>
            要対応はAgent
            Deskと同じ導出です。「後で見る」「今回は見送る」はこの画面の中だけに留まり、
            未解決の件数と正式な採否は変わりません。
          </div>

          <div className="feed-header">
            <div className="feed-tabs" role="tablist" aria-label="Feedの絞り込み">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={tab === entry.id ? "is-active" : undefined}
                  onClick={() => {
                    setTab(entry.id);
                    setSelectedId(null);
                  }}
                >
                  {entry.label}
                  {entry.id === "needs" && unresolved > 0 ? (
                    <span className="feed-tab-count">{unresolved}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {tab === "now" && deferred.size > 0 ? (
            <p className="feed-deferred-note">
              今 {unresolved}件／後で {projection.deferredCount}件
            </p>
          ) : null}

          {notice ? (
            <p className="feed-notice-line" role="status">
              {notice}
            </p>
          ) : null}

          {shown.length === 0 ? (
            <p className="feed-empty">
              条件に一致する更新はありません。絞り込みを解除してください。
            </p>
          ) : (
            <ul className="feed-list">
              {shown.map((item) => {
                const actor = item.actorLabel ?? FEED_ACTORS[item.actor].label;
                const due = formatDue(item.dueAt);
                const isOpen = item.id === selectedId;
                return (
                  <li key={item.id} className={isOpen ? "feed-row is-selected" : "feed-row"}>
                    <div className="feed-row-head">
                      <span className="feed-actor">{actor}</span>
                      <time className="feed-time" dateTime={item.receivedAt}>
                        {formatReceived(item.receivedAt)}
                      </time>
                    </div>
                    <div className="feed-row-title">
                      <h3
                        ref={(node) => {
                          if (node) rowRefs.current.set(item.id, node);
                          else rowRefs.current.delete(item.id);
                        }}
                      >
                        <button
                          type="button"
                          className="feed-row-open"
                          aria-expanded={isOpen}
                          onClick={() => openItem(item)}
                        >
                          {item.headline}
                        </button>
                      </h3>
                      <span className={`feed-state feed-state-${item.state}`}>
                        {item.stateLabel}
                      </span>
                      {item.generated ? (
                        <span className="feed-generated">
                          {item.generated === "ai_suggestion" ? "AI提案" : "AI要約"}
                        </span>
                      ) : null}
                    </div>
                    <p className="feed-row-summary">{item.summary}</p>
                    <p className="feed-row-meta">
                      {due ? <span className="feed-row-due">締切 {due}</span> : null}
                      <span className="feed-row-path">{item.pathLabel}</span>
                    </p>
                    <div className="feed-row-actions">
                      {/*
                        全行へ強い塗りのボタンを並べない。主要な操作は outlined、
                        補助は text に留め、burgundyの塗りは開いた回答・確認フォームだけに使う。
                      */}
                      {item.actions.slice(0, 2).map((action, index) => (
                        <Button
                          key={action.id}
                          variant={index === 0 ? "secondary" : "ghost"}
                          compact
                          onClick={() => runRowAction(item, action.id)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {rows.length > shown.length ? (
            <Button
              variant="secondary"
              className="feed-more"
              onClick={() => setLimit((value) => value + FEED_PAGE_SIZE)}
            >
              次の{FEED_PAGE_SIZE}件を表示
            </Button>
          ) : null}

          <p className="feed-end">
            今確認する更新は以上です。
            {projection.deferredCount > 0 ? ` 後で見る ${projection.deferredCount}件` : ""}
          </p>
        </section>

        <aside
          className={selected ? "feed-detail" : "feed-detail is-empty"}
          aria-label="選択中の項目"
        >
          {selected ? (
            <>
              <div className="feed-detail-head">
                <span className="feed-actor">
                  {selected.actorLabel ?? FEED_ACTORS[selected.actor].label}
                </span>
                <Button variant="ghost" onClick={closeDetail}>
                  閉じる
                </Button>
              </div>
              <h2 className="feed-detail-title">{selected.detail.title}</h2>
              <p className="feed-detail-reason">表示理由: {selected.reasonShown}</p>
              <dl className="feed-detail-rows">
                {selected.detail.rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="feed-detail-actions">
                {/*
                  詳細の操作も既存Commandへ繋ぐ。開いただけでは正式データを変えない。
                  「扱う日を変更」は締切ではなく `today_date` だけを変える（#454）。
                */}
                {selected.taskId ? (
                  <Button variant="secondary" compact onClick={() => openTaskAction(selected)}>
                    {selected.kind === "review_ready" ? "Taskを開いて採用を判断" : "Taskを開く"}
                  </Button>
                ) : null}
                {selected.kind === "today_task" && selected.taskId ? (
                  <>
                    <Button
                      variant="secondary"
                      compact
                      disabled={busy}
                      onClick={() => void changeTodayDate(selected, null)}
                    >
                      今日の選択を外す
                    </Button>
                    <Button
                      variant="secondary"
                      compact
                      disabled={busy}
                      onClick={() => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
                        const day = String(tomorrow.getDate()).padStart(2, "0");
                        void changeTodayDate(selected, `${tomorrow.getFullYear()}-${month}-${day}`);
                      }}
                    >
                      明日扱う
                    </Button>
                  </>
                ) : null}
                <Button variant="ghost" compact onClick={() => deferItem(selected)}>
                  後で見る
                </Button>
              </div>
              {selected.kind === "human_question" ? (
                <form
                  className="feed-reply"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAnswer(selected);
                  }}
                >
                  <label htmlFor="feed-reply-body">回答</label>
                  <textarea
                    id="feed-reply-body"
                    value={draftAnswer}
                    onChange={(event) => setDraftAnswer(event.target.value)}
                    rows={3}
                    placeholder="選択肢に加えて補足があれば書きます。"
                    disabled={busy}
                  />
                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? "送信中" : "回答を送る"}
                  </Button>
                </form>
              ) : null}
              {selected.sourceLabel ? (
                <p className="feed-detail-source">参照: {selected.sourceLabel}</p>
              ) : null}
            </>
          ) : (
            <p className="feed-detail-empty">行を選ぶと、ここに根拠と操作が開きます。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
