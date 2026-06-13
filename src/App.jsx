import { useEffect, useMemo, useRef, useState } from "react";
import {
  initialLinks,
  initialMilestones,
  initialNotes,
  initialPeople,
  initialPhases,
  initialTasks,
  initialThemes,
  initialWaiting,
} from "./data/initialData.js";
import {
  dateLabel,
  formValue,
  loadState,
  newId,
  parseSimpleYaml,
  todayIso,
  toMarkdown,
  toYaml,
} from "./utils/dataFormat.js";

const navItems = [
  ["home", "今日"],
  ["inbox", "Inbox"],
  ["timeline", "Timeline"],
  ["themes", "Themes"],
  ["notes", "Notes"],
  ["links", "Links"],
  ["waiting", "Waiting"],
  ["ai-io", "AI Import / Export"],
  ["stats", "Stats"],
  ["settings", "Settings"],
];

export function App() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || "home");
  const [themes, setThemes] = useState(() => loadState("rd-themes", initialThemes));
  const [activeTheme, setActiveTheme] = useState("material-a");
  const [tasks, setTasks] = useState(() => loadState("rd-tasks", initialTasks));
  const [waiting, setWaiting] = useState(() => loadState("rd-waiting", initialWaiting));
  const [notes, setNotes] = useState(() => loadState("rd-notes", initialNotes));
  const [links, setLinks] = useState(() => loadState("rd-links", initialLinks));
  const [people, setPeople] = useState(() => loadState("rd-people", initialPeople));
  const [phases, setPhases] = useState(() => loadState("rd-phases", initialPhases));
  const [milestones, setMilestones] = useState(() => loadState("rd-milestones", initialMilestones));
  const [importHistory, setImportHistory] = useState(() => loadState("rd-import-history", []));
  const [quickText, setQuickText] = useState("");
  const [drawer, setDrawer] = useState(null);
  const [toast, setToast] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const [timelineScale, setTimelineScale] = useState("quarter");
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem("rd-theme-mode") || "light");
  const lastDeleted = useRef(null);

  const theme = themes.find((item) => item.id === activeTheme) || themes[0];
  const themeTasks = tasks.filter((task) => task.theme === activeTheme);
  const openTasks = themeTasks.filter((task) => task.status !== "done");
  const themeWaiting = waiting.filter((item) => item.theme === activeTheme && item.status === "waiting");
  const themeNotes = notes.filter((note) => note.theme === activeTheme);

  useEffect(() => {
    const onHash = () => setRoute(location.hash.slice(1) || "home");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => localStorage.setItem("rd-tasks", JSON.stringify(tasks)), [tasks]);
  useEffect(() => localStorage.setItem("rd-themes", JSON.stringify(themes)), [themes]);
  useEffect(() => localStorage.setItem("rd-waiting", JSON.stringify(waiting)), [waiting]);
  useEffect(() => localStorage.setItem("rd-notes", JSON.stringify(notes)), [notes]);
  useEffect(() => localStorage.setItem("rd-links", JSON.stringify(links)), [links]);
  useEffect(() => localStorage.setItem("rd-people", JSON.stringify(people)), [people]);
  useEffect(() => localStorage.setItem("rd-phases", JSON.stringify(phases)), [phases]);
  useEffect(() => localStorage.setItem("rd-milestones", JSON.stringify(milestones)), [milestones]);
  useEffect(() => localStorage.setItem("rd-import-history", JSON.stringify(importHistory)), [importHistory]);
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("rd-theme-mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  function navigate(next) {
    location.hash = next;
    setRoute(next);
  }

  function addQuickCapture() {
    const title = quickText.trim();
    if (!title) {
      setToast("入力が空です。記録する内容を入力してください。");
      return;
    }
    setTasks((current) => [
      { id: newId(), theme: activeTheme, title, due: todayIso(), status: "inbox", kind: "inbox", priority: "normal", description: "" },
      ...current,
    ]);
    setQuickText("");
    setToast("Inboxに記録しました。");
  }

  function toggleTask(id) {
    setTasks((current) =>
      current.map((task) => task.id === id ? { ...task, status: task.status === "done" ? "todo" : "done" } : task),
    );
    setToast("タスクを更新しました。");
  }

  function deleteTask(id) {
    const target = tasks.find((task) => task.id === id);
    if (!target) return;
    lastDeleted.current = target;
    setTasks((current) => current.filter((task) => task.id !== id));
    setDrawer(null);
    setToast("タスクを削除しました。元に戻せます。");
  }

  function undoDelete() {
    if (!lastDeleted.current) return;
    setTasks((current) => [lastDeleted.current, ...current]);
    lastDeleted.current = null;
    setToast("削除を元に戻しました。");
  }

  function saveEntity(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const type = formValue(data, "entityType");
    const rawId = formValue(data, "id");
    const id = type === "theme" ? rawId || `${newId()}` : Number(rawId) || newId();
    const isEdit = Boolean(rawId);
    const upsert = (setter, entity) => setter((current) => isEdit
      ? current.map((entry) => entry.id === id ? entity : entry)
      : [entity, ...current]);

    if (type === "task") {
      const title = formValue(data, "title");
      if (!title) return setToast("タイトルを入力してください。入力内容は保持されています。");
      upsert(setTasks, {
        id,
        theme: formValue(data, "theme", activeTheme),
        title,
        due: formValue(data, "due", todayIso()),
        status: formValue(data, "status", "todo"),
        kind: formValue(data, "kind", "task"),
        priority: formValue(data, "priority", "normal"),
        description: formValue(data, "description"),
      });
    }
    if (type === "theme") {
      const name = formValue(data, "name");
      if (!name) return setToast("テーマ名を入力してください。");
      const slug = isEdit ? String(drawer.item.id) : `${name.toLowerCase().replace(/\s+/g, "-")}-${id}`;
      upsert(setThemes, { id: slug, name, subtitle: formValue(data, "subtitle"), status: formValue(data, "status", "計画中") });
      if (!isEdit) setActiveTheme(slug);
    }
    if (type === "note") {
      const title = formValue(data, "title");
      const body = formValue(data, "body");
      if (!title || !body) return setToast("タイトルと本文を入力してください。");
      upsert(setNotes, { id, theme: formValue(data, "theme", activeTheme), title, type: formValue(data, "noteType", "メモ"), body, updated: new Date().toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) });
    }
    if (type === "waiting") {
      const title = formValue(data, "title");
      if (!title) return setToast("待っている内容のタイトルを入力してください。");
      upsert(setWaiting, {
        id, theme: formValue(data, "theme", activeTheme), title,
        waitingFor: formValue(data, "waitingFor"), owner: formValue(data, "owner"),
        due: formValue(data, "due", todayIso()), note: formValue(data, "note"),
        next: formValue(data, "next"), status: formValue(data, "status", "waiting"),
      });
    }
    if (type === "link") {
      const title = formValue(data, "title");
      const url = formValue(data, "url");
      if (!title || !url) return setToast("リンク名とURLを入力してください。");
      upsert(setLinks, { id, theme: formValue(data, "theme", activeTheme), title, url, type: formValue(data, "linkType", "other"), description: formValue(data, "description") });
    }
    if (type === "person") {
      const name = formValue(data, "name");
      if (!name) return setToast("名前を入力してください。");
      upsert(setPeople, { id, name, role: formValue(data, "role"), organization: formValue(data, "organization"), note: formValue(data, "note") });
    }
    if (type === "phase") {
      const label = formValue(data, "label");
      const start = formValue(data, "start");
      const end = formValue(data, "end");
      if (!label || !start || !end || end < start) return setToast("名称と正しい開始日・終了日を入力してください。");
      upsert(setPhases, { id, theme: formValue(data, "theme", activeTheme), label, start, end, lane: "plan", tone: formValue(data, "tone", "accent") });
    }
    if (type === "milestone") {
      const label = formValue(data, "label");
      const date = formValue(data, "date");
      if (!label || !date) return setToast("節目の名称と日付を入力してください。");
      upsert(setMilestones, { id, theme: formValue(data, "theme", activeTheme), label, date });
    }
    setDrawer(null);
    setToast(isEdit ? "変更を保存しました。" : "追加しました。");
  }

  function deleteEntity(type, id) {
    const setters = { task: setTasks, note: setNotes, waiting: setWaiting, link: setLinks, person: setPeople, phase: setPhases, milestone: setMilestones };
    setters[type]?.((current) => current.filter((item) => item.id !== id));
    setDrawer(null);
    setToast("削除しました。");
  }

  function completeWaiting(id) {
    setWaiting((current) => current.map((item) => item.id === id ? { ...item, status: "done" } : item));
    setDrawer(null);
    setToast("待ち項目を完了済みにしました。履歴には残ります。");
  }

  const page = {
    home: <HomePage {...{ theme, openTasks, themeWaiting, themeNotes, tasks, taskFilter, setTaskFilter, toggleTask, setDrawer, navigate }} />,
    timeline: <TimelinePage {...{ themes, phases, milestones, waiting, timelineScale, setTimelineScale, setDrawer }} />,
    inbox: <InboxPage tasks={tasks} setDrawer={setDrawer} setTasks={setTasks} setToast={setToast} />,
    themes: <ThemesPage themes={themes} tasks={tasks} waiting={waiting} setActiveTheme={setActiveTheme} navigate={navigate} setDrawer={setDrawer} />,
    notes: <NotesPage notes={notes} activeTheme={activeTheme} themes={themes} setDrawer={setDrawer} />,
    links: <LinksPage links={links} themes={themes} setDrawer={setDrawer} setToast={setToast} />,
    waiting: <WaitingPage waiting={waiting} setDrawer={setDrawer} />,
    "ai-io": <AiIoPage {...{ themes, tasks, waiting, notes, links, people, phases, milestones, setTasks, setWaiting, setNotes, setLinks, setImportHistory, importHistory, setToast }} />,
    stats: <StatsPage themes={themes} tasks={tasks} waiting={waiting} />,
    settings: <SettingsPage {...{ themeMode, setThemeMode, setToast, people, setDrawer, themes, tasks, waiting, notes, links, phases, milestones }} />,
  }[route] || null;

  return (
    <div className={`app-shell ${drawer ? "has-drawer" : ""}`}>
      <Sidebar
        route={route}
        navigate={navigate}
        themes={themes}
        activeTheme={activeTheme}
        setActiveTheme={setActiveTheme}
        quickText={quickText}
        setQuickText={setQuickText}
        addQuickCapture={addQuickCapture}
        setDrawer={setDrawer}
        inboxCount={tasks.filter((task) => task.kind === "inbox" && task.status !== "done").length}
        waitingCount={waiting.filter((item) => item.status === "waiting").length}
      />
      <main className="main-area">{page}</main>
      {drawer && (
        <Drawer
          drawer={drawer}
          close={(next) => setDrawer(next || null)}
          saveEntity={saveEntity}
          deleteTask={deleteTask}
          deleteEntity={deleteEntity}
          completeWaiting={completeWaiting}
          toggleTask={toggleTask}
        />
      )}
      <button className="mobile-capture" onClick={() => setDrawer({ type: "add-task" })}>項目を追加</button>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
          {lastDeleted.current && <button onClick={undoDelete}>元に戻す</button>}
          <button aria-label="通知を閉じる" onClick={() => setToast("")}>閉じる</button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ route, navigate, themes, activeTheme, setActiveTheme, quickText, setQuickText, addQuickCapture, setDrawer, inboxCount, waitingCount }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">RD</span>
        <div><strong>Research Desk</strong><small>思いつきを、研究の前進に。</small></div>
      </div>
      <nav className="primary-nav" aria-label="メインナビゲーション">
        {navItems.slice(0, 4).map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
            {id === "inbox" && inboxCount > 0 && <span className="count">{inboxCount}</span>}
          </button>
        ))}
      </nav>
      <div className="theme-nav">
        <div className="nav-heading"><span>テーマ一覧</span><button aria-label="テーマを追加" onClick={() => setDrawer({ type: "theme-form" })}>追加</button></div>
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={activeTheme === theme.id ? "is-active" : ""}
            onClick={() => { setActiveTheme(theme.id); navigate("home"); }}
          >
            <span className="theme-dot" aria-hidden="true" />
            <span>{theme.name}</span>
          </button>
        ))}
      </div>
      <nav className="primary-nav secondary-nav" aria-label="資料と設定">
        {navItems.slice(4).map(([id, label]) => (
          <button key={id} className={route === id ? "is-active" : ""} aria-current={route === id ? "page" : undefined} onClick={() => navigate(id)}>
            <span>{label}</span>
            {id === "waiting" && waitingCount > 0 && <span className="count">{waitingCount}</span>}
          </button>
        ))}
      </nav>
      <div className="quick-capture">
        <div className="quick-title"><strong>Quick Capture</strong></div>
        <textarea value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder="アイデア・メモ・タスクをすばやく記録…" />
        <button className="primary-button" onClick={addQuickCapture}>Inboxに記録</button>
      </div>
      <div className="profile"><span className="avatar">山</span><div><strong>山田 太郎</strong><small>R&amp;D 材料グループ</small></div></div>
    </aside>
  );
}

