import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconCalendarStats,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconExternalLink,
} from "@tabler/icons-react";

import type { PageProps } from "../types";
import { buildSaveNoteOperations } from "../domain-model/persistence";
import {
  buildWeeklyDebriefMarkdown,
  dailyDebriefsForPeriod,
  findWeeklyDebriefNote,
  readTaskenDebrief,
  TASKEN_DEBRIEF_SCHEMA_VERSION,
  weeklyDebriefPeriod,
  type TaskenDebriefRecord,
} from "../lib/taskenDebrief";
import { Button } from "./common";

interface TaskenWeeklyDebriefPanelProps {
  date: string;
  notes: PageProps["notes"];
  saveEntities: PageProps["saveEntities"];
  openContentViewer: PageProps["openContentViewer"];
  setToast: PageProps["setToast"];
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function TaskenWeeklyDebriefPanel({
  date,
  notes,
  saveEntities,
  openContentViewer,
  setToast,
}: TaskenWeeklyDebriefPanelProps) {
  const period = useMemo(() => weeklyDebriefPeriod(date), [date]);
  const daily = useMemo(
    () => dailyDebriefsForPeriod(notes, period.start, period.end),
    [notes, period],
  );
  const existingNote = useMemo(
    () => findWeeklyDebriefNote(notes, period.start, period.end),
    [notes, period],
  );
  const existing = useMemo(() => readTaskenDebrief(existingNote), [existingNote]);
  const [expanded, setExpanded] = useState(false);
  const [repeatedPattern, setRepeatedPattern] = useState("");
  const [stalledReturn, setStalledReturn] = useState("");
  const [delegationBoundary, setDelegationBoundary] = useState("");
  const [saving, setSaving] = useState(false);
  const openedAt = useRef(Date.now());

  useEffect(() => {
    setRepeatedPattern(existing?.weekly_reflection?.repeated_pattern || "");
    setStalledReturn(existing?.weekly_reflection?.stalled_return || "");
    setDelegationBoundary(existing?.weekly_reflection?.delegation_boundary || "");
  }, [existing]);

  if (!daily.length) return null;

  async function saveDebrief() {
    if (!repeatedPattern.trim() || !stalledReturn.trim() || !delegationBoundary.trim()) {
      setToast("Weeklyの3つの問いに、自分の言葉で答えてください。", "warning");
      return;
    }
    setSaving(true);
    try {
      const completedAt = new Date().toISOString();
      const sourceSessionIds = [
        ...new Set(daily.flatMap(({ debrief }) => debrief.source_session_ids)),
      ];
      const record: TaskenDebriefRecord = {
        schema_version: TASKEN_DEBRIEF_SCHEMA_VERSION,
        kind: "weekly",
        period_start: period.start,
        period_end: period.end,
        source_session_ids: sourceSessionIds,
        evidence_corrections: [],
        decision: repeatedPattern.trim(),
        adaptive_question: "どのNext returnが止まり、その理由は何だった？",
        adaptive_answer: stalledReturn.trim(),
        next_return: {
          trigger: "次のAI委任時",
          first_action: delegationBoundary.trim(),
          resume_state: "planned",
        },
        completed_at: completedAt,
        duration_seconds: Math.max(1, Math.round((Date.now() - openedAt.current) / 1000)),
        weekly_reflection: {
          repeated_pattern: repeatedPattern.trim(),
          stalled_return: stalledReturn.trim(),
          delegation_boundary: delegationBoundary.trim(),
        },
      };
      const note = {
        ...(existingNote || {}),
        id: existingNote?.id || newId(),
        title: `Tasken Debrief Weekly — ${period.start}–${period.end}`,
        body_markdown: buildWeeklyDebriefMarkdown(daily, record),
        note_type: "report",
        content_format: "markdown",
        project_id: null,
        properties_json: { ...(existingNote?.properties_json || {}), tasken_debrief: record },
      };
      await saveEntities(
        buildSaveNoteOperations(note, { source: "manual", reason: "Tasken Debrief Weekly" }),
        existingNote ? "Weekly Debriefを更新しました。" : "Weekly Debriefを保存しました。",
      );
      setExpanded(false);
    } catch (error) {
      setToast(
        `Weekly Debriefを保存できませんでした。入力は残しています。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={`panel tasken-debrief-panel tasken-weekly-debrief${expanded ? " is-expanded" : ""}`}
    >
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
            <IconCalendarStats size={17} aria-hidden="true" />
          </span>
          <span>
            <strong>Weekly Debrief</strong>
            <small>
              {existing
                ? "週の委任パターンを回収済み"
                : `${daily.length}日分の自分の判断から振り返る`}
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
          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>1</span>
              <strong>Pattern</strong>
            </div>
            <div className="tasken-debrief-step-body">
              <div className="tasken-weekly-decisions">
                {daily.map(({ debrief }) => (
                  <p key={debrief.period_start}>
                    <time>{debrief.period_start.slice(5)}</time>
                    {debrief.decision}
                  </p>
                ))}
              </div>
              <label>
                <span>繰り返した判断・委任の癖は何だった？</span>
                <textarea
                  rows={3}
                  value={repeatedPattern}
                  onChange={(event) => setRepeatedPattern(event.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>2</span>
              <strong>Stall</strong>
            </div>
            <div className="tasken-debrief-step-body">
              <label>
                <span>どのNext returnが止まり、その理由は何だった？</span>
                <textarea
                  rows={2}
                  value={stalledReturn}
                  onChange={(event) => setStalledReturn(event.target.value)}
                />
              </label>
            </div>
          </section>
          <section className="tasken-debrief-step is-required">
            <div className="tasken-debrief-step-label">
              <span>3</span>
              <strong>Boundary</strong>
            </div>
            <div className="tasken-debrief-step-body">
              <label>
                <span>次の週、AIに任せる範囲と自分で判断する境界は？</span>
                <textarea
                  rows={2}
                  value={delegationBoundary}
                  onChange={(event) => setDelegationBoundary(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <Button onClick={() => setExpanded(false)}>閉じる</Button>
                <Button variant="primary" disabled={saving} onClick={() => void saveDebrief()}>
                  {saving ? "保存中…" : existing ? "Weeklyを更新" : "Weeklyを完了"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
