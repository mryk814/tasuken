import { useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconCalendarCheck,
  IconKeyboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMinus,
  IconMoon,
  IconNotes,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";

import { crossNavigation, knowledgeHubTabs, routeIcon, routeLabel, todayHubTabs, toolNavigation } from "../../../pages/routes";
import { todayIso } from "../../../utils/dataFormat.js";
import type { OpenDrawer, Theme } from "../types";
import type { WorkspaceDomain } from "../domain-model/types";
import { isPersonalDefaultTheme } from "../../../../../shared/personalTheme.mjs";
import { themeColor } from "../lib/domain";
import { preloadWorkspacePage } from "../workspacePageLoaders";

const taskenIconUrl = new URL("../../../../../../resources/icon.png", import.meta.url).href;

interface AppTitleBarProps {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  zoomFactor: number;
  setZoomFactor: (factor: number) => void;
  themeMode: "light" | "dark";
  setThemeMode: (mode: "light" | "dark") => void;
  openShortcuts: () => void;
  openSettings: () => void;
  openCommandPalette: () => void;
  launcher?: TitleBarLauncherData;
  /** 切り離しウィンドウ（#290）。Sidebarが無いので開閉トグルを出さない（#329）。 */
  detached?: boolean;
}

export interface TitleBarLauncherData {
  todayWindowOpen: boolean;
  stickyWindowsShown: boolean;
  /** 付箋表示対象を一括で展開／収納する。Memo自体は変更しない。 */
  toggleStickyWindows(): void;
  toggleTodayWindow(): void;
}

/** Top Barから衛星ウィンドウを直接操作する（#327）。Popoverは経由しない。 */
function TitleBarLauncher({ launcher }: { launcher: TitleBarLauncherData }) {
  const todayLabel = launcher.todayWindowOpen ? "今日やることを収納" : "今日やることを表示";
  return (
    <div className="titlebar-launcher">
        <button
          type="button"
          className={`titlebar-launcher-button${launcher.todayWindowOpen ? " is-active" : ""}`}
          aria-label={todayLabel}
          title={todayLabel}
          aria-pressed={launcher.todayWindowOpen}
          onClick={launcher.toggleTodayWindow}
        >
          <IconCalendarCheck size={16} aria-hidden="true" />
          <span className="titlebar-launcher-state" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`titlebar-launcher-button${launcher.stickyWindowsShown ? " is-active" : ""}`}
          aria-label="付箋を展開または収納"
          title="付箋を展開または収納"
          aria-pressed={launcher.stickyWindowsShown}
          onClick={launcher.toggleStickyWindows}
        >
          <IconNotes size={16} aria-hidden="true" />
          <span className="titlebar-launcher-state" aria-hidden="true" />
        </button>
    </div>
  );
}

export function AppTitleBar({
  collapsed,
  setCollapsed,
  zoomFactor,
  setZoomFactor,
  themeMode,
  setThemeMode,
  openShortcuts,
  openSettings,
  openCommandPalette,
  launcher,
  detached = false,
}: AppTitleBarProps) {
  const [openMenu, setOpenMenu] = useState<"view" | "help" | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const zoomPercent = Math.round(zoomFactor * 100);

  useEffect(() => {
    if (!openMenu) return undefined;
    const closeMenus = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    addEventListener("pointerdown", closeMenus);
    addEventListener("keydown", closeOnEscape);
    return () => {
      removeEventListener("pointerdown", closeMenus);
      removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  const chooseHelpAction = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <header className={`app-titlebar${detached ? " is-detached" : ""}`}>
      {!detached && (
        <button
          className="titlebar-sidebar-toggle"
          type="button"
          aria-label={collapsed ? "サイドバーを広げる" : "サイドバーを畳む"}
          title={collapsed ? "サイドバーを広げる" : "サイドバーを畳む"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed
            ? <IconLayoutSidebarLeftExpand size={17} aria-hidden="true" />
            : <IconLayoutSidebarLeftCollapse size={17} aria-hidden="true" />}
        </button>
      )}
      <div className="titlebar-brand" aria-label="Tasken">
        <img src={taskenIconUrl} alt="" aria-hidden="true" />
        <strong>Tasken</strong>
      </div>
      {launcher && <TitleBarLauncher launcher={launcher} />}
      <div className="titlebar-drag-space" />
      <div className="titlebar-controls" ref={controlsRef}>
        <button
          type="button"
          className="titlebar-command-button"
          onClick={openCommandPalette}
          title="Command Palette (Ctrl+Shift+K)"
        >
          <IconSearch size={15} aria-hidden="true" />
          <span>コマンド</span>
          <kbd>Ctrl+Shift+K</kbd>
        </button>
        <div className="titlebar-menu-anchor">
          <button
            className={openMenu === "view" ? "is-active" : ""}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "view"}
            onClick={() => setOpenMenu((current) => current === "view" ? null : "view")}
          >
            表示 <IconChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "view" && (
            <div className="titlebar-menu titlebar-view-menu" role="menu" aria-label="表示">
              <div className="titlebar-zoom-row">
                <button
                  type="button"
                  aria-label="縮小"
                  title="縮小"
                  disabled={zoomFactor <= 0.8}
                  onClick={() => setZoomFactor(Math.max(0.8, zoomFactor - 0.1))}
                >
                  <IconMinus size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setZoomFactor(1)}>{zoomPercent}%</button>
                <button
                  type="button"
                  aria-label="拡大"
                  title="拡大"
                  disabled={zoomFactor >= 1.3}
                  onClick={() => setZoomFactor(Math.min(1.3, zoomFactor + 0.1))}
                >
                  <IconPlus size={16} aria-hidden="true" />
                </button>
              </div>
              <button
                className="titlebar-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setThemeMode(themeMode === "light" ? "dark" : "light");
                  setOpenMenu(null);
                }}
              >
                {themeMode === "light" ? <IconMoon size={16} aria-hidden="true" /> : <IconSun size={16} aria-hidden="true" />}
                {themeMode === "light" ? "ダーク表示" : "ライト表示"}
              </button>
            </div>
          )}
        </div>
        <div className="titlebar-menu-anchor">
          <button
            className={openMenu === "help" ? "is-active" : ""}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "help"}
            onClick={() => setOpenMenu((current) => current === "help" ? null : "help")}
          >
            ヘルプ <IconChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "help" && (
            <div className="titlebar-menu" role="menu" aria-label="ヘルプ">
              <button className="titlebar-menu-item" type="button" role="menuitem" onClick={() => chooseHelpAction(openShortcuts)}>
                <IconKeyboard size={16} aria-hidden="true" />
                ショートカット
              </button>
              <button className="titlebar-menu-item" type="button" role="menuitem" onClick={() => chooseHelpAction(openSettings)}>
                <IconSettings size={16} aria-hidden="true" />
                設定を開く
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

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
  collapsed: boolean;
  themes: Theme[];
  activeThemeId: string;
  setActiveThemeId: (id: string) => void;
  domain: WorkspaceDomain;
  openDrawer: OpenDrawer;
  /** 実行中のFocus Session（#316）。右下floatingではなくSidebar下部で見せる。 */
  activeFocus?: { taskTitle: string; startedAt: string } | null;
  openActiveFocus?: () => void;
}

