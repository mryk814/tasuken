import { useState } from "react";
import { IconArrowUpRight, IconNotes } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import { PageHeader } from "../components/common";
import { ActivityLogPanel } from "../components/ActivityLogPanel";
import { TaskenDebriefPanel } from "../components/TaskenDebriefPanel";
import { dailyReportDate, readTaskenDebrief } from "../lib/taskenDebrief";
import type { PageProps } from "../types";

export function DebriefPage({
  data,
  domain,
  themes,
  notes,
  setToast,
  openDrawer,
  openNoteForEditing,
}: PageProps) {
  const [date, setDate] = useState(todayIso());
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
        />
        <TaskenDebriefPanel
          date={date}
          domain={domain}
          notes={notes}
          openReport={openNoteForEditing}
          setToast={setToast}
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
