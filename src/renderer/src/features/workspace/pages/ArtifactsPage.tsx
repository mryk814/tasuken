import { useMemo, useState } from "react";
import { IconVolume } from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { usePreference } from "../../../utils/usePreference";
import { useUiStore } from "../../../stores/uiStore";
import { defaultViewPreference } from "../../../../../shared/viewPreferenceRegistry.mjs";
import { ArtifactCard, resolveArtifactSourceLabel, themeNameOf } from "../components/artifacts";
import { Button, EmptyState, PageHeader, ThemePickerSelect } from "../components/common";
import { ARTIFACT_SOURCE_TYPE_LABELS } from "../domain-model/labels";
import { readRecentArtifactIds } from "../lib/artifactRecent";
import { readAudioDurationMs } from "../lib/audioMetadata";
import { requestFeedPostFocus } from "../lib/feedPosts";
import type { ArtifactSourceType, PageProps } from "../types";

type SortOrder = "newest" | "oldest" | "recent_opened" | "name";
type TypeFilter = "all" | "image" | "spreadsheet" | "pdf" | "markdown" | "presentation" | "other";

interface ArtifactsPrefs {
  themeId: string;
  sourceType: "all" | ArtifactSourceType;
  typeFilter: TypeFilter;
  sortOrder: SortOrder;
}

const DEFAULT_PREFS: ArtifactsPrefs = defaultViewPreference(
  "artifacts.preferences",
) as ArtifactsPrefs;

const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: "すべて",
  image: "画像",
  spreadsheet: "表計算",
  pdf: "PDF",
  markdown: "Markdown",
  presentation: "資料",
  other: "その他",
};

function matchesTypeFilter(artifact: { file_type?: string }, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  const type = (artifact.file_type || "").toLowerCase();
  if (filter === "image") return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(type);
  if (filter === "spreadsheet") return ["xlsx", "xls", "csv", "tsv"].includes(type);
  if (filter === "pdf") return type === "pdf";
  if (filter === "markdown") return ["md", "markdown"].includes(type);
  if (filter === "presentation") return ["pptx", "ppt"].includes(type);
  return ![
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "svg",
    "xlsx",
    "xls",
    "csv",
    "tsv",
    "pdf",
    "md",
    "markdown",
    "pptx",
    "ppt",
  ].includes(type);
}