function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      <div className="header-actions">{children}</div>
    </header>
  );
}

function HomePage({ theme, openTasks, themeWaiting, themeNotes, taskFilter, setTaskFilter, toggleTask, setDrawer, navigate }) {
  const visibleTasks = openTasks.filter((task) => taskFilter === "all" || (taskFilter === "waiting" ? false : task.priority === taskFilter));
  const waitingItem = themeWaiting[0];
  return (
    <div className="page home-page">
      <PageHeader title={theme.name} subtitle={theme.subtitle}>
        <span className="status-badge success">{theme.status}</span>
        <button className="secondary-button" onClick={() => setDrawer({ type: "theme-form", item: theme })}>テーマ設定</button>
        <button className="primary-button" onClick={() => setDrawer({ type: "add-task" })}>項目を追加</button>
      </PageHeader>

      <section className="panel summary-panel">
        <div className="section-heading"><h2>現在地サマリー</h2><span>最終更新: 2026/06/13 09:25</span></div>
        <div className="summary-grid">
          <button className="summary-card focus" onClick={() => setDrawer({ type: "task", item: openTasks[0] })}>
            <span className="eyebrow">今週のフォーカス</span><strong>測定結果の受領と確認</strong><small>期限 6月20日 (金)</small>
          </button>
          <button className="summary-card" onClick={() => navigate("timeline")}>
            <span className="eyebrow">次の節目</span><strong>中間報告</strong><span className="metric-value">2026/07/01</span><small>あと 18日</small>
          </button>
          <button className="summary-card warning" onClick={() => waitingItem && setDrawer({ type: "waiting", item: waitingItem })}>
            <span className="eyebrow">待ち</span><strong>{waitingItem?.title || "待ち項目なし"}</strong><small>{waitingItem ? "期限 6月20日 (金)" : "依頼待ちはありません"}</small>
          </button>
          <button className="summary-card danger" onClick={() => setTaskFilter("decision")}>
            <span className="eyebrow">リスク</span><strong>解析方針が未確定</strong><small>要判断</small>
          </button>
        </div>
      </section>

      <section className="panel mini-timeline">
        <div className="section-heading"><h2>中長期の見通し（{theme.name}）</h2><button className="text-button" onClick={() => navigate("timeline")}>長期ガントを開く</button></div>
        <MiniGantt waitingItem={waitingItem} />
      </section>

      <div className="dashboard-grid">
        <section className="panel task-panel">
          <div className="section-heading"><h2>次にやること</h2><button className="secondary-button compact" onClick={() => setDrawer({ type: "add-task" })}>追加</button></div>
          <div className="tabs" role="tablist">
            {[["all", "すべて"], ["normal", "タスク"], ["waiting", "待ち"], ["decision", "レビュー"]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={taskFilter === id} onClick={() => setTaskFilter(id)}>{label}</button>
            ))}
          </div>
          <div className="task-list">
            {visibleTasks.length ? visibleTasks.slice(0, 6).map((task) => (
              <div className="task-row" key={task.id}>
                <button className="check-button" aria-label={`${task.title}を完了にする`} onClick={() => toggleTask(task.id)} />
                <button className="task-title" onClick={() => setDrawer({ type: "task", item: task })}>{task.title}</button>
                {task.priority === "decision" && <span className="status-badge danger">要判断</span>}
                <time>{dateLabel(task.due)}</time>
              </div>
            )) : <EmptyState title="該当するタスクはありません" action="フィルタを戻す" onAction={() => setTaskFilter("all")} />}
          </div>
        </section>

        <section className="panel notes-panel">
          <div className="section-heading"><h2>最近のメモ</h2><button className="text-button" onClick={() => navigate("notes")}>すべてのメモ</button></div>
          <div className="note-list">
            {themeNotes.slice(0, 3).map((note) => (
              <button className="note-card" key={note.id} onClick={() => setDrawer({ type: "note", item: note })}>
                <span><strong>{note.title}</strong><span className="status-badge neutral">{note.type}</span></span>
                <small>{note.updated}</small>
                <p>{note.body}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel artifacts">
        <div className="section-heading"><h2>関連アーティファクト</h2><button className="text-button" onClick={() => navigate("links")}>すべてのリンク</button></div>
        <div className="artifact-grid">
          {["測定計画書_v1.2.pdf", "データ一覧_20260610.xlsx", "スライド_中間報告_骨子.pptx"].map((name, index) => (
            <button key={name} onClick={() => setDrawer({ type: "artifact", item: { title: name, updated: `06/${5 + index * 3}` } })}><strong>{name}</strong><small>更新 06/{5 + index * 3}</small></button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MiniGantt({ waitingItem }) {
  return (
    <div className="mini-gantt-grid" aria-label="材料A評価の2026年6月から9月までの予定">
      <div className="gantt-corner" />
      {["2026年 6月", "7月", "8月", "9月"].map((month) => <div className="month-head" key={month}>{month}</div>)}
      <div className="lane-label">計画（予定）</div>
      <div className="mini-track plan-track"><GridLines count={4} /><span className="bar blue" style={{ "--start": 1, "--span": 22 }}>測定・評価</span><span className="bar accent" style={{ "--start": 23, "--span": 32 }}>解析・考察</span><span className="bar neutral" style={{ "--start": 56, "--span": 26 }}>条件検討・追加実験</span><span className="bar rose" style={{ "--start": 83, "--span": 18 }}>まとめ・報告</span></div>
      <div className="lane-label">ベースライン</div>
      <div className="mini-track baseline"><span /><span /><span /><span /></div>
      <div className="lane-label">節目・報告</div>
      <div className="mini-track milestones"><GridLines count={4} /><span style={{ "--at": 15 }}>◆ 条件B追加測定<br />06/20</span><span style={{ "--at": 30 }}>◆ 中間報告<br />07/01</span><span style={{ "--at": 64 }}>◆ 解析方針決定<br />08/05</span><span style={{ "--at": 90 }}>◆ 最終報告<br />09/15</span></div>
      <div className="lane-label">待ち（外部依存）</div>
      <div className="mini-track waiting-track"><GridLines count={4} /><span style={{ "--start": 2, "--span": 27 }}>{waitingItem?.title || "待ち項目なし"}（〜06/20）</span><span style={{ "--start": 37, "--span": 27 }}>試作チーム試作（〜07/15）</span></div>
      <div className="today-line"><span>今日</span></div>
    </div>
  );
}

function GridLines({ count }) {
  return <div className="grid-lines" aria-hidden="true">{Array.from({ length: count - 1 }, (_, index) => <i key={index} style={{ left: `${((index + 1) / count) * 100}%` }} />)}</div>;
}

function TimelinePage({ themes, phases, milestones, waiting, timelineScale, setTimelineScale, setDrawer }) {
  const [showBaseline, setShowBaseline] = useState(true);
  const [showWaiting, setShowWaiting] = useState(true);
  const [timelineTheme, setTimelineTheme] = useState("all");
  const visibleThemes = timelineTheme === "all" ? themes : themes.filter((theme) => theme.id === timelineTheme);
  return (
    <div className="page timeline-page">
      <PageHeader title="長期ガント" subtitle="テーマ横断で、計画・節目・外部依存を見渡します。">
        <button className="secondary-button" onClick={() => setShowBaseline((value) => !value)}>{showBaseline ? "基準線を隠す" : "基準線を表示"}</button>
        <button className="secondary-button" onClick={() => setDrawer({ type: "milestone-form" })}>節目を追加</button>
        <button className="primary-button" onClick={() => setDrawer({ type: "phase-form" })}>計画を追加</button>
      </PageHeader>
      <section className="timeline-toolbar panel">
        <label>テーマ
          <select value={timelineTheme} onChange={(event) => setTimelineTheme(event.target.value)}>
            <option value="all">すべてのテーマ</option>
            {themes.map((theme) => <option value={theme.id} key={theme.id}>{theme.name}</option>)}
          </select>
        </label>
        <div className="segmented" aria-label="表示期間">
          {[["year", "年"], ["half", "半年"], ["quarter", "四半期"], ["month", "月"], ["week", "週"]].map(([id, label]) => (
            <button key={id} className={timelineScale === id ? "is-active" : ""} onClick={() => setTimelineScale(id)}>{label}</button>
          ))}
        </div>
        <label className="toggle"><input type="checkbox" checked={showWaiting} onChange={(event) => setShowWaiting(event.target.checked)} />待ちを表示</label>
        <button className="secondary-button compact" onClick={() => document.getElementById("long-gantt")?.scrollTo({ left: 0, behavior: "smooth" })}>今日へ移動</button>
      </section>
      <section id="long-gantt" className={`panel full-gantt scale-${timelineScale}`}>
        <div className="full-gantt-header">
          <div className="theme-column">テーマ / レーン</div>
          <div className="time-axis">{["6月", "7月", "8月", "9月", "10月", "11月"].map((month) => <span key={month}>{month}</span>)}</div>
        </div>
        {visibleThemes.map((theme) => (
          <div className="theme-gantt" key={theme.id}>
            <div className="theme-gantt-title"><strong>{theme.name}</strong><span className="status-badge neutral">{theme.status}</span></div>
            <GanttLane label="計画" items={phases.filter((item) => item.theme === theme.id)} setDrawer={setDrawer} />
            {showBaseline && <GanttLane label="ベースライン" baseline />}
            <GanttLane label="節目" milestones={milestones.filter((item) => item.theme === theme.id)} setDrawer={setDrawer} />
            {showWaiting && <GanttLane label="待ち" waiting={waiting.filter((item) => item.theme === theme.id && item.status === "waiting")} setDrawer={setDrawer} />}
          </div>
        ))}
        <div className="full-today"><span>6/13 今日</span></div>
      </section>
      <div className="timeline-legend">
        <span><i className="legend-solid" />計画</span><span><i className="legend-hatch" />ベースライン</span><span>◆ 節目</span><span><i className="legend-wait" />待ち</span>
      </div>
    </div>
  );
}

function timelinePosition(date) {
  const start = new Date("2026-06-01T00:00:00").getTime();
  const end = new Date("2026-12-01T00:00:00").getTime();
  return ((new Date(`${date}T00:00:00`).getTime() - start) / (end - start)) * 100;
}

function GanttLane({ label, items = [], milestones: marks = [], waiting: waits = [], baseline = false, setDrawer }) {
  return (
    <div className="full-lane">
      <div className="lane-name">{label}</div>
      <div className="full-track">
        <GridLines count={6} />
        {baseline && <div className="baseline-bar" />}
        {items.map((item) => {
          const left = timelinePosition(item.start);
          const width = Math.max(5, timelinePosition(item.end) - left);
          return <button className={`phase-bar ${item.tone}`} style={{ left: `${left}%`, width: `${width}%` }} key={item.id} onClick={() => setDrawer?.({ type: "phase", item })}>{item.label}</button>;
        })}
        {marks.map((mark) => <button className="milestone-mark" style={{ left: `${timelinePosition(mark.date)}%` }} key={mark.id} onClick={() => setDrawer?.({ type: "milestone", item: mark })}><span>◆</span><small>{mark.label}</small></button>)}
        {waits.map((item, index) => <button className="wait-bar" style={{ left: `${Math.max(0, timelinePosition("2026-06-13") + index * 18)}%`, width: "17%" }} key={item.id} onClick={() => setDrawer?.({ type: "waiting", item })}>{item.title}</button>)}
      </div>
    </div>
  );
}

function InboxPage({ tasks, setDrawer, setTasks, setToast }) {
  const inbox = tasks.filter((task) => task.kind === "inbox");
  function copyInbox() {
    const text = ["タイトル\t期限\t状態", ...inbox.map((item) => `${item.title}\t${item.due}\t${item.status}`)].join("\n");
    navigator.clipboard.writeText(text).then(() => setToast("Inboxをコピーしました。"));
  }
  return (
    <div className="page">
      <PageHeader title="Inbox" subtitle="未整理の記録を、次の行動へ振り分けます。"><button className="primary-button" onClick={() => setDrawer({ type: "add-task" })}>記録する</button></PageHeader>
      <section className="panel list-page">
        <div className="section-heading"><h2>未整理</h2><div className="inline-actions"><span>{inbox.length}件</span><button className="text-button compact" onClick={copyInbox} disabled={!inbox.length}>一覧をコピー</button></div></div>
        {inbox.length ? inbox.map((item) => (
          <div className="wide-row inbox-row" key={item.id}>
            <button className="row-main" onClick={() => setDrawer({ type: "task", item })}><strong>{item.title}</strong><span>{dateLabel(item.due)}</span></button>
            <button className="secondary-button compact" onClick={() => {
              setTasks((current) => current.map((task) => task.id === item.id ? { ...task, kind: "task", status: "todo" } : task));
              setToast("タスクとして整理しました。");
            }}>タスクにする</button>
          </div>
        )) : <EmptyState title="Inboxは空です" action="新しく記録する" onAction={() => setDrawer({ type: "add-task" })} />}
      </section>
    </div>
  );
}

function ThemesPage({ themes, tasks, waiting, setActiveTheme, navigate, setDrawer }) {
  return (
    <div className="page">
      <PageHeader title="Themes" subtitle="研究テーマごとの現在地と負荷を確認します。"><button className="primary-button" onClick={() => setDrawer({ type: "theme-form" })}>テーマを追加</button></PageHeader>
      <div className="theme-card-grid">
        {themes.map((theme) => {
          const open = tasks.filter((task) => task.theme === theme.id && task.status !== "done").length;
          const waits = waiting.filter((item) => item.theme === theme.id && item.status === "waiting").length;
          return <button className="panel theme-card" key={theme.id} onClick={() => { setActiveTheme(theme.id); navigate("home"); }}><span className="status-badge success">{theme.status}</span><h2>{theme.name}</h2><p>{theme.subtitle}</p><div><span><strong className="metric-value">{open}</strong> 未完了</span><span><strong className="metric-value">{waits}</strong> 待ち</span></div></button>;
        })}
      </div>
    </div>
  );
}

function NotesPage({ notes, activeTheme, themes, setDrawer }) {
  const [query, setQuery] = useState("");
  const normalized = query.toLowerCase();
  const filtered = notes.filter((note) => (activeTheme === "all" || note.theme === activeTheme) && `${note.title} ${note.body}`.toLowerCase().includes(normalized));
  return (
    <div className="page">
      <PageHeader title="Notes" subtitle="研究メモ、会議記録、構成案を横断して探します。"><button className="primary-button" onClick={() => setDrawer({ type: "note-form" })}>メモを書く</button></PageHeader>
      <section className="panel filter-bar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="メモを検索" /><span>{themes.find((theme) => theme.id === activeTheme)?.name || "すべてのテーマ"}</span></section>
      <div className="notes-grid">{filtered.map((note) => <button className="panel note-tile" key={note.id} onClick={() => setDrawer({ type: "note", item: note })}><span className="status-badge neutral">{note.type}</span><h2>{note.title}</h2><p>{note.body}</p><small>{note.updated}</small></button>)}</div>
    </div>
  );
}

function WaitingPage({ waiting, setDrawer }) {
  const active = waiting.filter((item) => item.status === "waiting");
  return (
    <div className="page">
      <PageHeader title="Waiting" subtitle="外部依存と返答待ちを、期限つきで追跡します。"><button className="primary-button" onClick={() => setDrawer({ type: "waiting-form" })}>待ちを追加</button></PageHeader>
      <section className="panel list-page">
        <div className="section-heading"><h2>待っているもの</h2><span>{active.length}件</span></div>
        {active.map((item) => <button className="waiting-row" key={item.id} onClick={() => setDrawer({ type: "waiting", item })}><div><span className="status-badge warning">待ち</span><strong>{item.title}</strong><small>{item.owner}</small></div><div><span>{dateLabel(item.due)}</span><small>{item.waitingFor}</small></div></button>)}
      </section>
    </div>
  );
}

function LinksPage({ links, themes, setDrawer, setToast }) {
  const [query, setQuery] = useState("");
  const filtered = links.filter((link) => `${link.title} ${link.description} ${link.url}`.toLowerCase().includes(query.toLowerCase()));
  function copyLinks() {
    const text = ["タイトル\t種類\tテーマ\tURL", ...filtered.map((link) => `${link.title}\t${link.type}\t${themes.find((theme) => theme.id === link.theme)?.name || "未分類"}\t${link.url}`)].join("\n");
    navigator.clipboard.writeText(text).then(() => setToast("リンク一覧をコピーしました。"));
  }
  return (
    <div className="page">
      <PageHeader title="Links" subtitle="成果物、資料、会話、フォルダへの入口をまとめます。">
        <button className="primary-button" onClick={() => setDrawer({ type: "link-form" })}>リンクを追加</button>
      </PageHeader>
      <section className="panel filter-bar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル、説明、URLを検索" />
        <button className="secondary-button compact" onClick={copyLinks} disabled={!filtered.length}>一覧をコピー</button>
      </section>
      <section className="panel list-page">
        {filtered.length ? filtered.map((link) => (
          <div className="wide-row link-row" key={link.id}>
            <button className="row-main" onClick={() => setDrawer({ type: "link", item: link })}>
              <strong>{link.title}</strong><span>{link.type} / {themes.find((theme) => theme.id === link.theme)?.name || "未分類"}</span>
            </button>
            <button className="secondary-button compact" onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}>開く</button>
          </div>
        )) : <EmptyState title="該当するリンクはありません" action="リンクを追加" onAction={() => setDrawer({ type: "link-form" })} />}
      </section>
    </div>
  );
}

function AiIoPage({ themes, tasks, waiting, notes, links, people, phases, milestones, setTasks, setWaiting, setNotes, setLinks, setImportHistory, importHistory, setToast }) {
  const [format, setFormat] = useState("json");
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState(null);
  const exportData = useMemo(() => ({ themes, tasks, waiting, notes, links, people, phases, milestones }), [themes, tasks, waiting, notes, links, people, phases, milestones]);
  const exported = format === "json" ? JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...exportData }, null, 2) : format === "yaml" ? toYaml(exportData) : toMarkdown(exportData);
  function previewImport() {
    try {
      const parsed = value.trim().startsWith("{") ? JSON.parse(value) : parseSimpleYaml(value);
      const normalized = {
        tasks: Array.isArray(parsed.tasks || parsed.items) ? (parsed.tasks || parsed.items) : [],
        waiting: Array.isArray(parsed.waiting) ? parsed.waiting : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        links: Array.isArray(parsed.links) ? parsed.links : [],
      };
      if (!Object.values(normalized).some((items) => items.length)) throw new Error("items/tasks、waiting、notes、links の配列が見つかりません");
      setPreview(normalized);
      setToast("取り込み候補を確認できます。まだ保存されていません。");
    } catch (error) {
      setToast(`読み込めませんでした。形式を確認してください: ${error.message}`);
    }
  }
  function executeImport() {
    if (!preview) return;
    const themeId = (entry) => {
      const name = entry.theme;
      return themes.find((theme) => theme.id === name || theme.name === name)?.id || themes[0]?.id;
    };
    setTasks((current) => [...preview.tasks.map((item) => ({ id: newId(), theme: themeId(item), title: item.title || "無題", due: item.due || item.due_date || item.planned_end || todayIso(), status: item.status || "todo", kind: item.kind || "task", priority: item.priority || "normal", description: item.description || "" })), ...current]);
    setWaiting((current) => [...preview.waiting.map((item) => ({ id: newId(), theme: themeId(item), title: item.title || "無題", waitingFor: item.waitingFor || item.waiting_for || "", owner: item.owner || item.waiting_for_person || "", due: item.due || item.planned_end || todayIso(), note: item.note || item.description || "", next: item.next || "", status: "waiting" })), ...current]);
    setNotes((current) => [...preview.notes.map((item) => ({ id: newId(), theme: themeId(item), title: item.title || "無題", type: item.type || item.note_type || "メモ", body: item.body || item.body_markdown || "", updated: "今" })), ...current]);
    setLinks((current) => [...preview.links.map((item) => ({ id: newId(), theme: themeId(item), title: item.title || "無題", url: item.url || "", type: item.type || item.link_type || "other", description: item.description || "" })), ...current]);
    const count = Object.values(preview).reduce((sum, items) => sum + items.length, 0);
    setImportHistory((current) => [{ id: newId(), createdAt: new Date().toISOString(), count, status: "completed" }, ...current].slice(0, 20));
    setPreview(null);
    setValue("");
    setToast(`${count}件を取り込みました。`);
  }
  return (
    <div className="page">
      <PageHeader title="AI Import / Export" subtitle="構造化データを使って、AIとの整理・レビューを往復します。" />
      <div className="io-grid">
        <section className="panel io-panel"><div className="section-heading"><h2>書き出す</h2><select value={format} onChange={(event) => setFormat(event.target.value)}><option value="json">JSON</option><option value="yaml">YAML</option><option value="markdown">Markdown</option></select></div><textarea readOnly value={exported} /><button className="primary-button" onClick={() => navigator.clipboard?.writeText(exported).then(() => setToast(`${format.toUpperCase()}をコピーしました。`))}>クリップボードにコピー</button></section>
        <section className="panel io-panel"><div className="section-heading"><h2>読み込む</h2><span>JSON / YAML</span></div><textarea value={value} onChange={(event) => { setValue(event.target.value); setPreview(null); }} placeholder={'items:\n  - kind: task\n    title: "解析結果を確認"\n    theme: "材料A評価"'} /><button className="secondary-button" onClick={previewImport}>候補を確認</button></section>
      </div>
      {preview && <section className="panel import-preview">
        <div className="section-heading"><h2>取り込み候補</h2><span>{Object.values(preview).reduce((sum, items) => sum + items.length, 0)}件</span></div>
        {Object.entries(preview).map(([kind, items]) => items.length > 0 && <div className="preview-group" key={kind}><strong>{kind}</strong>{items.map((item, index) => <span key={`${kind}-${index}`}>{item.title || "無題"}</span>)}</div>)}
        <div className="form-actions"><button className="secondary-button" onClick={() => setPreview(null)}>戻る</button><button className="primary-button" onClick={executeImport}>候補を取り込む</button></div>
      </section>}
      {importHistory.length > 0 && <section className="panel import-history"><div className="section-heading"><h2>取り込み履歴</h2><span>{importHistory.length}件</span></div>{importHistory.slice(0, 5).map((batch) => <div className="wide-row" key={batch.id}><strong>{new Date(batch.createdAt).toLocaleString("ja-JP")}</strong><span>{batch.count}件 / 完了</span></div>)}</section>}
    </div>
  );
}

function StatsPage({ themes, tasks, waiting }) {
  return (
    <div className="page">
      <PageHeader title="Stats" subtitle="テーマ別の仕事量と滞留を確認します。" />
      <div className="metric-grid">
        <div className="metric-card panel"><span>未完了タスク</span><strong className="metric-value">{tasks.filter((item) => item.status !== "done").length}</strong></div>
        <div className="metric-card panel"><span>完了タスク</span><strong className="metric-value">{tasks.filter((item) => item.status === "done").length}</strong></div>
        <div className="metric-card panel"><span>待ち</span><strong className="metric-value">{waiting.filter((item) => item.status === "waiting").length}</strong></div>
        <div className="metric-card panel"><span>進行テーマ</span><strong className="metric-value">{themes.length}</strong></div>
      </div>
      <section className="panel stats-table"><div className="section-heading"><h2>テーマ別</h2><span>2026年6月</span></div>{themes.map((theme) => { const count = tasks.filter((item) => item.theme === theme.id && item.status !== "done").length; return <div className="stats-row" key={theme.id}><strong>{theme.name}</strong><div className="progress"><span style={{ width: `${Math.min(100, count * 15)}%` }} /></div><span className="num">{count}件</span></div>; })}</section>
    </div>
  );
}

function SettingsPage({ themeMode, setThemeMode, setToast, people, setDrawer, themes, tasks, waiting, notes, links, phases, milestones }) {
  const [dataState, setDataState] = useState("success");
  function retryPreview() {
    setDataState("loading");
    setTimeout(() => setDataState("success"), 500);
  }
  function downloadBackup() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), themes, tasks, waiting, notes, links, people, phases, milestones }, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `research-desk_backup_${todayIso().replaceAll("-", "")}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    setToast("バックアップを書き出しました。");
  }
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="表示とデータ状態を調整します。"><button className="primary-button" onClick={() => setToast("設定を保存しました。")}>保存する</button></PageHeader>
      <section className="panel settings-form">
        <h2>表示</h2>
        <label>カラーモード<select value={themeMode} onChange={(event) => setThemeMode(event.target.value)}><option value="light">ライト</option><option value="dark">ダーク</option></select></label>
        <h2>関係者</h2>
        <div className="settings-list">{people.map((person) => <button className="wide-row" key={person.id} onClick={() => setDrawer({ type: "person", item: person })}><strong>{person.name}</strong><span>{person.organization} / {person.role}</span></button>)}</div>
        <button className="secondary-button" onClick={() => setDrawer({ type: "person-form" })}>関係者を追加</button>
        <h2>バックアップ</h2>
        <p className="field-help">すべてのローカルデータをJSONファイルに保存します。</p>
        <button className="secondary-button" onClick={downloadBackup}>バックアップを書き出す</button>
        <h2>状態プレビュー</h2>
        <div className="segmented">{["loading", "empty", "error", "success"].map((state) => <button className={dataState === state ? "is-active" : ""} key={state} onClick={() => setDataState(state)}>{state}</button>)}</div>
        <StatePreview state={dataState} onRetry={retryPreview} />
      </section>
    </div>
  );
}

function StatePreview({ state, onRetry }) {
  if (state === "loading") return <div className="state-box loading" role="status"><span className="spinner" />データを読み込んでいます…</div>;
  if (state === "empty") return <div className="state-box"><strong>データがありません</strong><span>最初の項目を追加してください。</span></div>;
  if (state === "error") return <div className="state-box error" role="alert"><strong>データを読み込めませんでした</strong><span>接続を確認して、もう一度試してください。</span><button className="secondary-button compact" onClick={onRetry}>再試行する</button></div>;
  return <div className="state-box success"><strong>同期済みです</strong><span>2026/06/13 09:25 に保存しました。</span></div>;
}

function Drawer({ drawer, close, saveEntity, deleteTask, deleteEntity, completeWaiting, toggleTask }) {
  const item = drawer.item;
  const formType = drawer.type === "add-task" ? "task" : drawer.type.replace("-form", "");
  const formItem = item || {};
  const themes = loadState("rd-themes", initialThemes);
  const formTitle = {
    task: item ? "項目を編集" : "項目を追加",
    theme: item ? "テーマを編集" : "テーマを追加",
    note: item ? "メモを編集" : "メモを書く",
    waiting: item ? "待ちを編集" : "待ちを追加",
    link: item ? "リンクを編集" : "リンクを追加",
    person: item ? "関係者を編集" : "関係者を追加",
    phase: item ? "計画を編集" : "計画を追加",
    milestone: item ? "節目を編集" : "節目を追加",
  }[formType];
  const themeField = (defaultValue) => <label>テーマ<select name="theme" defaultValue={defaultValue || themes[0]?.id}>{themes.map((theme) => <option value={theme.id} key={theme.id}>{theme.name}</option>)}</select></label>;
  const hidden = <><input type="hidden" name="entityType" value={formType} />{formItem.id && <input type="hidden" name="id" value={formItem.id} />}</>;
  const edit = (type) => ({ type: `${type}-form`, item });
  return (
    <aside className="drawer" aria-label="詳細パネル">
      <div className="drawer-header"><strong>{formTitle || (drawer.type === "waiting" ? "待ちの詳細" : drawer.type === "note" ? "メモの詳細" : "詳細")}</strong><button onClick={close}>閉じる</button></div>
      {(drawer.type === "add-task" || drawer.type === "task-form") && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>タイトル<input name="title" autoFocus defaultValue={formItem.title || ""} /></label>{themeField(formItem.theme)}<label>種類<select name="kind" defaultValue={formItem.kind || "task"}><option value="task">タスク</option><option value="inbox">Inbox</option><option value="milestone">節目</option><option value="event">イベント</option><option value="deliverable">成果物</option><option value="idea">アイデア</option></select></label><label>状態<select name="status" defaultValue={formItem.status || "todo"}><option value="inbox">Inbox</option><option value="todo">未着手</option><option value="doing">進行中</option><option value="review">レビュー</option><option value="done">完了</option></select></label><label>期限<input name="due" type="date" defaultValue={formItem.due || todayIso()} /></label><label>優先度<select name="priority" defaultValue={formItem.priority || "normal"}><option value="normal">通常</option><option value="high">高</option><option value="decision">要判断</option></select></label><label>説明<textarea name="description" defaultValue={formItem.description || ""} /></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "theme-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>テーマ名<input name="name" autoFocus defaultValue={formItem.name || ""} /></label><label>概要<textarea name="subtitle" defaultValue={formItem.subtitle || ""} /></label><label>状態<select name="status" defaultValue={formItem.status || "計画中"}><option>計画中</option><option>進行中</option><option>継続</option><option>保留</option><option>完了</option></select></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "note-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>タイトル<input name="title" autoFocus defaultValue={formItem.title || ""} /></label>{themeField(formItem.theme)}<label>メモ種別<select name="noteType" defaultValue={formItem.type || "研究メモ"}><option>研究メモ</option><option>意思決定</option><option>会議メモ</option><option>実験メモ</option><option>解析メモ</option><option>AI壁打ち</option><option>学習メモ</option><option>ふりかえり</option></select></label><label>本文（Markdown）<textarea className="large-textarea" name="body" defaultValue={formItem.body || ""} /></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "waiting-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>タイトル<input name="title" autoFocus defaultValue={formItem.title || ""} /></label>{themeField(formItem.theme)}<label>待っているもの<input name="waitingFor" defaultValue={formItem.waitingFor || ""} /></label><label>依頼先<input name="owner" defaultValue={formItem.owner || ""} /></label><label>確認日・期限<input name="due" type="date" defaultValue={formItem.due || todayIso()} /></label><label>背景・経緯<textarea name="note" defaultValue={formItem.note || ""} /></label><label>解除後の次アクション<textarea name="next" defaultValue={formItem.next || ""} /></label><input type="hidden" name="status" value={formItem.status || "waiting"} /><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "link-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>リンク名<input name="title" autoFocus defaultValue={formItem.title || ""} /></label>{themeField(formItem.theme)}<label>URL<input name="url" type="url" placeholder="https://..." defaultValue={formItem.url || ""} /></label><label>種類<select name="linkType" defaultValue={formItem.type || "other"}><option value="sharepoint">SharePoint</option><option value="onedrive">OneDrive</option><option value="teams">Teams</option><option value="outlook">Outlook</option><option value="chatgpt">ChatGPT</option><option value="copilot">Copilot</option><option value="github">GitHub</option><option value="local_file">ローカルファイル</option><option value="notebook">Notebook</option><option value="paper">論文・資料</option><option value="folder">フォルダ</option><option value="other">その他</option></select></label><label>説明<textarea name="description" defaultValue={formItem.description || ""} /></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "person-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>名前<input name="name" autoFocus defaultValue={formItem.name || ""} /></label><label>役割<input name="role" defaultValue={formItem.role || ""} /></label><label>所属<input name="organization" defaultValue={formItem.organization || ""} /></label><label>メモ<textarea name="note" defaultValue={formItem.note || ""} /></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "phase-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>計画名<input name="label" autoFocus defaultValue={formItem.label || ""} /></label>{themeField(formItem.theme)}<div className="form-grid"><label>開始日<input name="start" type="date" defaultValue={formItem.start || todayIso()} /></label><label>終了日<input name="end" type="date" defaultValue={formItem.end || todayIso()} /></label></div><label>表示色<select name="tone" defaultValue={formItem.tone || "accent"}><option value="accent">アクセント</option><option value="blue">情報</option><option value="green">完了・安定</option><option value="amber">注意</option><option value="neutral">ニュートラル</option></select></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "milestone-form" && <form className="drawer-form" onSubmit={saveEntity}>{hidden}<label>節目名<input name="label" autoFocus defaultValue={formItem.label || ""} /></label>{themeField(formItem.theme)}<label>日付<input name="date" type="date" defaultValue={formItem.date || todayIso()} /></label><button className="primary-button" type="submit">保存する</button></form>}
      {drawer.type === "task" && item && <div className="drawer-content"><span className={`status-badge ${item.priority === "decision" ? "danger" : "neutral"}`}>{item.status === "done" ? "完了" : "未完了"}</span><h2>{item.title}</h2><p>{item.description}</p><dl><dt>ID</dt><dd>TSK-{String(item.id).padStart(6, "0")}</dd><dt>期限</dt><dd>{dateLabel(item.due, true)}</dd><dt>優先度</dt><dd>{item.priority === "decision" ? "要判断" : item.priority === "high" ? "高" : "通常"}</dd></dl><div className="drawer-actions"><button className="secondary-button" onClick={() => close(edit("task"))}>編集する</button><button className="primary-button" onClick={() => { toggleTask(item.id); close(); }}>{item.status === "done" ? "未完了に戻す" : "完了にする"}</button><button className="danger-button" onClick={() => deleteTask(item.id)}>削除する</button></div></div>}
      {drawer.type === "waiting" && item && <div className="drawer-content"><span className="status-badge warning">待ち</span><h2>{item.title}</h2><dl><dt>待っているもの</dt><dd>{item.waitingFor}</dd><dt>依頼先</dt><dd>{item.owner}</dd><dt>期限</dt><dd>{dateLabel(item.due, true)}</dd><dt>背景・経緯</dt><dd>{item.note}</dd><dt>次のアクション</dt><dd>{item.next}</dd></dl><div className="drawer-actions"><button className="secondary-button" onClick={() => close(edit("waiting"))}>編集する</button><button className="primary-button" onClick={() => completeWaiting(item.id)}>完了済みにする</button><button className="danger-button" onClick={() => deleteEntity("waiting", item.id)}>削除する</button></div></div>}
      {drawer.type === "note" && item && <div className="drawer-content"><span className="status-badge neutral">{item.type}</span><h2>{item.title}</h2><p className="note-body">{item.body}</p><small>更新 {item.updated}</small><div className="drawer-actions"><button className="primary-button" onClick={() => close(edit("note"))}>編集する</button><button className="danger-button" onClick={() => deleteEntity("note", item.id)}>削除する</button></div></div>}
      {drawer.type === "link" && item && <div className="drawer-content"><span className="status-badge neutral">{item.type}</span><h2>{item.title}</h2><p>{item.description}</p><div className="link-value">{item.url}</div><div className="drawer-actions"><button className="secondary-button" onClick={() => close(edit("link"))}>編集する</button><button className="primary-button" onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}>リンクを開く</button><button className="danger-button" onClick={() => deleteEntity("link", item.id)}>削除する</button></div></div>}
      {drawer.type === "person" && item && <div className="drawer-content"><h2>{item.name}</h2><dl><dt>役割</dt><dd>{item.role || "—"}</dd><dt>所属</dt><dd>{item.organization || "—"}</dd><dt>メモ</dt><dd>{item.note || "—"}</dd></dl><div className="drawer-actions"><button className="primary-button" onClick={() => close(edit("person"))}>編集する</button><button className="danger-button" onClick={() => deleteEntity("person", item.id)}>削除する</button></div></div>}
      {drawer.type === "phase" && item && <div className="drawer-content"><span className="status-badge neutral">期間予定</span><h2>{item.label}</h2><dl><dt>開始</dt><dd>{dateLabel(item.start, true)}</dd><dt>終了</dt><dd>{dateLabel(item.end, true)}</dd></dl><div className="drawer-actions"><button className="primary-button" onClick={() => close(edit("phase"))}>日付を編集</button><button className="danger-button" onClick={() => deleteEntity("phase", item.id)}>削除する</button></div></div>}
      {drawer.type === "milestone" && item && <div className="drawer-content"><span className="status-badge neutral">節目</span><h2>{item.label}</h2><dl><dt>日付</dt><dd>{dateLabel(item.date, true)}</dd></dl><div className="drawer-actions"><button className="primary-button" onClick={() => close(edit("milestone"))}>編集する</button><button className="danger-button" onClick={() => deleteEntity("milestone", item.id)}>削除する</button></div></div>}
      {drawer.type === "artifact" && item && <div className="drawer-content"><span className="status-badge neutral">関連ファイル</span><h2>{item.title}</h2><dl><dt>最終更新</dt><dd>{item.updated}</dd><dt>保存場所</dt><dd>研究共有 / 材料A評価 / 成果物</dd></dl><div className="drawer-actions"><button className="secondary-button" onClick={() => close()}>閉じる</button></div></div>}
    </aside>
  );
}

function EmptyState({ title, action, onAction }) {
  return <div className="empty-state"><strong>{title}</strong><button className="secondary-button compact" onClick={onAction}>{action}</button></div>;
}
