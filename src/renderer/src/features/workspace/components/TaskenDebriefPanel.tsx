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
      setToast("My decisionを一文書いてください。立派な結論でなくても構いません。", "warning");
      return;
    }
    if (!notPlanned && (!nextTrigger.trim() || !nextAction.trim())) {
      setToast(
        "Next returnのきっかけと最初の行動を入力するか、『今は再開しない』を選んでください。",
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

  return (
    <section className={`panel tasken-debrief-panel${expanded ? " is-expanded" : ""}`}>
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
            <strong>Tasken Debrief</strong>
            <small>
              {existing ? "自分の判断を回収済み" : `${evidence.length} sessionから振り返る`}
            </small>
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
          <section className="tasken-debrief-step">
            <div className="tasken-debrief-step-label">
              <span>1</span>
              <strong>Evidence</strong>
            </div>
            <div className="tasken-debrief-step-body">
              {evidence.length ? (
                <div className="tasken-debrief-evidence-list">
                  {evidence.map((entry) => (
                    <article key={entry.id} className="tasken-debrief-evidence">
                      <div>
                        <span>{CLIENT_LABELS[entry.clientKind] || entry.clientKind}</span>
                        <span className={`evidence-strength strength-${entry.strength}`}>
                          AI報告
                        </span>
                      </div>
                      <strong>{entry.outcome}</strong>
                      <p>{entry.intent}</p>
                      {entry.requests.length > 1 && (
                        <small>途中の指示 {entry.requests.length}件</small>
                      )}
                      {entry.verification.length > 0 && (
                        <small>検証: {entry.verification.join(" / ")}</small>
                      )}
                      {entry.remainingWork.length > 0 && (
                        <small className="has-remaining">
                          残り: {entry.remainingWork.join(" / ")}
                        </small>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="tasken-debrief-empty">
                  この日のAI sessionはありません。AIを使わなかった日の判断として記録できます。
                </p>
              )}
              <label>
                <span>事実と違う点があれば訂正</span>
                <textarea
                  value={corrections}
                  onChange={(event) => setCorrections(event.target.value)}
                  rows={2}
                  placeholder="一行に一件。なければ空欄で構いません。"
                />
              </label>
            </div>
          </section>

          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>2</span>
              <strong>My decision</strong>
            </div>
            <div className="tasken-debrief-step-body">
              <label>
                <span>今日、AIの提案に対して、自分が採用・修正・保留した判断は何か？</span>
                <textarea
                  value={decision}
                  onChange={(event) => setDecision(event.target.value)}
                  rows={3}
                  placeholder="『AI案を採用したが、理解は追いついていない』でも有効です。"
                />
              </label>
            </div>
          </section>

          {adaptiveQuestion && (
            <section className="tasken-debrief-step">
              <div className="tasken-debrief-step-label">
                <span>3</span>
                <strong>One question</strong>
              </div>
              <div className="tasken-debrief-step-body">
                <label>
                  <span>{adaptiveQuestion}</span>
                  <textarea
                    value={adaptiveAnswer}
                    onChange={(event) => setAdaptiveAnswer(event.target.value)}
                    rows={2}
                  />
                </label>
              </div>
            </section>
          )}

          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>{adaptiveQuestion ? 4 : 3}</span>
              <strong>Next return</strong>
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
                <span>最初にする観測可能な行動</span>
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
              <div className="form-actions">
                <Button onClick={() => setExpanded(false)}>閉じる</Button>
                <Button variant="primary" disabled={saving} onClick={() => void saveDebrief()}>
                  {saving ? "保存中…" : existing ? "Debriefを更新" : "Debriefを完了"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