export function ArtifactsPage({
  data,
  themes,
  openDrawer,
  openContentViewer,
  removeEntity,
  saveEntities,
  setToast,
  navigate,
}: PageProps) {
  const [query, setQuery] = useState("");
  const activeThemeId = useUiStore((state) => state.activeThemeId);
  const [audioImporting, setAudioImporting] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const [prefs, setPrefs] = usePreference("artifacts.preferences");
  const updatePrefs = (patch: Partial<ArtifactsPrefs>) =>
    setPrefs((current) => ({ ...current, ...patch }));
  const recentIds = useMemo(() => readRecentArtifactIds(), [data.artifacts, recentTick]);
  const recentRank = useMemo(() => new Map(recentIds.map((id, index) => [id, index])), [recentIds]);

  const artifacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.artifacts || [])
      .filter((artifact) => {
        if (prefs.themeId !== "all" && String(artifact.theme_id || "") !== prefs.themeId)
          return false;
        if (prefs.sourceType !== "all" && artifact.source_type !== prefs.sourceType) return false;
        if (!matchesTypeFilter(artifact, prefs.typeFilter)) return false;
        if (!q) return true;
        const haystack = [
          artifact.filename,
          artifact.title,
          artifact.description,
          resolveArtifactSourceLabel(artifact, data),
          themeNameOf(artifact, data),
          artifact.file_type,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        if (prefs.sortOrder === "name") {
          return String(a.filename || a.title).localeCompare(String(b.filename || b.title), "ja");
        }
        if (prefs.sortOrder === "oldest") {
          return String(a.created_at || "").localeCompare(String(b.created_at || ""));
        }
        if (prefs.sortOrder === "recent_opened") {
          const aRank = recentRank.has(a.id) ? recentRank.get(a.id)! : Number.MAX_SAFE_INTEGER;
          const bRank = recentRank.has(b.id) ? recentRank.get(b.id)! : Number.MAX_SAFE_INTEGER;
          if (aRank !== bRank) return aRank - bRank;
        }
        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      });
  }, [data, prefs, query, recentRank]);

  const hasAny = (data.artifacts || []).length > 0;
  const filterActive =
    prefs.themeId !== "all" ||
    prefs.sourceType !== "all" ||
    prefs.typeFilter !== "all" ||
    Boolean(query.trim());

  function openFeedPost(postId: string) {
    navigate("feed");
    requestFeedPostFocus(postId);
  }

  function copyList() {
    const header = "ファイル名\t種類\tTheme\t元Entity\t作成日\tパス";
    const rows = artifacts.map((artifact) =>
      [
        artifact.filename,
        artifact.file_type || "",
        themeNameOf(artifact, data),
        `${ARTIFACT_SOURCE_TYPE_LABELS[artifact.source_type] || artifact.source_type}:${resolveArtifactSourceLabel(artifact, data)}`,
        artifact.created_at ? new Date(artifact.created_at).toLocaleDateString("ja-JP") : "",
        artifact.stored_path,
      ].join("\t"),
    );
    workspaceApi
      .copyText([header, ...rows].join("\n"))
      .then(() => setToast("Artifact 一覧をコピーしました。", "success"));
  }

  /**
   * 音声ファイルは普通の添付の追加では受けない（長さ・形式を確かめる専用の保存の道を通す）。
   * 入口だった収録の画面を外した（#755 束4）ので、添付の一覧の見出しに置く。
   * 保存に失敗したら保存待ちを破棄する。元のファイルは選んだ場所に残っている。
   * 保存の途中（finalize の後）で落ちた物は破棄できない。その時は次の起動の復旧が
   * 保存し直す（recoverPending）ので、そう伝える。
   */
  async function importAudio() {
    setAudioImporting(true);
    let sessionId: string | null = null;
    try {
      const prepared = await workspaceApi.prepareAudioCapture(activeThemeId || null);
      if (prepared.canceled) return;
      sessionId = prepared.sessionId;
      if (!prepared.canCommit || prepared.status !== "ready" || !prepared.mediaUrl)
        throw new Error("この音声は安全に読み込めないため保存できません。");
      const durationMs = prepared.durationMs ?? (await readAudioDurationMs(prepared.mediaUrl));
      await workspaceApi.commitAudioCapture({ sessionId: prepared.sessionId, durationMs });
      sessionId = null;
      setToast(`音声「${prepared.filename}」を添付に保存しました。`, "success");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      let resumesOnNextStart = false;
      let alreadySaved = false;
      if (sessionId) {
        try {
          await workspaceApi.cancelAudioCapture(sessionId);
        } catch (cancelError) {
          const cancelMessage = cancelError instanceof Error ? cancelError.message : "";
          // 保存は済んだのに、その後の返事で失敗した形。取り込み直しを促さない。
          alreadySaved = /保存済み/.test(cancelMessage);
          resumesOnNextStart = /保存処理を開始した/.test(cancelMessage);
        }
      }
      if (alreadySaved) {
        setToast("音声を添付に保存しました。", "success");
        return;
      }
      setToast(
        resumesOnNextStart
          ? `音声の保存が途中で止まりました。${reason} 次の起動で保存し直します。`
          : `音声を取り込めませんでした。${reason} もう一度取り込んでください。`,
        resumesOnNextStart ? "warning" : "danger",
      );
    } finally {
      setAudioImporting(false);
    }
  }

  return (
    <div className="page artifacts-page">
      <PageHeader route="artifacts">
        <Button variant="secondary" onClick={() => void importAudio()} disabled={audioImporting}>
          <IconVolume size={15} />
          {audioImporting ? "取り込み中…" : "音声を取り込む"}
        </Button>
        <Button variant="secondary" onClick={copyList} disabled={!artifacts.length}>
          一覧をコピー
        </Button>
      </PageHeader>

      <section className="panel artifact-role-panel" aria-label="役割の整理">
        <div className="artifact-role-grid">
          <div>
            <strong>ノート</strong>
            <span>自分で書く本文</span>
          </div>
          <div>
            <strong>Resources</strong>
            <span>URL / 外部参照</span>
          </div>
          <div>
            <strong>会話録</strong>
            <span>会話の入口</span>
          </div>
          <div>
            <strong>添付</strong>
            <span>実ファイル</span>
          </div>
        </div>
      </section>

      <div className="filter-bar panel artifacts-filter-bar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ファイル名・元Entity・Themeでさがす"
          aria-label="Artifact をさがす"
        />
        <ThemePickerSelect
          themes={themes}
          value={prefs.themeId}
          onChange={(themeId) => updatePrefs({ themeId })}
          allowAll
          allowNone
          allLabel="Theme: すべて"
          ariaLabel="Themeで絞り込み"
        />
        <select
          value={prefs.sourceType}
          onChange={(event) =>
            updatePrefs({ sourceType: event.target.value as ArtifactsPrefs["sourceType"] })
          }
          aria-label="元Entityで絞り込み"
        >
          <option value="all">元: すべて</option>
          {Object.entries(ARTIFACT_SOURCE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={prefs.typeFilter}
          onChange={(event) => updatePrefs({ typeFilter: event.target.value as TypeFilter })}
          aria-label="種類で絞り込み"
        >
          {Object.entries(TYPE_FILTER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={prefs.sortOrder}
          onChange={(event) => updatePrefs({ sortOrder: event.target.value as SortOrder })}
          aria-label="並び順"
        >
          <option value="newest">作成日（新しい順）</option>
          <option value="oldest">作成日（古い順）</option>
          <option value="recent_opened">最近開いた順</option>
          <option value="name">名前</option>
        </select>
        <span>{artifacts.length}件</span>
      </div>

      {!hasAny ? (
        <EmptyState title="Artifact はまだありません" />
      ) : !artifacts.length ? (
        <div className="empty-state">
          <strong>条件に合う Artifact がありません</strong>
          {filterActive && (
            <Button
              variant="secondary"
              compact
              onClick={() => {
                setQuery("");
                setPrefs(DEFAULT_PREFS);
              }}
            >
              フィルタを解除
            </Button>
          )}
        </div>
      ) : (
        <ul className="artifact-list artifact-page-list">
          {artifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              data={data}
              openDrawer={openDrawer}
              openContentViewer={openContentViewer}
              openFeedPost={openFeedPost}
              removeEntity={removeEntity}
              saveEntities={saveEntities}
              setToast={setToast}
              showSource
              showLineage
              onOpened={() => setRecentTick((value) => value + 1)}
            />
          ))}
        </ul>
      )}

      {hasAny && (
        <p className="field-help artifact-page-help">
          追加は 会話録・Task・Note・Theme の詳細から「Artifact
          を追加」またはドラッグで行います。保存先は 設定の Artifact 保存先です。
        </p>
      )}
    </div>
  );
}
