import { useEffect, useMemo, useState } from "react";
import {
  IconArchive,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconPin,
  IconEye,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";

import { todayIso } from "../../../utils/dataFormat.js";
import type { PageProps } from "../types";

import { formatDate } from "../lib/format";
import { Button, EmptyState, PageHeader } from "../components/common";
import { ToolbarMenu } from "../components/ToolbarMenu";
import { buildInboxView, buildMicroMemoView } from "../domain-model/selectors";
import {
  buildSaveCaptureEntryOperations,
  buildChangeEventOperation,
} from "../domain-model/persistence";
import type { CaptureEntry } from "../domain-model/types";
import type { SaveOperation } from "../types";
import type { Entity } from "../../../../../shared/types/workspace";

import {
  MEMO_STICKY_COLOR_LABELS,
  MEMO_STICKY_COLORS,
  markMemoStickyColor,
  memoStickyColorOf,
  type MemoStickyColor,
} from "../../../../../shared/memoPresentation";

import { createSketchDraft } from "../lib/sketch";

import { buildLinkedArtifactOperationsFromPaths } from "../lib/artifactEntities";

import {
  captureMatchesQuery,
  fileCaptureContentType,
} from "../../../../../shared/quickCapture.mjs";

function StickyColorSwatch({ color }: { color: MemoStickyColor }) {
  return <span className="sticky-color-swatch" data-sticky-color={color} aria-hidden="true" />;
}

function StickyColorFilter({
  value,
  onChange,
}: {
  value: MemoStickyColor | "all";
  onChange: (color: MemoStickyColor | "all") => void;
}) {
  return (
    <div className="sticky-color-filter" role="group" aria-label="付箋の色で絞り込む">
      <span>色</span>
      <div className="sticky-color-filter-options">
        <button
          type="button"
          className={value === "all" ? "is-selected" : ""}
          aria-pressed={value === "all"}
          onClick={() => onChange("all")}
        >
          すべて
        </button>
        {MEMO_STICKY_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={value === color ? "is-selected" : ""}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
          >
            <StickyColorSwatch color={color} />
            {MEMO_STICKY_COLOR_LABELS[color]}
          </button>
        ))}
      </div>
    </div>
  );
}

function StickyColorPicker({
  color,
  onSelect,
}: {
  color: MemoStickyColor;
  onSelect: (color: MemoStickyColor) => void;
}) {
  return (
    <details className="micro-memo-color-picker">
      <summary aria-label={`付箋の色: ${MEMO_STICKY_COLOR_LABELS[color]}`} title="付箋の色を変更">
        <StickyColorSwatch color={color} />
        <span>{MEMO_STICKY_COLOR_LABELS[color]}</span>
      </summary>
      <div className="micro-memo-color-options" role="group" aria-label="付箋の色を選択">
        {MEMO_STICKY_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            className={color === option ? "is-selected" : ""}
            aria-pressed={color === option}
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onSelect(option);
            }}
          >
            <StickyColorSwatch color={option} />
            {MEMO_STICKY_COLOR_LABELS[option]}
          </button>
        ))}
      </div>
    </details>
  );
}

