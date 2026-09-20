import { useCallback, useMemo, useRef, useState } from "react";

import type { PageProps } from "../types";
import { Button, PageHeader } from "../components/common";
import {
  FEED_ACTORS,
  FEED_FIXTURE_ITEMS,
  FEED_PAGE_SIZE,
  buildFeedProjection,
  countUnresolved,
  selectNeedsYou,
  selectRecent,
  type FeedItem,
} from "../lib/feedFixtures";

type FeedTab = "now" | "needs" | "recent";

const TABS: ReadonlyArray<{ id: FeedTab; label: string }> = [
  { id: "now", label: "今見る" },
  { id: "needs", label: "対応待ち" },
  { id: "recent", label: "最近の更新" },
];

/** 閲覧中に届いたことにして、反映するまで一覧を動かさない挙動を確認する。 */
const HELD_BACK_IDS = ["fx-v1", "fx-v2"];

function formatReceived(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date("2026-09-20T10:00:00+09:00");
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
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

/**
 * Feed（#604前半）。**この画面は設計検証用の試作で、架空のfixtureだけを表示します。**
 * 保存を伴う接続は #604後半で行うため、ここでの回答・見送り・後で見るは画面内だけに留まります。
 * 正本は docs/feed-surface.md。
 */
export function FeedPage(_props: PageProps) {
  const [tab, setTab] = useState<FeedTab>("now");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [limit, setLimit] = useState(FEED_PAGE_SIZE);
  const [appliedArrivals, setAppliedArrivals] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLHeadingElement>());

  const visibleItems = useMemo(
    () =>
      FEED_FIXTURE_ITEMS.filter(
        (item) => !dismissed.has(item.id) && (appliedArrivals || !HELD_BACK_IDS.includes(item.id)),
      ),
    [dismissed, appliedArrivals],
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
  const unresolved = countUnresolved(visibleItems);
  const selected = shown.find((item) => item.id === selectedId) ?? null;

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

  const submitAnswer = useCallback((item: FeedItem) => {
    setAnswered((current) => new Set(current).add(item.id));
    setNotice("回答を送る操作は #597 で実装します。この試作では保存していません。");
  }, []);

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
            <strong>設計検証用の試作です。</strong>
            表示しているのは架空のデータで、回答・見送り・後で見るはこの画面の中だけに留まります。
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
            {!appliedArrivals ? (
              <button
                type="button"
                className="feed-new-arrivals"
                onClick={() => setAppliedArrivals(true)}
              >
                新しい更新 {HELD_BACK_IDS.length}件
              </button>
            ) : null}
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
                const actor = FEED_ACTORS[item.actor];
                const due = formatDue(item.dueAt);
                const isOpen = item.id === selectedId;
                return (
                  <li key={item.id} className={isOpen ? "feed-row is-selected" : "feed-row"}>
                    <div className="feed-row-head">
                      <span className="feed-actor">{actor.label}</span>
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
                        {answered.has(item.id) ? "回答済み／再開待ち" : item.stateLabel}
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
                          onClick={() => {
                            if (action.id === "defer_attention") deferItem(item);
                            else if (action.id === "dismiss") dismissItem(item);
                            else openItem(item);
                          }}
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
                <span className="feed-actor">{FEED_ACTORS[selected.actor].label}</span>
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
              {selected.kind === "human_question" ? (
                <form
                  className="feed-reply"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitAnswer(selected);
                  }}
                >
                  <label htmlFor="feed-reply-body">回答</label>
                  <textarea
                    id="feed-reply-body"
                    value={draftAnswer}
                    onChange={(event) => setDraftAnswer(event.target.value)}
                    rows={3}
                    placeholder="選択肢に加えて補足があれば書きます。"
                  />
                  <Button type="submit" variant="primary">
                    回答を送る
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
