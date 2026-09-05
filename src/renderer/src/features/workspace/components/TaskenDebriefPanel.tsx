import { useMemo, useState } from "react";
import { IconCopy, IconNotes } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import type { PageProps } from "../types";
import {
  buildDailyDebriefEvidence,
  buildDailyReportRequest,
  dailyReportDate,
  type DebriefSessionEvidence,
} from "../lib/taskenDebrief";
import { Button } from "./common";

interface TaskenDebriefPanelProps {
  date: string;
  domain: PageProps["domain"];
  notes: PageProps["notes"];
  openReport(noteId: string): void;
  setToast: PageProps["setToast"];
}

const CLIENT_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github_copilot: "GitHub Copilot",
  other: "AI client",
};

export function TaskenDebriefPanel({
  date,
  domain,
  notes,
  openReport,
  setToast,
}: TaskenDebriefPanelProps) {
  const evidence = useMemo(() => buildDailyDebriefEvidence(domain, date), [domain, date]);
  const [preview, setPreview] = useState<{ id: string; above: boolean; maxHeight: number } | null>(
    null,
  );
  const [copying, setCopying] = useState(false);
  const usefulEvidence = evidence
    .filter(
      (entry) =>
        entry.hasContent ||
        entry.status === "active" ||
        entry.status === "blocked" ||
        entry.remainingWork.length > 0,
    )
    .sort(
      (left, right) =>
        Number(right.status === "blocked" || right.remainingWork.length > 0) -
        Number(left.status === "blocked" || left.remainingWork.length > 0),
    );
  const recordsOnly = evidence.filter((entry) => !usefulEvidence.includes(entry));
  const reports = notes.filter((note) => dailyReportDate(note) === date);

  async function copyRequest() {
    setCopying(true);
    try {
      await workspaceApi.copyText(buildDailyReportRequest(date));
      setToast(
        "日報の依頼文をコピーしました。Tasken MCPに接続したAIへ貼り付けてください。",
        "success",
      );
    } catch (error) {
      setToast(
        `依頼文をコピーできませんでした。もう一度お試しください。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setCopying(false);
    }
  }

  function showPreview(id: string, card: HTMLElement) {
    const rect = card.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 56;
    const placeAbove = below < 300 && above > below;
    setPreview({
      id,
      above: placeAbove,
      maxHeight: Math.max(120, Math.min(300, placeAbove ? above : below)),
    });
  }

  function renderCard(entry: DebriefSessionEvidence) {
    const expanded = preview?.id === entry.id;
    const needsAttention = entry.status === "blocked" || entry.remainingWork.length > 0;
    return (
      <article
        key={entry.id}
        className={`daily-work-card${needsAttention ? " needs-attention" : ""}${expanded ? " is-previewing" : ""}`}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") showPreview(entry.id, event.currentTarget);
        }}
        onPointerLeave={(event) => {
          if (
            event.pointerType === "mouse" &&
            !event.currentTarget.contains(document.activeElement)
          ) {
            setPreview(null);
          }
        }}
        onFocusCapture={(event) => showPreview(entry.id, event.currentTarget)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget
              .querySelector<HTMLButtonElement>(".daily-work-card-summary")
              ?.focus();
            setPreview(null);
            event.stopPropagation();
          }
        }}
      >
        <button
          type="button"
          className="daily-work-card-summary"
          aria-expanded={expanded}
          onClick={(event) => showPreview(entry.id, event.currentTarget.parentElement!)}
        >
          <span className="daily-work-card-meta">
            <span>{CLIENT_LABELS[entry.clientKind] || entry.clientKind}</span>
            <time dateTime={entry.startedAt}>
              {new Date(entry.startedAt).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </span>
          <strong>{entry.intent || "依頼内容の記録なし"}</strong>
          <span className="daily-work-card-result">{entry.outcome}</span>
          <span className={needsAttention ? "daily-work-card-attention" : "daily-work-card-meta"}>
            {needsAttention
              ? `要確認: ${entry.remainingWork.join(" / ") || "作業が停止中"}`
              : entry.status === "active"
                ? "作業中"
                : entry.taskId && entry.reviewStatus === "pending"
                  ? "AI作業終了・採用待ち"
                  : entry.taskId && entry.reviewStatus === "accepted"
                    ? "採用済み"
                    : entry.proposal
                      ? "未確定の受信記録"
                      : "記録済み"}
          </span>
        </button>
        {expanded && (
          <div
            className={`daily-work-card-preview${preview.above ? " is-above" : ""}`}
            style={{ maxHeight: preview.maxHeight }}
            tabIndex={0}
            aria-label="AI作業の内容"
          >
            <dl>
              {entry.taskId && (
                <>
                  <dt>AI作業期間</dt>
                  <dd>
                    {new Date(entry.startedAt).toLocaleString("ja-JP")} ～{" "}
                    {entry.endedAt ? new Date(entry.endedAt).toLocaleString("ja-JP") : "作業中"}
                  </dd>
                </>
              )}
              <dt>Intent</dt>
              <dd>{entry.intent || "依頼内容の記録なし"}</dd>
              <dt>Outcome</dt>
              <dd>{entry.outcome}</dd>
              <dt>残り</dt>
              <dd>{entry.remainingWork.join(" / ") || "なし"}</dd>
              {entry.verification.length > 0 && (
                <>
                  <dt>記録された確認</dt>
                  <dd>{entry.verification.join(" / ")}</dd>
                </>
              )}
            </dl>
            <small>
              {entry.proposal ? "未確定の受信記録 · " : ""}
              {entry.taskId ? `Task: ${entry.taskId}` : `Session: ${entry.sourceSessionId}`}
            </small>
          </div>
        )}
      </article>
    );
  }

  return (
    <>
      <section className="panel daily-work-panel" aria-label="この日のAI作業">
        <div className="section-heading">
          <h2>AI作業</h2>
        </div>
        {usefulEvidence.length ? (
          <div className="daily-work-grid">{usefulEvidence.map(renderCard)}</div>
        ) : (
          <p className="tasken-debrief-empty">この日の内容のあるAI作業はまだありません。</p>
        )}
        {recordsOnly.length > 0 && (
          <details className="daily-work-records">
            <summary>記録のみ {recordsOnly.length}件</summary>
            <div className="daily-work-grid">{recordsOnly.map(renderCard)}</div>
          </details>
        )}
      </section>
      <section className="panel daily-report-panel" aria-label="日報">
        <div className="section-heading">
          <h2>日報</h2>
          <Button variant="primary" disabled={copying} onClick={() => void copyRequest()}>
            <IconCopy size={16} />
            日報の依頼文をコピー
          </Button>
        </div>
        <p>
          MCPのTasken日報（daily-report）は当日分をまとめます。選択日分は依頼文をコピーして開始できます。
          草稿の採用後、Notesで振り返りの回答を追記します。
        </p>
        {reports.map((note) => (
          <Button key={note.id} onClick={() => openReport(note.id)}>
            <IconNotes size={16} />
            {note.title || `${date}の日報`}をNotesで開く
          </Button>
        ))}
      </section>
    </>
  );
}