function elapsedFocusLabel(startedAt: string, now: number): string {
  const started = new Date(startedAt).getTime();
  const seconds = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((now - started) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/**
 * 実行中のFocus Session（#316）。
 * navigationを圧迫しないよう下部の固定領域に置き、色だけでなくlabelと経過時間で示す。
 * pulse等の動きは `prefers-reduced-motion` をCSS側で尊重する。
 */
function SidebarFocus({
  focus,
  collapsed,
  onOpen,
}: {
  focus: { taskTitle: string; startedAt: string };
  collapsed: boolean;
  onOpen: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = elapsedFocusLabel(focus.startedAt, now);
  return (
    <button
      type="button"
      className="sidebar-focus"
      onClick={onOpen}
      title={`集中して作業中: ${focus.taskTitle}（${elapsed}）`}
      aria-label={`集中して作業中: ${focus.taskTitle}。経過${elapsed}。開く`}
    >
      <span className="sidebar-focus-label">
        <span className="sidebar-focus-dot" aria-hidden="true" />
        {!collapsed && "FOCUS"}
      </span>
      {!collapsed && (
        <>
          <span className="sidebar-focus-title">{focus.taskTitle}</span>
          <span className="sidebar-focus-time">{elapsed}</span>
        </>
      )}
    </button>
  );
}

export function Sidebar({
  route,
  navigate,
  collapsed,
  themes,
  activeThemeId,
  setActiveThemeId,
  domain,
  openDrawer,
  activeFocus,
  openActiveFocus,
}: SidebarProps) {
  const inbox = domain.capture_entries.filter((e) => e.state === "untriaged" && e.kind !== "micro_memo").length;
  const today = todayIso();
  const schedulesByOwner = new Map(domain.schedules.map((s) => [`${s.owner_type}:${s.owner_id}`, s]));
  const todayCount = domain.tasks.filter((t) => {
    if (t.state === "done" || t.state === "cancelled") return false;
    const s = schedulesByOwner.get(`task:${t.id}`);
    return s && (s.start_date === today || s.end_date === today || (s.start_date && s.end_date && s.start_date <= today && s.end_date >= today));
  }).length;
  const overdueTasks = domain.tasks.filter((t) => {
    if (t.state === "done" || t.state === "cancelled") return false;
    const s = schedulesByOwner.get(`task:${t.id}`);
    const due = String(s?.end_date || "");
    return Boolean(due && due < today);
  }).length;
  const proposalCount = domain.ai_proposals.filter((proposal) => proposal.status === "pending").length;
  const countByRoute: Record<string, number> = {
    today: todayCount,
    todo: overdueTasks,
    inbox,
    "ai-io": proposalCount,
  };
  const renderNavButton = (id: string) => {
    const label = routeLabel(id);
    const count = countByRoute[id] || 0;
    const NavIcon = routeIcon(id);
    return (
      <button
        key={id}
        className={route === id ? "is-active" : ""}
        aria-current={route === id ? "page" : undefined}
        aria-label={label}
        title={collapsed ? label : undefined}
        onMouseEnter={() => preloadWorkspacePage(id)}
        onFocus={() => preloadWorkspacePage(id)}
        onClick={() => navigate(id)}
      >
        {NavIcon && <NavIcon className="nav-icon" size={17} stroke={1.8} aria-hidden="true" />}
        <span className="nav-label">{label}</span>
        {count > 0 && <span className="count">{count}</span>}
      </button>
    );
  };

  return (
    <aside className="sidebar">
      <nav className="primary-nav nav-group" aria-label="今日の運用">
        <div className="nav-heading"><span>今日の運用</span></div>
        {todayHubTabs.map(renderNavButton)}
      </nav>
      <nav className="primary-nav" aria-label="横断ビュー">
        <div className="nav-heading"><span>横断</span></div>
        {crossNavigation.map(renderNavButton)}
      </nav>
      <nav className="primary-nav nav-group" aria-label="知識整理">
        <div className="nav-heading"><span>知識整理</span></div>
        {knowledgeHubTabs.map(renderNavButton)}
      </nav>
      <div className="theme-nav">
        <div className="nav-heading"><span>テーマ別</span><button onClick={() => openDrawer({ type: "theme", mode: "edit", entity: {} })}>＋ 追加</button></div>
        <button
          className={`theme-nav-all ${route === "themes" ? "is-active" : ""}`}
          aria-current={route === "themes" ? "page" : undefined}
          aria-label="All Themes"
          title={collapsed ? "All Themes" : undefined}
          onMouseEnter={() => preloadWorkspacePage("themes")}
          onFocus={() => preloadWorkspacePage("themes")}
          onClick={() => navigate("themes")}
        >
          <span className="theme-dot theme-dot-all" aria-hidden="true" />
          <span className="theme-nav-label">All Themes</span>
        </button>
        {themes.map((theme, index) => {
          const current = route === "theme" && theme.id === activeThemeId;
          // 既定Themeは先頭に固定し、装飾を強くせず区切りだけで「常設」を示す（#282）。
          const isDefault = isPersonalDefaultTheme(theme);
          return (
            <button
              key={theme.id}
              className={`${current ? "is-active" : ""}${isDefault ? " is-default-theme" : ""}`}
              aria-current={current ? "page" : undefined}
              aria-label={theme.name}
              title={collapsed ? theme.name : undefined}
              onMouseEnter={() => preloadWorkspacePage("theme")}
              onFocus={() => preloadWorkspacePage("theme")}
              onClick={() => { setActiveThemeId(theme.id); navigate("theme"); }}
            >
              <span className="theme-dot" style={{ background: `var(--color-${themeColor(theme, index)})` }} aria-hidden="true" />
              <span className="theme-nav-label">{theme.name}</span>
            </button>
          );
        })}
      </div>
      <nav className="primary-nav utility-nav" aria-label="ツール">
        <div className="nav-heading"><span>ツール</span></div>
        {toolNavigation.map(renderNavButton)}
      </nav>
      {activeFocus && openActiveFocus && (
        <SidebarFocus focus={activeFocus} collapsed={collapsed} onOpen={openActiveFocus} />
      )}
    </aside>
  );
}

export function ShortcutDialog({ close }: { close: () => void }) {
  return (
    <div className="shortcut-overlay" onClick={close}>
      <div className="shortcut-dialog" role="dialog" aria-label="ショートカット" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header"><strong>ショートカット</strong><button onClick={close}>閉じる</button></div>
        <dl className="shortcut-list">
          <dt><kbd>?</kbd></dt><dd>この一覧を表示</dd>
          <dt><kbd>Alt</kbd>+<kbd>N</kbd></dt><dd>クイック記録</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd></dt><dd>Inbox記録</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd></dt><dd>付箋メモ</dd>
          <dt>トレイ</dt><dd>今日のタスク / やったこと / 付箋メモ</dd>
          <dt>中ボタン+ドラッグ</dt><dd>Sketchの表示位置を移動</dd>
          <dt><kbd>Space</kbd>+ドラッグ</dt><dd>Sketchを一時的に移動</dd>
          <dt><kbd>Ctrl</kbd>+ホイール</dt><dd>カーソル位置を基準にSketchを拡大縮小</dd>
          <dt><kbd>Shift</kbd>+ホイール</dt><dd>Sketchを横スクロール</dd>
          <dt><kbd>Ctrl</kbd>+<kbd>K</kbd></dt><dd>検索へ移動</dd>
          <dt><kbd>Alt</kbd>+<kbd>F</kbd></dt><dd>実行中のFocus Sessionを開く</dd>
          <dt><kbd>Esc</kbd></dt><dd>パネルを閉じる（Focusは終了しない）</dd>
        </dl>
      </div>
    </div>
  );
}
