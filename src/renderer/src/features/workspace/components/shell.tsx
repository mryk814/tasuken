import { useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconKeyboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMinus,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";

import { crossNavigation, knowledgeHubTabs, routeLabel, todayHubTabs, toolNavigation } from "../../../pages/routes";
import { ROUTE_ICONS } from "../../../pages/routeIcons";
import { todayIso } from "../../../utils/dataFormat.js";
import type { KnowledgeNode as WorkspaceKnowledgeNode, OpenDrawer, Theme } from "../types";
import type { KnowledgeEdge, WorkspaceDomain } from "../domain-model/types";
import { themeColor } from "../lib/domain";
import { preloadWorkspacePage } from "../workspacePageLoaders";
import { buildKnowledgeHealth } from "../lib/knowledgeHealth";

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
}

export interface TitleBarLauncherData {
  memos: Array<{ id: string; text: string }>;
  /** いま付箋として浮いているMemo（#298 / #299）。一覧して前面へ出せる。 */
  stickyMemos: Array<{ id: string; text: string }>;
  untriagedMemoCount: number;
  todayTasks: Array<{ id: string; title: string; done: boolean }>;
  todayTaskCount: number;
  createMemo(text: string): Promise<void>;
  toggleTaskDone(taskId: string): Promise<void>;
  openMemo(memoId: string): void;
  openMemos(): void;
  /** 付箋として浮かせる。既に浮いていれば前面へ出す（重複ウィンドウを作らない）。 */
  floatMemo(memoId: string): void;
  /** すべての付箋を閉じる。Memoは削除しない。 */
  closeStickyMemos(): void;
  openTask(taskId: string): void;
  openToday(): void;
  openTodayWindow(): void;
  openScratchpad(): void;
  /** 今日のActivityを開く（#299）。 */
  openActivity(): void;
}

/**
 * 上部バーの常用ランチャー（#299）。既存のMemo・今日のTaskを別データにせず、
 * 現在の画面・編集状態を保ったままPopoverで確認・入力する。
 */
