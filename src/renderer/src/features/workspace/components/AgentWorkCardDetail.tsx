import { useState, type ReactNode } from "react";
import { IconTrash } from "@tabler/icons-react";

import {
  agentWorkCardClientLabel,
  type AgentWorkCard,
} from "../../../../../shared/agentWorkCard.ts";
import { AI_ICON } from "../../../pages/semanticIcons";
import type { AgentWorkProjectionRow } from "../domain-model/agentSessionProjection";
import type { RemoveEntity } from "../types";

/**
 * AI の作業のカードの見た目の決まり（色は誰が、線は決まったか）。
 * AI が書いた物と、これまでの記録は藍の実線。ログから機械が拾い上げた物は薄い墨の点線。
 */
export function agentWorkCardLineClass(card: Pick<AgentWorkCard, "basis">): string {
  return card.basis === "log_pickup" ? "is-pickup" : "is-reported";
}

const STATUS_LABELS: Record<AgentWorkCard["status"], string> = {
  done: "済み",
  partial: "途中",
  blocked: "停止",
};

export function agentWorkCardStatusLabel(card: Pick<AgentWorkCard, "status" | "running">): string {
  return card.running ? "作業中" : STATUS_LABELS[card.status];
}

/** リポジトリかテーマ。両方あればリポジトリを先に（どこで動いたかが先に要る）。 */
export function agentWorkRowPlace(
  row: Pick<AgentWorkProjectionRow, "repositories" | "themes">,
): string {
  const repository = row.repositories.map((repo) => repo.label || repo.repository_slug).join(" / ");
  return repository || row.themes.map((theme) => theme.name).join(" / ");
}

/** AI の印（藍）と名前。色は 1 つで、AI の種類は名前で見分ける。 */
export function AgentWorkClientMark({ card }: { card: AgentWorkCard }) {
  return (
    <span className="agent-work-mark" title={card.model_label || undefined}>
      <AI_ICON size={14} aria-hidden="true" />
      {agentWorkCardClientLabel(card)}
    </span>
  );
}

function List({ label, items, more = 0 }: { label: string; items: string[]; more?: number }) {
  if (!items.length && !more) return null;
  return (
    <div className="agent-work-card-section">
      <span>{label}</span>
      <ul>
        {items.map((item, index) => (
          <li key={`${index}:${item}`}>{item}</li>
        ))}
        {more > 0 && <li className="agent-work-card-more">ほか {more} 件</li>}
      </ul>
    </div>
  );
}

/**
 * カードを開いた中身: 変えた物・確かめたこと・残り。新しい記録も古い会話も同じ並びで読む。
 * 消すと消した印が付き、すぐ後の「元に戻す」で戻せる（本人の操作）。
 */
export function AgentWorkCardDetail({
  row,
  removeEntity,
  children,
}: {
  row: AgentWorkProjectionRow;
  /** 渡さない時は消すボタンを出さない（まだ保存されていない、採る前の記録など）。 */
  removeEntity?: RemoveEntity;
  children?: ReactNode;
}) {
  const { card } = row;
  const [removing, setRemoving] = useState(false);
  const headlineIsWholeSummary = card.summary === row.headline;
  const empty =
    !card.changed.length && !card.changed_more && !card.verified.length && !card.remaining.length;
  return (
    <div className="agent-work-card-detail">
      {card.notice && (
        <p className="agent-work-card-notice">
          <span>気づき</span>
          {card.notice}
        </p>
      )}
      {card.summary && !headlineIsWholeSummary && (
        <p className="agent-work-card-summary">{card.summary}</p>
      )}
      {card.intent && (
        <p className="agent-work-card-intent">
          <span>依頼</span>
          {card.intent}
        </p>
      )}
      <div className="agent-work-card-sections">
        <List label="変えた物" items={card.changed} more={card.changed_more} />
        <List label="確かめたこと" items={card.verified} />
        <div className={card.remaining.length ? "is-remaining" : undefined}>
          <List label="残り" items={card.remaining} />
        </div>
      </div>
      {empty && (
        <p className="agent-work-card-empty">
          {card.basis === "log_pickup"
            ? "ログから拾った記録です。変えた物・確かめたこと・残りは書かれていません。"
            : "変えた物・確かめたこと・残りは書かれていません。"}
        </p>
      )}
      {children}
      <div className="agent-work-card-foot">
        <small>
          {[
            row.themes.map((theme) => theme.name).join(" / "),
            row.repositories.map((repo) => repo.label || repo.repository_slug).join(" / "),
            card.model_label,
            card.basis === "log_pickup" ? "ログから拾った記録" : "",
            row.missingLinkCount > 0 ? `今は無い関連 ${row.missingLinkCount} 件` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {removeEntity && (
          <button
            type="button"
            className="agent-work-card-remove"
            disabled={removing}
            onClick={() => {
              setRemoving(true);
              void removeEntity(card.origin === "record" ? "agent_work_record" : "agent_session", {
                id: card.id,
                title: `AI の作業「${row.headline}」`,
              }).finally(() => setRemoving(false));
            }}
          >
            <IconTrash size={14} aria-hidden="true" />
            消す
          </button>
        )}
      </div>
    </div>
  );
}
