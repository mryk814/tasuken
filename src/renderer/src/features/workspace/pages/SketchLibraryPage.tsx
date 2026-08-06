import { IconArrowsMaximize, IconFile, IconPlus, IconWriting, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePersistentState } from "../../../utils/usePersistentState";
import { EmptyState, PageHeader } from "../components/common";
import {
  resolveSketchPageSize,
  SketchPageSizePicker,
  sketchPageSizeValue,
  type SketchPageSizeValue,
} from "../components/SketchPageSizePicker";
import {
  cropSketchPageToContent,
  createSketchDraft,
  drawSketchPage,
  SKETCH_PAGE_PRESETS,
  sketchCanvasMode,
  type SketchCanvasMode,
  type SketchPage,
} from "../lib/sketch";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<SketchCanvasMode>("page");
  const [pageSize, setPageSize] = useState<SketchPageSizeValue>(() => sketchPageSizeValue());
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

  function openCreateDialog() {
    setCreateMode("page");
    setPageSize(sketchPageSizeValue(SKETCH_PAGE_PRESETS.landscape));
    setCreateOpen(true);
  }

  function createSketch() {
    const resolvedPageSize = createMode === "page" ? resolveSketchPageSize(pageSize) : SKETCH_PAGE_PRESETS.landscape;
    if (!resolvedPageSize) return;
    const draft = createSketchDraft("新しいSketch", activeTheme?.id || null, null, createMode, resolvedPageSize);
    setCreateOpen(false);
    openDrawer({
      type: "sketch",
      mode: "edit",
      entity: { ...draft, id: undefined },
    });
  }

  function openSketch(sketch: Sketch) {
    localStorage.setItem(ACTIVE_SKETCH_KEY, sketch.id);
    navigate("sketch-editor");
    openDrawer({ type: "sketch", entity: sketch });
  }

  return (
    <div className="page sketch-library-page">
      <PageHeader route="sketch">
        <button className="primary-button" onClick={openCreateDialog}>
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
          </div>
          {sketches.map((sketch) => {
            const theme = themes.find((entry) => entry.id === sketch.project_id);
            return (
              <article className="sketch-library-row" key={sketch.id}>
                <button
                  className="sketch-library-main"
                  onClick={() => openSketch(sketch)}
                  aria-label={`${sketch.title}を開く`}
                >
                  <SketchPreview
                    page={sketchCanvasMode(sketch.document) === "infinite"
                      ? cropSketchPageToContent(sketch.document.pages[0])
                      : sketch.document.pages[0]}
                  />
                  <strong>{sketch.title || "無題のSketch"}</strong>
                </button>
                <span>{theme?.name || "Theme未設定"}</span>
                <span className="sketch-library-number">
                  {sketchCanvasMode(sketch.document) === "infinite" ? "Infinite" : `Page · ${sketch.document.pages.length}`}
                </span>
                <time dateTime={String(sketch.updated_at || sketch.created_at || "")}>{updatedLabel(sketch)}</time>
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
        <EmptyState title="Sketchはまだありません" action="新しいSketch" onAction={openCreateDialog} />
      )}

      {createOpen && (
        <div className="modal-backdrop" onMouseDown={() => setCreateOpen(false)}>
          <section
            className="modal-card sketch-mode-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sketch-mode-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="modal-card-header">
              <h2 id="sketch-mode-title">作業面を選ぶ</h2>
              <button className="icon-button" onClick={() => setCreateOpen(false)} aria-label="閉じる"><IconX size={18} /></button>
            </header>
            <div className="sketch-mode-switch" role="radiogroup" aria-label="Sketchの作業面">
              <button
                type="button"
                role="radio"
                aria-checked={createMode === "page"}
                className={createMode === "page" ? "is-active" : ""}
                onClick={() => setCreateMode("page")}
              >
                <IconFile size={24} />
                <strong>Page</strong>
                <span>紙を増やして書く</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={createMode === "infinite"}
                className={createMode === "infinite" ? "is-active" : ""}
                onClick={() => setCreateMode("infinite")}
              >
                <IconArrowsMaximize size={24} />
                <strong>Infinite</strong>
                <span>一枚の面を広げる</span>
              </button>
            </div>
            {createMode === "page" ? (
              <section className="sketch-page-create-options" aria-label="Pageの用紙設定">
                <span className="field-label">用紙</span>
                <SketchPageSizePicker value={pageSize} onChange={setPageSize} />
              </section>
            ) : (
              <p className="sketch-mode-description">2400 × 1600から始まり、描画に合わせて右・下へ広がります。</p>
            )}
            <button
              className="primary-button"
              disabled={createMode === "page" && !resolveSketchPageSize(pageSize)}
              onClick={createSketch}
            >
              {createMode === "page" ? "Pageを作成" : "Infiniteを作成"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