function TitleBarLauncher({ launcher }: { launcher: TitleBarLauncherData }) {
  const [openPanel, setOpenPanel] = useState<"memo" | "today" | null>(null);
  const [memoText, setMemoText] = useState("");
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openPanel) return undefined;
    const close = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpenPanel(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    addEventListener("pointerdown", close);
    addEventListener("keydown", closeOnEscape);
    return () => {
      removeEventListener("pointerdown", close);
      removeEventListener("keydown", closeOnEscape);
    };
  }, [openPanel]);

  async function submitMemo() {
    const text = memoText.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await launcher.createMemo(text);
      setMemoText("");
    } finally {
      setSaving(false);
    }
  }

  const go = (action: () => void) => {
    setOpenPanel(null);
    action();
  };

  return (
    <div className="titlebar-launcher" ref={anchorRef}>
      <div className="titlebar-launcher-anchor">
        <button
          type="button"
          className={openPanel === "memo" ? "is-active" : ""}
          aria-haspopup="dialog"
          aria-expanded={openPanel === "memo"}
          onClick={() => setOpenPanel((current) => current === "memo" ? null : "memo")}
        >
          Memo
          {launcher.untriagedMemoCount > 0 && (
            <span className="count" title={`未処理のMemo ${launcher.untriagedMemoCount}件`}>{launcher.untriagedMemoCount}</span>
          )}
        </button>
        {openPanel === "memo" && (
          <div className="titlebar-popover" role="dialog" aria-label="Memo">
            <form
              className="titlebar-popover-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMemo();
              }}
            >
              <input
                autoFocus
                value={memoText}
                onChange={(event) => setMemoText(event.target.value)}
                placeholder="新しいMemo"
                aria-label="新しいMemo"
              />
              <button type="submit" className="primary-button compact" disabled={!memoText.trim() || saving}>
                {saving ? "記録中" : "記録"}
              </button>
            </form>
            {launcher.memos.length ? (
              <ul className="titlebar-popover-list">
                {launcher.memos.map((memo) => (
                  <li key={memo.id}>
                    <button type="button" className="text-button compact" onClick={() => go(() => launcher.openMemo(memo.id))}>
                      {memo.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="titlebar-popover-empty">Memoはまだありません。</p>
            )}
            {/* 浮かせている付箋をここから再表示できるようにする（#298 / #299）。 */}
            {launcher.stickyMemos.length > 0 && (
              <>
                <div className="titlebar-popover-group">付箋 {launcher.stickyMemos.length}</div>
                <ul className="titlebar-popover-list">
                  {launcher.stickyMemos.map((memo) => (
                    <li key={memo.id}>
                      <span className="titlebar-popover-sticky-text">{memo.text}</span>
                      <button type="button" className="text-button compact" onClick={() => go(() => launcher.floatMemo(memo.id))}>表示</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="titlebar-popover-actions">
              <button type="button" className="text-button compact" onClick={() => go(launcher.openMemos)}>すべてのMemoを開く</button>
              {launcher.stickyMemos.length > 0 && (
                <button type="button" className="text-button compact" onClick={() => go(launcher.closeStickyMemos)}>付箋をすべて閉じる</button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="titlebar-launcher-anchor">
        <button
          type="button"
          className={openPanel === "today" ? "is-active" : ""}
          aria-haspopup="dialog"
          aria-expanded={openPanel === "today"}
          onClick={() => setOpenPanel((current) => current === "today" ? null : "today")}
        >
          Today
          {launcher.todayTaskCount > 0 && (
            <span className="count" title={`今日のTask ${launcher.todayTaskCount}件`}>{launcher.todayTaskCount}</span>
          )}
        </button>
        {openPanel === "today" && (
          <div className="titlebar-popover" role="dialog" aria-label="今日のTask">
            {launcher.todayTasks.length ? (
              <ul className="titlebar-popover-list">
                {launcher.todayTasks.map((task) => (
                  <li key={task.id}>
                    <label className="titlebar-popover-check">
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => void launcher.toggleTaskDone(task.id)}
                        aria-label={`${task.title}を${task.done ? "未完了に戻す" : "完了にする"}`}
                      />
                      <span className={task.done ? "is-done" : ""}>{task.title}</span>
                    </label>
                    <button type="button" className="text-button compact" onClick={() => go(() => launcher.openTask(task.id))}>開く</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="titlebar-popover-empty">今日のTaskはありません。</p>
            )}
            <div className="titlebar-popover-actions">
              <button type="button" className="text-button compact" onClick={() => go(launcher.openTodayWindow)}>別ウィンドウで表示</button>
              <button type="button" className="text-button compact" onClick={() => go(launcher.openToday)}>Today画面を開く</button>
            </div>
            {/* 日次の面はボタンを増やさず、ここへまとめる（#299）。 */}
            <div className="titlebar-popover-group">日次</div>
            <div className="titlebar-popover-actions">
              <button type="button" className="text-button compact" onClick={() => go(launcher.openScratchpad)}>Daily Scratchpad</button>
              <button type="button" className="text-button compact" onClick={() => go(launcher.openActivity)}>今日のActivity</button>
            </div>
          </div>
        )}
      </div>
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
    <header className="app-titlebar">
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
}: SidebarProps) {
  const navIconByRoute = ROUTE_ICONS;
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
  const knowledgeHealthEntities = [
    ...domain.tasks.map((task) => ({ id: task.id, status: task.state, title: task.title })),
    ...domain.waitings.map((waiting) => ({ id: waiting.id, status: waiting.state, title: waiting.title })),
    ...domain.plan_nodes.map((plan) => ({ id: plan.id, status: plan.state, title: plan.title })),
  ];
  const knowledgeHealthIssueCount = buildKnowledgeHealth(
    domain.knowledge_nodes as unknown as WorkspaceKnowledgeNode[],
    domain.knowledge_edges as unknown as KnowledgeEdge[],
    knowledgeHealthEntities,
  ).length;
  const proposalCount = domain.ai_proposals.filter((proposal) => proposal.status === "pending").length;
  const countByRoute: Record<string, number> = {
    today: todayCount,
    todo: overdueTasks,
    inbox,
    knowledge: knowledgeHealthIssueCount,
    "ai-io": proposalCount,
  };
  const renderNavButton = (id: string) => {
    const label = routeLabel(id);
    const count = countByRoute[id] || 0;
    const NavIcon = navIconByRoute[id];
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
          return (
            <button
              key={theme.id}
              className={current ? "is-active" : ""}
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
          <dt><kbd>Esc</kbd></dt><dd>パネルを閉じる</dd>
        </dl>
      </div>
    </div>
  );
}
