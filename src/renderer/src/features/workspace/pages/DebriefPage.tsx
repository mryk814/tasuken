import { useState } from "react";
import { IconArrowUpRight, IconNotes } from "@tabler/icons-react";

import { agentDateText } from "../lib/activityTimelineLayout";
import { PageHeader } from "../components/common";
import { ActivityLogPanel } from "../components/ActivityLogPanel";
import { TaskenDebriefPanel } from "../components/TaskenDebriefPanel";
import { dailyReportDate, readTaskenDebrief } from "../lib/taskenDebrief";
import type { PageProps } from "../types";
import { AgentWorkTimeline } from "../components/AgentWorkTimeline";

export function DebriefPage(props: PageProps) {
  const { data, domain, themes, notes, setToast, openDrawer, openNoteForEditing } = props;
  const [date, setDate] = useState(agentDateText(new Date()));
  const [importing, setImporting] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const history = notes
    .flatMap((note) => {
      const reportDate = dailyReportDate(note);
      const debrief = readTaskenDebrief(note);
      const period = reportDate || debrief?.period_end;
      return period ? [{ note, period }] : [];
    })
    .sort((left, right) => right.period.localeCompare(left.period))
    .slice(0, 14);

  return (
    <div className="page debrief-page">
      <PageHeader route="debrief" />
      <section className="debrief-current" aria-label="一日の記録">
        <ActivityLogPanel
          data={data}
          domain={domain}
          themes={themes}
          date={date}
          onDateChange={setDate}
          openDrawer={openDrawer}
          setToast={setToast}
          saveEntities={props.saveEntities}
          removeEntityQuiet={props.removeEntityQuiet}
          onImport={() => {
            setWeeklyOpen(true);
            setImporting(true);
          }}
        />
        <details
          className="debrief-tasken-activity"
          open={weeklyOpen}
          onToggle={(event) => setWeeklyOpen(event.currentTarget.open)}
        >
          <summary>AI の週次振り返り・ログ取り込み</summary>
          <AgentWorkTimeline
            {...props}
            date={date}
            onDateChange={setDate}
            importing={importing}
            onImportingChange={setImporting}
          />
        </details>
        <TaskenDebriefPanel
          date={date}
          domain={domain}
          notes={notes}
          openReport={openNoteForEditing}
          setToast={setToast}
          reportsOnly
        />
      </section>
      <section className="panel debrief-history">
        <div className="section-heading">
          <h2>これまでの日報</h2>
        </div>
        {history.length ? (
          <div className="debrief-history-list">
            {history.map(({ note, period }) => (
              <button key={note.id} type="button" onClick={() => openNoteForEditing(note.id)}>
                <span className="debrief-history-icon">
                  <IconNotes size={17} />
                </span>
                <span>
                  <strong>{period}</strong>
                  <small>{note.title}</small>
                </span>
                <IconArrowUpRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p className="debrief-history-empty">採用した日報がここに並びます。</p>
        )}
      </section>
    </div>
  );
}
