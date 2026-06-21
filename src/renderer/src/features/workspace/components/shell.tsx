import { crossNavigation, toolNavigation } from "../../../pages/routes";
import { todayIso } from "../../../utils/dataFormat.js";
import type { OpenDrawer, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { themeColor } from "../lib/domain";

export function AppState({ state, message, onRetry }: { state: "loading" | "error"; message?: string; onRetry?: () => void }) {
  return (
    <main className="standalone-state">
      <div className={`state-box ${state}`}>
        {state === "loading" ? (
          <><span className="spinner" /><strong>作業台を読み込んでいます</strong></>
        ) : (
          <>
            <strong>作業台を読み込めませんでした</strong>
            <span>{message} アプリを再起動するか、もう一度試してください。</span>
            <button className="primary-button" onClick={onRetry}>再試行する</button>
          </>
        )}
      </div>
    </main>
  );
}

interface SidebarProps {
  route: string;
  navigate: (next: string) => void;
  themes: Theme[];
  activeThemeId: string;
  setActiveThemeId: (id: string) => void;
  domain: WorkspaceDomain;
  openDrawer: OpenDrawer;
}

export function Sidebar({
  route,
  navigate,
  themes,
  activeThemeId,
  setActiveThemeId,
  domain,
  openDrawer,
}: SidebarProps) {
  const inbox = domain.capture_entries.filter((e) => e.state === "untriaged").length;
  const today = todayIso();
  const schedulesByOwner = new Map(domain.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const todayCount = domain.tasks.filter((t) => {
    if (t.state === "done" || t.state === "cancelled") return false;
    const s = schedulesByOwner.get(`task:${t.id}`);
    return s && (s.start_date === today || s.end_date === today || (s.start_date && s.end_date && s.start_date <= today && s.end_date >= today));
  }).length;
  const waiting = domain.waitings.filter((w) => w.state === "waiting").length;
  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">T</span><div><strong>Tasken</strong></div></div>
      <nav className="primary-nav" aria-label="横断ビュー">
        <div className="nav-heading"><span>横断</span></div>
        {crossNavigation.map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
            {id === "today" && todayCount > 0 && <span className="count">{todayCount}</span>}
            {id === "inbox" && inbox > 0 && <span className="count">{inbox}</span>}
            {id === "waiting" && waiting > 0 && <span className="count">{waiting}</span>}
          </button>
        ))}
      </nav>
      <div className="theme-nav">
        <div className="nav-heading"><span>テーマ別</span><button onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>＋ 追加</button></div>
        <button className={`theme-nav-all ${route === "themes" ? "is-active" : ""}`} aria-current={route === "themes" ? "page" : undefined} onClick={() => navigate("themes")}>
          <span>すべてのテーマ</span><span className="count">{themes.length}</span>
        </button>
        {themes.map((theme, index) => {
          const current = route === "home" && theme.id === activeThemeId;
          return (
            <button key={theme.id} className={current ? "is-active" : ""} aria-current={current ? "page" : undefined} onClick={() => { setActiveThemeId(theme.id); navigate("home"); }}>
              <span className="theme-dot" style={{ background: `var(--color-${themeColor(theme, index)})` }} /><span>{theme.name}</span>
            </button>
          );
        })}
      </div>
      <nav className="primary-nav utility-nav" aria-label="ツール">
        <div className="nav-heading"><span>ツール</span></div>
        {toolNavigation.map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export function ShortcutDialog({ close }: { close: () => void }) {
  return (
    <div className="shortcut-overlay" onClick={close}>
      <div className="shortcut-dialog" role="dialog" aria-label="キーボードショートカット" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header"><strong>キーボードショートカット</strong><button onClick={close}>閉じる</button></div>
        <dl className="shortcut-list">
          <dt><kbd>?</kbd></dt><dd>この一覧を表示</dd>
          <dt><kbd>Alt</kbd>+<kbd>N</kbd></dt><dd>クイック記録</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>K</kbd></dt><dd>検索へ移動</dd>
          <dt><kbd>Esc</kbd></dt><dd>パネルを閉じる</dd>
        </dl>
      </div>
    </div>
  );
}
