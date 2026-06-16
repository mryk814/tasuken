import type { PageProps } from "../types";
import { THEME_STATUS_LABELS, themeColor } from "../lib/domain";
import { PageHeader, StatusBadge } from "../components/common";

export function ThemesPage({ themes, items, data, activeThemeId, setActiveThemeId, navigate, openDrawer }: PageProps) {
  return (
    <div className="page">
      <PageHeader title="Themes" subtitle="研究テーマごとの現在地と負荷を確認します。">
        <button className="primary-button" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>テーマを追加</button>
      </PageHeader>
      <div className="theme-card-grid">
        {themes.map((theme, index) => {
          const related = items.filter((item) => item.theme_id === theme.id);
          const latest = (data.status_updates || [])
            .filter((entry) => entry.theme_id === theme.id)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          return (
            <article
              className={`panel theme-card ${activeThemeId === theme.id ? "selected" : ""}`}
              key={theme.id}
              style={{ "--chip-color": `var(--color-${themeColor(theme, index)})` } as React.CSSProperties}
            >
              <div className="theme-card-top">
                <StatusBadge value={theme.status} label={THEME_STATUS_LABELS[theme.status ?? ""] || theme.status} />
                <button className="secondary-button compact" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: theme })}>編集</button>
              </div>
              <h2>{theme.name}</h2>
              <p>{latest?.summary || theme.description || "現在地は未記録です。"}</p>
              <div>
                <span><strong className="metric-value">{related.filter((item) => item.status !== "done").length}</strong> 未完了</span>
                <span><strong className="metric-value">{related.filter((item) => item.status === "waiting").length}</strong> 待ち</span>
              </div>
              <button className="text-button compact" onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}>開く</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
