import { IconArrowUpRight, IconCalendarStats, IconCircleCheck } from "@tabler/icons-react";

import { todayIso } from "../../../utils/dataFormat.js";
import { PageHeader } from "../components/common";
import { ActivityLogPanel } from "../components/ActivityLogPanel";
import { AgentWorkSummaryPanel } from "../components/AgentWorkSummaryPanel";
import { TaskenDebriefPanel } from "../components/TaskenDebriefPanel";
import { TaskenWeeklyDebriefPanel } from "../components/TaskenWeeklyDebriefPanel";
import { readTaskenDebrief } from "../lib/taskenDebrief";
import type { PageProps } from "../types";

export function DebriefPage({
  data,
  domain,
  themes,
  notes,
  saveEntities,
  executeCommand,
  openContentViewer,
  setToast,
  openDrawer,
  setActiveThemeId,
  navigate,
}: PageProps) {
  const today = todayIso();
  const history = notes
    .flatMap((note) => {
      const debrief = readTaskenDebrief(note);
      return debrief ? [{ note, debrief }] : [];
    })
    .sort((left, right) => right.debrief.period_end.localeCompare(left.debrief.period_end))
    .slice(0, 14);

  return (
    <div className="page debrief-page">
      <PageHeader route="debrief" />

      <section className="debrief-current" aria-label="今日のDebrief">
        <div className="debrief-section-heading">
          <div>
            <span>NOW</span>
            <h2>結果を確認して、次の一手へ</h2>
          </div>
          <time>{today}</time>
        </div>
        <TaskenDebriefPanel
          date={today}
          domain={domain}
          notes={notes}
          saveEntities={saveEntities}
          executeCommand={executeCommand}
          openContentViewer={openContentViewer}
          setToast={setToast}
        />
        <AgentWorkSummaryPanel
          domain={domain}
          date={today}
          carryoverOnly
          groupByTheme
          limit={30}
          title="AI作業の引き継ぎ"
          openDrawer={openDrawer}
          saveEntities={saveEntities}
          onOpenTheme={(themeId) => {
            setActiveThemeId(themeId);
            navigate("theme");
          }}
        />
        <details className="panel debrief-activity-details">
          <summary>時系列の記録を見る</summary>
          <ActivityLogPanel
            data={data}
            domain={domain}
            themes={themes}
            openDrawer={openDrawer}
            setToast={setToast}
          />
        </details>
        <TaskenWeeklyDebriefPanel
          date={today}
          notes={notes}
          saveEntities={saveEntities}
          openContentViewer={openContentViewer}
          setToast={setToast}
        />
      </section>

      <section className="panel debrief-history">
        <div className="debrief-section-heading">
          <div>
            <span>HISTORY</span>
            <h2>自分が回収した判断</h2>
          </div>
          <small>{history.length} reports</small>
        </div>
        {history.length ? (
          <div className="debrief-history-list">
            {history.map(({ note, debrief }) => (
              <button
                key={note.id}
                type="button"
                onClick={() => openContentViewer({ type: "note", noteId: note.id })}
              >
                <span className="debrief-history-icon">
                  {debrief.kind === "weekly" ? (
                    <IconCalendarStats size={17} />
                  ) : (
                    <IconCircleCheck size={17} />
                  )}
                </span>
                <span>
                  <strong>{debrief.kind === "weekly" ? "Weekly" : debrief.period_start}</strong>
                  <small>{debrief.decision}</small>
                </span>
                <IconArrowUpRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p className="debrief-history-empty">
            Dailyを完了すると、自分で書いた判断がここに積み上がります。
          </p>
        )}
      </section>
    </div>
  );
}
