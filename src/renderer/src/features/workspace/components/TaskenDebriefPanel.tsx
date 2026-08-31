import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBrain,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconExternalLink,
} from "@tabler/icons-react";

import type { PageProps } from "../types";
import { buildSaveNoteOperations } from "../domain-model/persistence";
import {
  buildAgentSessionAcceptanceCommand,
  buildDailyDebriefEvidence,
  buildTaskenDebriefMarkdown,
  findDailyDebriefNote,
  readTaskenDebrief,
  selectAdaptiveQuestion,
  TASKEN_DEBRIEF_SCHEMA_VERSION,
  type TaskenDebriefRecord,
} from "../lib/taskenDebrief";
import { Button } from "./common";

interface TaskenDebriefPanelProps {
  date: string;
  domain: PageProps["domain"];
  notes: PageProps["notes"];
  saveEntities: PageProps["saveEntities"];
  executeCommand: PageProps["executeCommand"];
  openContentViewer: PageProps["openContentViewer"];
  setToast: PageProps["setToast"];
}

const CLIENT_LABELS: Record<string, string> = {
  codex: "Codex",
  claude_code: "Claude Code",
  cursor: "Cursor",
  github_copilot: "GitHub Copilot",
  other: "AI client",
};

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function TaskenDebriefPanel({
  date,
  domain,
  notes,
  saveEntities,
  executeCommand,
  openContentViewer,
  setToast,
}: TaskenDebriefPanelProps) {
  const evidence = useMemo(() => buildDailyDebriefEvidence(domain, date), [domain, date]);
  const existingNote = useMemo(() => findDailyDebriefNote(notes, date), [notes, date]);
  const existing = useMemo(() => readTaskenDebrief(existingNote), [existingNote]);
  const adaptiveQuestion = useMemo(() => selectAdaptiveQuestion(evidence), [evidence]);
  const usefulEvidence = evidence.filter(
    (entry) => entry.hasContent || entry.status === "blocked" || entry.remainingWork.length > 0,
  );
  const recordsOnly = evidence.filter((entry) => !usefulEvidence.includes(entry));
  const pendingCount = new Set(
    evidence.flatMap((entry) => (entry.proposal ? [entry.proposal.id] : [])),
  ).size;
  const [expanded, setExpanded] = useState(false);
  const [decision, setDecision] = useState("");
  const [corrections, setCorrections] = useState("");
  const [adaptiveAnswer, setAdaptiveAnswer] = useState("");
  const [nextTrigger, setNextTrigger] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [notPlanned, setNotPlanned] = useState(false);
  const [saving, setSaving] = useState(false);
  const openedAt = useRef(Date.now());

  useEffect(() => {
    setDecision(existing?.decision || "");
    setCorrections(existing?.evidence_corrections.join("\n") || "");
    setAdaptiveAnswer(existing?.adaptive_answer || "");
    setNextTrigger(existing?.next_return.trigger || "");
    setNextAction(existing?.next_return.first_action || "");
    setNotPlanned(existing?.next_return.resume_state === "not_planned");
  }, [existing]);

  async function saveDebrief() {
    if (!decision.trim()) {
      setToast("今日の判断を一文入力してください。保留した判断でも構いません。", "warning");
      return;
    }
    if (!notPlanned && (!nextTrigger.trim() || !nextAction.trim())) {
      setToast(
        "次に戻るきっかけと最初にすることを入力するか、『今は再開しない』を選んでください。",
        "warning",
      );
      return;
    }
    setSaving(true);
    try {
      for (const proposal of [
        ...new Map(
          evidence.flatMap((entry) =>
            entry.proposal ? [[entry.proposal.id, entry.proposal]] : [],
          ),
        ).values(),
      ]) {
        const command = buildAgentSessionAcceptanceCommand(proposal);
        if (command) await executeCommand(command);
      }
      const completedAt = new Date().toISOString();
      const record: TaskenDebriefRecord = {
        schema_version: TASKEN_DEBRIEF_SCHEMA_VERSION,
        kind: "daily",
        period_start: date,
        period_end: date,
        source_session_ids: evidence.map((entry) => entry.sourceSessionId),
        evidence_corrections: lines(corrections),
        decision: decision.trim(),
        adaptive_question: adaptiveQuestion,
        adaptive_answer: adaptiveQuestion ? adaptiveAnswer.trim() || null : null,
        next_return: {
          trigger: notPlanned ? "" : nextTrigger.trim(),
          first_action: notPlanned ? "" : nextAction.trim(),
          resume_state: notPlanned ? "not_planned" : "planned",
        },
        completed_at: completedAt,
        duration_seconds: Math.max(1, Math.round((Date.now() - openedAt.current) / 1000)),
      };
      const note = {
        ...(existingNote || {}),
        id: existingNote?.id || newId(),
        title: `Tasken Debrief — ${date}`,
        body_markdown: buildTaskenDebriefMarkdown(date, evidence, record),
        note_type: "report",
        content_format: "markdown",
        project_id: null,
        properties_json: {
          ...(existingNote?.properties_json || {}),
          tasken_debrief: record,
        },
      };
      await saveEntities(
        buildSaveNoteOperations(note, { source: "manual", reason: "Tasken Debrief" }),
        existingNote ? "Debriefを更新しました。" : "Debriefを保存しました。",
      );
      setExpanded(false);
    } catch (error) {
      setToast(
        `Debriefを保存できませんでした。入力は残しています。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setSaving(false);
    }
  }

  function renderEvidence(entry: (typeof evidence)[number]) {
    return (
      <details key={entry.id} className="tasken-debrief-evidence">
        <summary>
          <span className="tasken-debrief-evidence-meta">
            {CLIENT_LABELS[entry.clientKind] || entry.clientKind}
            {entry.proposal && <span>未確定の受信記録</span>}
          </span>
          <strong>
            {entry.remainingWork.length
              ? `要確認: ${entry.remainingWork.join(" / ")}`
              : entry.status === "blocked"
                ? `停止中: ${entry.outcome}`
                : entry.outcome}
          </strong>
          {entry.hasContent && (
            <span className="tasken-debrief-evidence-intent">{entry.intent}</span>
          )}
        </summary>
        <p>{entry.intent || "依頼内容の記録なし"}</p>
        <p>{entry.outcome}</p>
        <small>
          {entry.requests.length}件の指示 / {entry.responses.length}件の応答
        </small>
        {entry.verification.length > 0 && (
          <small>記録された確認: {entry.verification.join(" / ")}</small>
        )}
        <small>Session: {entry.sourceSessionId}</small>
      </details>
    );
  }

  return (
    <section className={`panel tasken-debrief-panel${expanded ? " is-expanded" : ""}`}>
      <div className="section-heading tasken-debrief-results-heading">
        <h2>AIから届いた結果</h2>
        <span>{usefulEvidence.length}件</span>
      </div>
      <div className="tasken-debrief-results">
        {usefulEvidence.length ? (
          <div className="tasken-debrief-evidence-list">
            {[...usefulEvidence]
              .sort(
                (left, right) =>
                  Number(right.status === "blocked" || right.remainingWork.length > 0) -
                  Number(left.status === "blocked" || left.remainingWork.length > 0),
              )
              .map(renderEvidence)}
          </div>
        ) : (
          <p className="tasken-debrief-empty">
            内容のあるAI作業はまだ届いていません。判断が必要な日に記録できます。
          </p>
        )}
        {recordsOnly.length > 0 && (
          <details className="tasken-debrief-records">
            <summary>結果の記録なし {recordsOnly.length}件</summary>
            <div className="tasken-debrief-evidence-list">{recordsOnly.map(renderEvidence)}</div>
          </details>
        )}
      </div>
      <div className="tasken-debrief-heading">
        <button
          type="button"
          className="tasken-debrief-toggle"
          aria-expanded={expanded}
          onClick={() => {
            openedAt.current = Date.now();
            setExpanded((value) => !value);
          }}
        >
          <span className="tasken-debrief-mark">
            <IconBrain size={17} aria-hidden="true" />
          </span>
          <span>
            <strong>{existing ? "判断と次の一手を編集する" : "判断と次の一手を残す"}</strong>
            <small>{existing ? existing.decision : "採用・修正・保留した判断を一文で"}</small>
          </span>
          {existing && (
            <span className="tasken-debrief-complete">
              <IconCircleCheck size={15} aria-hidden="true" />
              完了
            </span>
          )}
          {expanded ? (
            <IconChevronDown size={17} aria-hidden="true" />
          ) : (
            <IconChevronRight size={17} aria-hidden="true" />
          )}
        </button>
        {existingNote && (
          <button
            type="button"
            className="tasken-debrief-open-note"
            onClick={() => openContentViewer({ type: "note", noteId: existingNote.id })}
          >
            Reportを開く <IconExternalLink size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="tasken-debrief-flow">
          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>1</span>
              <strong>自分の判断</strong>
            </div>
            <div className="tasken-debrief-step-body">
              <label>
                <span>今日、AIの提案に対して、自分が採用・修正・保留した判断は何か？</span>
                <textarea
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  rows={3}
                  placeholder="例: 手順書は採用し、未検証の条件は保留する。"
                />
              </label>
            </div>
          </section>

          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>2</span>
              <strong>次の一手</strong>
            </div>
            <div className="tasken-debrief-step-body">
              <label>
                <span>次にこの作業へ戻るきっかけ</span>
                <input
                  value={nextTrigger}
                  onChange={(event) => setNextTrigger(event.target.value)}
                  disabled={notPlanned}
                  placeholder="例: 次にTaskenのMCP作業へ戻ったとき"
                />
              </label>
              <label>
                <span>最初にすること</span>
                <input
                  value={nextAction}
                  onChange={(event) => setNextAction(event.target.value)}
                  disabled={notPlanned}
                  placeholder="例: 実機確認チェックリストを開く"
                />
              </label>
              <label className="tasken-debrief-checkbox">
                <input
                  type="checkbox"
                  checked={notPlanned}
                  onChange={(event) => setNotPlanned(event.target.checked)}
                />
                <span>今は再開しない</span>
              </label>
              <details className="tasken-debrief-notes">
                <summary>訂正・補足を残す（任意）</summary>
                <label>
                  <span>事実と違う点があれば訂正</span>
                  <textarea
                    value={corrections}
                    onChange={(event) => setCorrections(event.target.value)}
                    rows={2}
                  />
                </label>
                {adaptiveQuestion && (
                  <label>
                    <span>{adaptiveQuestion}</span>
                    <textarea
                      value={adaptiveAnswer}
                      onChange={(event) => setAdaptiveAnswer(event.target.value)}
                      rows={2}
                    />
                  </label>
                )}
              </details>
              {pendingCount > 0 && (
                <p className="tasken-debrief-empty">
                  保存すると、上の未確定の受信記録 {pendingCount}
                  件も確認済みとして取り込みます。Taskの完了にはしません。
                </p>
              )}
              <div className="form-actions">
                <Button onClick={() => setExpanded(false)}>閉じる</Button>
                <Button variant="primary" disabled={saving} onClick={() => void saveDebrief()}>
                  {saving ? "保存中…" : existing ? "判断を更新する" : "判断を保存する"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
