import { IconArrowsMaximize, IconFile, IconPlus, IconWriting, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePersistentState } from "../../../utils/usePersistentState";
import { EmptyState, PageHeader } from "../components/common";
import { ToolbarMenu } from "../components/ToolbarMenu";
import {
  resolveSketchPageSize,
  SketchPageSizePicker,
  sketchPageSizeValue,
  type SketchPageSizeValue,
} from "../components/SketchPageSizePicker";
import {
  cropSketchPageToContent,
  createSketchDraft,
  DEFAULT_SKETCH_TITLE,
  drawSketchPage,
  isDisposableSketch,
  SKETCH_PAGE_PRESETS,
  sketchCanvasMode,
  type SketchCanvasMode,
  type SketchPage,
  type SketchPageSize,
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

/**
 * title入力なしで始めるための既定title（#320）。
 * 同名が並んで見分けられなくならないよう、既存と衝突する間だけ連番を足す。
 */
export function defaultSketchTitle(existing: Sketch[], base = DEFAULT_SKETCH_TITLE): string {
  const taken = new Set(existing.map((sketch) => String(sketch.title || "")));
  if (!taken.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
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
  saveEntity,
  setToast,
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

  /**
   * 作って即描き始める（#320）。
   * 描きたい瞬間にmetadata整理を挟まない。titleとThemeは後からcanvasのmenuで変えられる。
   * 保存してからcanvasを開くので、初期Pageを失わない。
   */
  async function startSketch(mode: SketchCanvasMode, size: SketchPageSize) {
    setCreateOpen(false);
    // 空Sketchを増やさない（#320）。まだ何も描いていない無題のものがあれば作り直さず開く。
    const reusable = (data.sketches as Sketch[]).find(
      (sketch) => isDisposableSketch(sketch) && sketchCanvasMode(sketch.document) === mode,
    );
    if (reusable) {
      localStorage.setItem(ACTIVE_SKETCH_KEY, reusable.id);
      navigate("sketch-editor");
      return;
    }
    const draft = createSketchDraft(defaultSketchTitle(data.sketches as Sketch[]), activeTheme?.id || null, null, mode, size);
    try {
      const saved = await saveEntity("sketch", draft, { quiet: true });
      localStorage.setItem(ACTIVE_SKETCH_KEY, String(saved?.id || draft.id));
      navigate("sketch-editor");
    } catch (error) {
      setToast(`Sketchを作成できませんでした。${error instanceof Error ? error.message : String(error)}`, "danger");
    }
  }

  function createSketch() {
    const resolvedPageSize = createMode === "page" ? resolveSketchPageSize(pageSize) : SKETCH_PAGE_PRESETS.landscape;
    if (!resolvedPageSize) return;
    void startSketch(createMode, resolvedPageSize);
  }

  function openSketch(sketch: Sketch) {
    // 行を選んだら編集canvasへ直行する。詳細drawerを経由しない（#320）。
    localStorage.setItem(ACTIVE_SKETCH_KEY, sketch.id);
    navigate("sketch-editor");
  }

  return (
    <div className="page sketch-library-page">
      {/*
        押したらすぐ描き始める（#320）。用紙を選びたいときとInfiniteだけmenuへ回す。
      */}
      <PageHeader route="sketch">
        <ToolbarMenu
          label="作業面を選ぶ"
          title="用紙やInfinite Canvasを選んで作成する"
          items={[
            { id: "create-page-choose", label: "用紙を選んでPageを作成", onSelect: openCreateDialog },
            {
              id: "create-infinite",
              label: "Infinite Canvasを作成",
              hint: "2400 × 1600から始まり、描画に合わせて広がります",
              onSelect: () => void startSketch("infinite", SKETCH_PAGE_PRESETS.landscape),
            },
          ]}
        />
        <button
          className="primary-button"
          onClick={() => void startSketch("page", SKETCH_PAGE_PRESETS.landscape)}
        >
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
