import { IconPlus, IconWriting } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePersistentState } from "../../../utils/usePersistentState";
import { EmptyState, PageHeader } from "../components/common";
import { createSketchDraft, drawSketchPage, type SketchPage } from "../lib/sketch";
import type { PageProps, Sketch } from "../types";

const ACTIVE_SKETCH_KEY = "tasken:sketch:active-id";

interface SketchLibraryPreferences {
  themeId: string;
  sortOrder: "updated_desc" | "updated_asc" | "title";
}

const DEFAULT_PREFERENCES: SketchLibraryPreferences = {
  themeId: "all",
  sortOrder: "updated_desc",
};

function SketchPreview({ page }: { page?: SketchPage }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context || !page) return;
    drawSketchPage(context, page);
  }, [page]);

  if (!page) return <span className="sketch-library-preview-empty"><IconWriting size={22} /></span>;
  return <canvas ref={canvasRef} width={page.width} height={page.height} aria-hidden="true" />;
}

function updatedLabel(sketch: Sketch): string {
  const value = sketch.updated_at || sketch.created_at;
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ja-JP");
}

export function SketchLibraryPage({
  data,
  themes,
  activeTheme,
  navigate,
  openDrawer,
}: PageProps) {
  const [query, setQuery] = useState("");
  const [preferences, setPreferences] = usePersistentState<SketchLibraryPreferences>(
    "sketch:library-prefs:v1",
    DEFAULT_PREFERENCES,
  );

  const sketches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ja");
    return [...data.sketches]
      .filter((sketch) => preferences.themeId === "all" || String(sketch.project_id || "") === preferences.themeId)
      .filter((sketch) => {
        if (!normalizedQuery) return true;
        const theme = themes.find((entry) => entry.id === sketch.project_id);
        return [sketch.title, theme?.name]
          .join(" ")
          .toLocaleLowerCase("ja")
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        if (preferences.sortOrder === "title") return left.title.localeCompare(right.title, "ja");
        const leftDate = String(left.updated_at || left.created_at || "");
        const rightDate = String(right.updated_at || right.created_at || "");
        return preferences.sortOrder === "updated_asc"
          ? leftDate.localeCompare(rightDate)
          : rightDate.localeCompare(leftDate);
      });
  }, [data.sketches, preferences, query, themes]);

  const filterActive = preferences.themeId !== "all" || Boolean(query.trim());

  function createSketch() {
    const draft = createSketchDraft("新しいSketch", activeTheme?.id || null);
    openDrawer({
      type: "sketch",
      mode: "edit",
      entity: { ...draft, id: undefined },
    });
  }

  function openSketch(sketch: Sketch) {
    localStorage.setItem(ACTIVE_SKETCH_KEY, sketch.id);
    navigate("sketch-editor");
  }

  return (
    <div className="page sketch-library-page">
      <PageHeader title="Sketch">
        <button className="primary-button" onClick={createSketch}>
          <IconPlus size={16} />新しいSketch
        </button>
      </PageHeader>

      <div className="filter-bar panel sketch-library-filters">
        <input
          data-search
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="タイトル・Themeで検索"
          aria-label="Sketchを検索"
        />
        <select
          value={preferences.themeId}
          onChange={(event) => setPreferences((current) => ({ ...current, themeId: event.target.value }))}
          aria-label="SketchをThemeで絞り込み"
        >
          <option value="all">Theme: すべて</option>
          {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
        </select>
        <select
          value={preferences.sortOrder}
          onChange={(event) => setPreferences((current) => ({
            ...current,
            sortOrder: event.target.value as SketchLibraryPreferences["sortOrder"],
          }))}
          aria-label="Sketchの並び順"
        >
          <option value="updated_desc">更新日（新しい順）</option>
          <option value="updated_asc">更新日（古い順）</option>
          <option value="title">タイトル</option>
        </select>
        <span className="sketch-library-count">{sketches.length}件</span>
      </div>

      {sketches.length ? (
        <section className="sketch-library-list" aria-label="Sketch一覧">
          <div className="sketch-library-list-header" aria-hidden="true">
            <span>Sketch</span>
            <span>Theme</span>
            <span>ページ</span>
            <span>更新</span>
            <span />
          </div>
          {sketches.map((sketch) => {
            const theme = themes.find((entry) => entry.id === sketch.project_id);
            return (
              <article className="sketch-library-row" key={sketch.id}>
                <button
                  className="sketch-library-main"
                  onClick={() => openDrawer({ type: "sketch", entity: sketch })}
                  aria-label={`${sketch.title}の詳細を開く`}
                >
                  <SketchPreview page={sketch.document.pages[0]} />
                  <strong>{sketch.title || "無題のSketch"}</strong>
                </button>
                <span>{theme?.name || "Theme未設定"}</span>
                <span className="sketch-library-number">{sketch.document.pages.length}</span>
                <time dateTime={String(sketch.updated_at || sketch.created_at || "")}>{updatedLabel(sketch)}</time>
                <button className="secondary-button compact" onClick={() => openSketch(sketch)}>開く</button>
              </article>
            );
          })}
        </section>
      ) : filterActive ? (
        <EmptyState
          title="条件に一致するSketchがありません"
          action="絞り込みを解除"
          onAction={() => {
            setQuery("");
            setPreferences(DEFAULT_PREFERENCES);
          }}
        />
      ) : (
        <EmptyState title="Sketchはまだありません" action="新しいSketch" onAction={createSketch} />
      )}
    </div>
  );
}