export function InboxPage({
  domain: v2,
  openDrawer,
  navigate,
  saveEntities,
  removeEntity,
  setToast,
}: PageProps) {
  const [query, setQuery] = useState("");
  const allInboxRows = useMemo(() => {
    return buildInboxView(v2).entries.map((entry) => ({ entry }));
  }, [v2]);
  const allMicroMemoRows = useMemo(() => buildMicroMemoView(v2).entries, [v2]);
  const microMemoRows = useMemo(
    () => allMicroMemoRows.filter((entry) => captureMatchesQuery(entry, query)),
    [allMicroMemoRows, query],
  );
  // 付箋対象と表示状態はMainの正本を別々に投影する（#377）。
  const [openStickyIds, setOpenStickyIds] = useState<string[]>([]);
  const [stickyTargetIds, setStickyTargetIds] = useState<string[]>([]);
  const [stickyColorFilter, setStickyColorFilter] = useState<MemoStickyColor | "all">("all");
  const [expandedStickyIds, setExpandedStickyIds] = useState<string[]>([]);
  const visibleMicroMemoRows = useMemo(
    () =>
      stickyColorFilter === "all"
        ? microMemoRows
        : microMemoRows.filter(
            (entry) => memoStickyColorOf(entry as unknown as Entity) === stickyColorFilter,
          ),
    [microMemoRows, stickyColorFilter],
  );
  const allTargetStickiesVisible =
    stickyTargetIds.length > 0 && stickyTargetIds.every((memoId) => openStickyIds.includes(memoId));

  useEffect(() => {
    const applyState = (state: {
      openMemoIds: string[];
      stickyMemoIds: string[];
      alwaysOnTopMemoIds: string[];
    }) => {
      setOpenStickyIds(state.openMemoIds);
      setStickyTargetIds(state.stickyMemoIds);
    };
    void workspaceApi
      .getSatelliteWindowState()
      .then(applyState)
      .catch(() =>
        applyState({
          openMemoIds: [],
          stickyMemoIds: [],
          alwaysOnTopMemoIds: [],
        }),
      );
    return workspaceApi.onSatelliteWindowStateChanged(applyState);
  }, []);

  function copyMicroMemo(memo: CaptureEntry) {
    const body = [memo.title, memo.text].filter(Boolean).join("\n");
    workspaceApi
      .copyText(body)
      .then(() => setToast("付箋メモをコピーしました。"))
      .catch((error) =>
        setToast(
          `コピーできませんでした。${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }

  function copyAllMicroMemos() {
    const body = allMicroMemoRows
      .map((memo) => {
        const title = memo.title?.trim();
        const text = memo.text?.trim();
        const indentedText = text ? text.replace(/\n/g, "\n  ") : "";
        return title
          ? `- ${title}${indentedText ? `\n  ${indentedText}` : ""}`
          : indentedText
            ? `- ${indentedText}`
            : "";
      })
      .filter(Boolean)
      .join("\n");
    if (!body) {
      setToast("コピーできる付箋メモがありません。", "info");
      return;
    }
    workspaceApi
      .copyText(body)
      .then(() => setToast(`${allMicroMemoRows.length}件の付箋メモをコピーしました。`, "success"))
      .catch((error) =>
        setToast(
          `コピーできませんでした。${error instanceof Error ? error.message : String(error)}`,
          "danger",
        ),
      );
  }

  async function toggleMicroMemoTarget(memo: CaptureEntry) {
    const target = !stickyTargetIds.includes(memo.id);
    const result = await workspaceApi.setMemoStickyTarget(memo.id, target);
    if (result.status === "not_found") {
      setToast("付箋対象を変更できませんでした。メモを再読み込みしてください。", "danger");
    } else if (result.status === "flush_failed") {
      setToast("付箋を収納できませんでした。付箋側の保存エラーを解消してください。", "danger");
    }
  }

  async function showMicroMemoSticky(memo: CaptureEntry) {
    const result = await workspaceApi.setMemoStickyTarget(memo.id, true);
    if (result.status === "not_found") {
      setToast("付箋を表示できませんでした。メモを再読み込みしてください。", "danger");
    } else if (result.status === "flush_failed") {
      setToast("付箋を表示できませんでした。付箋側の保存エラーを解消してください。", "danger");
    }
  }

  async function toggleMicroMemoStickies() {
    const result = await workspaceApi.toggleMemoStickyTargetsVisibility();
    if (result.status === "empty") setToast("表示する付箋がありません。", "info");
    if (result.status === "flush_failed") {
      setToast("付箋を収納できませんでした。付箋側の保存エラーを解消してください。", "danger");
    }
  }

  async function updateMicroMemoColor(memo: CaptureEntry, color: MemoStickyColor) {
    if (memoStickyColorOf(memo as unknown as Entity) === color) return;
    try {
      const next = markMemoStickyColor(memo as unknown as Entity, color) as unknown as CaptureEntry;
      await saveEntities(
        buildSaveCaptureEntryOperations(next, {
          source: "manual",
          reason: "sticky_color_changed",
          newSession: true,
        }),
        "付箋の色を変更しました。",
        "main_ui",
      );
    } catch (error) {
      setToast(
        `付箋の色を変更できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  function toggleStickyCardExpansion(id: string) {
    setExpandedStickyIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function addMemo() {
    openDrawer({
      type: "capture_entry",
      mode: "edit",
      entity: {
        kind: "micro_memo",
        content_type: "text",
        state: "untriaged",
        captured_at: new Date().toISOString(),
      },
    });
  }

  async function captureFiles() {
    const picked = await workspaceApi.chooseFiles("Inboxへ記録するファイル・画像を選択");
    if (picked.canceled || !picked.files?.length) return;
    const captureId = crypto.randomUUID();
    const names = picked.files.map((file) => file.name);
    const title = names.length === 1 ? names[0] : `${names[0]} ほか${names.length - 1}件`;
    const entry: CaptureEntry = {
      id: captureId,
      title,
      text: names.join("\n"),
      kind: "file_capture",
      content_type: fileCaptureContentType(picked.files),
      captured_at: new Date().toISOString(),
      state: "untriaged",
    };
    try {
      await saveEntities(
        [
          {
            action: "save",
            type: "capture_entry",
            entity: entry as unknown as SaveOperation["entity"],
          },
          ...buildLinkedArtifactOperationsFromPaths(picked.files, "capture_entry", captureId),
          buildChangeEventOperation("capture_entry", captureId, "created"),
        ],
        `${picked.files.length}件をInboxへ記録しました。`,
      );
    } catch (error) {
      setToast(
        `ファイルを記録できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  async function archiveEntry(entry: CaptureEntry) {
    const archived: CaptureEntry = { ...entry, state: "archived" };
    await saveEntities(
      [
        {
          action: "save",
          type: "capture_entry",
          entity: archived as unknown as SaveOperation["entity"],
        },
        buildChangeEventOperation("capture_entry", entry.id, "updated", {}, entry, archived),
      ],
      "付箋メモをアーカイブしました。",
    );
  }

  async function startInkCapture() {
    const captureId = crypto.randomUUID();
    const title = `Ink Capture ${new Date().toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const sketch = createSketchDraft(title, null, captureId);
    try {
      await saveEntities(
        [
          { action: "save", type: "sketch", entity: sketch },
          {
            action: "save",
            type: "capture_entry",
            entity: {
              id: captureId,
              title,
              text: "手書きで記録",
              kind: "ink_capture",
              content_type: "ink",
              captured_at: new Date().toISOString(),
              state: "triaged",
              triaged_to_type: "sketch",
              triaged_to_id: sketch.id,
            },
          },
          buildChangeEventOperation("capture_entry", captureId, "triaged"),
          buildChangeEventOperation("sketch", sketch.id, "created"),
        ],
        "Ink Captureを開始しました。",
      );
      localStorage.setItem("tasken:sketch:active-id", sketch.id);
      navigate("sketch-editor");
    } catch (error) {
      setToast(
        `Ink Captureを開始できませんでした。${error instanceof Error ? error.message : String(error)}`,
        "danger",
      );
    }
  }

  return (
    <div className="page inbox-page">
      <PageHeader route="inbox">
        <ToolbarMenu
          label="その他の記録"
          title="使用頻度の低い記録方法"
          items={[
            { id: "capture-ink", label: "手書きで記録", onSelect: () => void startInkCapture() },
            { id: "capture-file", label: "ファイルを記録", onSelect: () => void captureFiles() },
            {
              id: "capture-chat-link",
              label: "チャットリンクを追加",
              onSelect: () =>
                openDrawer({
                  type: "resource",
                  mode: "edit",
                  entity: { reference_status: "inbox", captured_at: todayIso() },
                }),
            },
          ]}
        />
        <Button variant="primary" onClick={addMemo}>
          <IconPlus size={16} />
          Memo
        </Button>
      </PageHeader>
      {allInboxRows.length > 0 ? (
        <p className="inbox-feed-notice" role="note">
          未整理のメモ{allInboxRows.length}
          件は、Feedのホームに自分のメモとして並んでいます。そこから整理できます。{" "}
          <Button variant="ghost" compact onClick={() => navigate("feed")}>
            Feedを開く
          </Button>
        </p>
      ) : null}
      <label className="inbox-search">
        <IconSearch size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="付箋メモを検索"
        />
      </label>
      <section className="panel inbox-panel">
        <div className="section-heading">
          <h2>付箋メモ</h2>
          <span>{visibleMicroMemoRows.length}件</span>
          <div className="inline-actions">
            <span className="sticky-open-count">
              対象 {stickyTargetIds.length} · 表示中 {openStickyIds.length}
            </span>
            <StickyColorFilter value={stickyColorFilter} onChange={setStickyColorFilter} />
            <button
              className="text-button compact"
              onClick={copyAllMicroMemos}
              disabled={!allMicroMemoRows.length}
              type="button"
            >
              <IconCopy size={14} />
              まとめてコピー
            </button>
            <button className="text-button compact" onClick={() => void toggleMicroMemoStickies()}>
              {allTargetStickiesVisible ? "対象を収納" : "対象を表示"}
            </button>
          </div>
        </div>
        {visibleMicroMemoRows.length ? (
          <div className="micro-memo-grid">
            {visibleMicroMemoRows.map((memo) => {
              const targeted = stickyTargetIds.includes(memo.id);
              const color = memoStickyColorOf(memo as unknown as Entity);
              const expanded = expandedStickyIds.includes(memo.id);
              return (
                <article
                  className={`micro-memo-card ${targeted ? "is-targeted" : ""}`}
                  data-expanded={expanded}
                  data-sticky-color={color}
                  key={memo.id}
                >
                  <div className="micro-memo-card-header">
                    <div className="micro-memo-card-meta">
                      <time dateTime={memo.captured_at} title={`記録日 ${memo.captured_at}`}>
                        記録 {formatDate(memo.captured_at)}
                      </time>
                    </div>
                    <div className="micro-memo-card-header-actions">
                      <StickyColorPicker
                        color={color}
                        onSelect={(next) => void updateMicroMemoColor(memo, next)}
                      />
                      <button
                        className={`micro-memo-pin-button ${targeted ? "is-active" : ""}`}
                        onClick={() => void toggleMicroMemoTarget(memo)}
                        aria-label={targeted ? "付箋対象から外して収納" : "付箋対象にして表示"}
                        aria-pressed={targeted}
                        title={targeted ? "付箋対象から外す" : "付箋対象にする"}
                        type="button"
                      >
                        <IconPin size={16} />
                      </button>
                    </div>
                  </div>
                  <div className={`micro-memo-card-body ${expanded ? "is-expanded" : ""}`}>
                    {memo.title && <strong>{memo.title}</strong>}
                    <p>{memo.text}</p>
                  </div>
                  <div className="micro-memo-actions">
                    {targeted && (
                      <button
                        className="row-action-button"
                        onClick={() => void showMicroMemoSticky(memo)}
                        aria-label="付箋を表示"
                        title="表示"
                        type="button"
                      >
                        <IconEye size={15} />
                      </button>
                    )}
                    <button
                      className="row-action-button"
                      onClick={() => toggleStickyCardExpansion(memo.id)}
                      aria-label={expanded ? "付箋メモを短く表示" : "付箋メモを全文表示"}
                      title={expanded ? "短く表示" : "全文表示"}
                      type="button"
                    >
                      {expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
                    </button>
                    <button
                      className="row-action-button"
                      onClick={() => copyMicroMemo(memo)}
                      aria-label="付箋メモをコピー"
                      title="コピー"
                    >
                      <IconCopy size={15} />
                    </button>
                    <button
                      className="row-action-button"
                      onClick={() =>
                        openDrawer({
                          type: "capture_entry",
                          mode: "edit",
                          entity: memo as unknown as Record<string, unknown>,
                        })
                      }
                      aria-label="付箋メモを編集"
                      title="編集"
                    >
                      <IconPencil size={15} />
                    </button>
                    {/* アーカイブと削除は別の操作として並べる（#298）。 */}
                    <button
                      className="row-action-button"
                      onClick={() => void archiveEntry(memo)}
                      aria-label="付箋メモをアーカイブ"
                      title="アーカイブ"
                    >
                      <IconArchive size={15} />
                    </button>
                    <button
                      className="row-action-button danger"
                      onClick={() =>
                        removeEntity("capture_entry", memo as unknown as Record<string, unknown>)
                      }
                      aria-label="付箋メモを削除"
                      title="削除"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : stickyColorFilter !== "all" ? (
          <EmptyState
            title="この色の付箋メモはありません"
            action="色フィルターを解除"
            onAction={() => setStickyColorFilter("all")}
          />
        ) : (
          <EmptyState
            title={query ? "検索に一致する付箋メモはありません" : "付箋メモはありません"}
          />
        )}
      </section>
    </div>
  );
}
