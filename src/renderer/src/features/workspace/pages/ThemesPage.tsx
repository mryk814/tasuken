import type { PageProps } from "../types";
import { PageHeader, StatusBadge } from "../components/common";

export function ThemesPage({ themes, items, data, activeThemeId, setActiveThemeId, navigate, openDrawer }: PageProps) {
  return (
    <div className="page">
      <PageHeader title="Themes" subtitle="研究テーマごとの現在地と負荷を確認します。">
        <button className="primary-button" onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>テーマを追加</button>
      </PageHeader>
      <div className="theme-card-grid">
        {themes.map((theme) => {
          const related = items.filter((item) => item.theme_id === theme.id);
          const latest = (data.status_updates || [])
            .filter((entry) => entry.theme_id === theme.id)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
          return (
            <button className={`panel theme-card ${activeThemeId === theme.id ? "selected" : ""}`} key={theme.id} onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}>
              <StatusBadge value={theme.status} label={theme.status} />
              <h2>{theme.name}</h2>
              <p>{latest?.summary || theme.description || "現在地は未記録です。"}</p>
              <div>
                <span><strong className="metric-value">{related.filter((item) => item.status !== "done").length}</strong> 未完了</span>
                <span><strong className="metric-value">{related.filter((item) => item.status === "waiting").length}</strong> 待ち</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
