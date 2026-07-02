import { IconPencil, IconTrash } from "@tabler/icons-react";

import type { PageProps } from "../types";
import { themeColor } from "../lib/domain";
import { PageHeader } from "../components/common";

export function ThemesPage({ data, themes, domain: v2, activeThemeId, setActiveThemeId, navigate, openDrawer, removeEntity }: PageProps) {

  return (
    <div className="page">
      <PageHeader title="Themes" subtitle="研究テーマごとの現在地と負荷を確認します。">
        <button className="primary-button" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>テーマを追加</button>
      </PageHeader>
      <div className="theme-card-grid">
        {themes.map((theme, index) => {
          const openTasks = v2.tasks.filter((t) => t.project_id === theme.id && t.state !== "done" && t.state !== "cancelled").length;
          const doneTasks = v2.tasks.filter((t) => t.project_id === theme.id && t.state === "done").length;
          const openWaitings = v2.waitings.filter((w) => w.project_id === theme.id && w.state === "waiting").length;
          const openPlanNodes = v2.plan_nodes.filter((p) => p.project_id === theme.id && p.state !== "done" && p.state !== "cancelled").length;
          const relatedNotes = v2.notes.filter((note) => note.project_id === theme.id).length;
          const chatRefs = v2.resources.filter((resource) => resource.project_id === theme.id && (resource.reference_status || resource.chat_group || resource.link_type)).length;
          const latest = (data.status_updates || [])
            .filter((entry) => entry.theme_id === theme.id)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          const childCount = openTasks + openPlanNodes + openWaitings;
          return (
            <article
              className={`panel theme-card ${activeThemeId === theme.id ? "selected" : ""}`}
              key={theme.id}
              style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
            >
              <div className="theme-card-top">
                <span className="theme-code">{theme.code || "識別子なし"}</span>
                <div className="inline-actions">
                  <button
                    className="row-action-button"
                    onClick={() => openDrawer({ type: "theme", mode: "edit", entity: theme })}
                    aria-label={`${theme.name}を編集`}
                    title="編集"
                  >
                    <IconPencil size={15} />
                  </button>
                  <button
                    className="row-action-button danger"
                    onClick={() => removeEntity("theme", theme)}
                    aria-label={`${theme.name}を削除`}
                    title="削除"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
              <h2>{theme.name}</h2>
              <p>{latest?.summary || theme.description || "現在地は未記録です。"}</p>
              <div>
                <span><strong className="metric-value">{openTasks + openPlanNodes}</strong> 未完了</span>
                <span><strong className="metric-value">{openWaitings}</strong> 待ち</span>
              </div>
              <div className="theme-related-strip">
                <button className="text-button compact" onClick={() => { setActiveThemeId(theme.id); navigate("todo"); }}>タスク {openTasks + doneTasks}</button>
                <button className="text-button compact" onClick={() => { setActiveThemeId(theme.id); navigate("notes"); }}>Notes {relatedNotes}</button>
                <button className="text-button compact" onClick={() => { setActiveThemeId(theme.id); navigate("chat-refs"); }}>チャット {chatRefs}</button>
              </div>
              <button className="text-button compact" onClick={() => { setActiveThemeId(theme.id); navigate("theme"); }}>開く</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
