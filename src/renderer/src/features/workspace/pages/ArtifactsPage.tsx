import { useMemo, useState } from "react";
import {
  IconCopy,
  IconExternalLink,
  IconFolderOpen,
  IconLink,
  IconTrash,
} from "@tabler/icons-react";

import { workspaceApi } from "../../../services/workspaceApi";
import { usePersistentState } from "../../../utils/usePersistentState";
import {
  ArtifactFileIcon,
  artifactOpenHint,
  artifactOpenLabel,
  formatArtifactFileSize,
  openArtifactFile,
  openArtifactSource,
  readRecentArtifactIds,
  resolveArtifactSourceLabel,
  themeNameOf,
} from "../components/artifacts";
import { EmptyState, PageHeader } from "../components/common";
import { ARTIFACT_SOURCE_TYPE_LABELS } from "../domain-model/labels";
import type { Artifact, ArtifactSourceType, PageProps } from "../types";

type SortOrder = "newest" | "oldest" | "recent_opened" | "name";
type TypeFilter = "all" | "image" | "spreadsheet" | "pdf" | "markdown" | "presentation" | "other";

interface ArtifactsPrefs {
  themeId: string;
  sourceType: "all" | ArtifactSourceType;
  typeFilter: TypeFilter;
  sortOrder: SortOrder;
}

const DEFAULT_PREFS: ArtifactsPrefs = {
  themeId: "all",
  sourceType: "all",
  typeFilter: "all",
  sortOrder: "newest",
};

const TYPE_FILTER_LABELS: Record<TypeFilter, string> = {
  all: "すべて",
  image: "画像",
  spreadsheet: "表計算",
  pdf: "PDF",
  markdown: "Markdown",
  presentation: "資料",
  other: "その他",
};

function matchesTypeFilter(artifact: Artifact, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  const type = (artifact.file_type || "").toLowerCase();
  if (filter === "image") return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(type);
  if (filter === "spreadsheet") return ["xlsx", "xls", "csv", "tsv"].includes(type);
  if (filter === "pdf") return type === "pdf";
  if (filter === "markdown") return ["md", "markdown"].includes(type);
  if (filter === "presentation") return ["pptx", "ppt"].includes(type);
  return !["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "xlsx", "xls", "csv", "tsv", "pdf", "md", "markdown", "pptx", "ppt"].includes(type);
}

export function ArtifactsPage({
  data,
  themes,
  openDrawer,
  removeEntity,
  setToast,
}: PageProps) {
  const [query, setQuery] = useState("");
  const [recentTick, setRecentTick] = useState(0);
  const [prefs, setPrefs] = usePersistentState<ArtifactsPrefs>("artifacts:prefs:v1", DEFAULT_PREFS);
  const updatePrefs = (patch: Partial<ArtifactsPrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const recentIds = useMemo(() => readRecentArtifactIds(), [data.artifacts, recentTick]);
  const recentRank = useMemo(() => new Map(recentIds.map((id, index) => [id, index])), [recentIds]);

  const artifacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.artifacts || [])
      .filter((artifact) => {
        if (prefs.themeId !== "all" && String(artifact.theme_id || "") !== prefs.themeId) return false;
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
        ].join(" ").toLowerCase();
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
  const filterActive = prefs.themeId !== "all" || prefs.sourceType !== "all" || prefs.typeFilter !== "all" || Boolean(query.trim());

  async function showInFolder(artifact: Artifact) {
    const result = await workspaceApi.showItemInFolder(artifact.stored_path);
    if (!result.ok) setToast(`フォルダを開けませんでした。${result.error || ""}`, "danger");
  }

  async function copyPath(artifact: Artifact) {
    await workspaceApi.copyText(artifact.stored_path);
    setToast("ファイルのパスをコピーしました。", "success");
  }

  function copyList() {
    const header = "ファイル名\t種類\tTheme\t元Entity\t作成日\tパス";
    const rows = artifacts.map((artifact) => [
      artifact.filename,
      artifact.file_type || "",
      themeNameOf(artifact, data),
      `${ARTIFACT_SOURCE_TYPE_LABELS[artifact.source_type] || artifact.source_type}:${resolveArtifactSourceLabel(artifact, data)}`,
      artifact.created_at ? new Date(artifact.created_at).toLocaleDateString("ja-JP") : "",
      artifact.stored_path,
    ].join("\t"));
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("成果物一覧をコピーしました。", "success"));
  }

  return (
    <div className="page artifacts-page">
      <PageHeader
        title="成果物"
        subtitle="AI作業や調査から生まれたExcel・画像・PDF・Markdownなどの実ファイル。メモ本文・URL・Chat参照とは役割が違います。"
      >
        <button className="secondary-button" onClick={copyList} disabled={!artifacts.length}>一覧をコピー</button>
      </PageHeader>

      <section className="panel artifact-role-panel" aria-label="役割の整理">
        <div className="artifact-role-grid">
          <div><strong>Notes</strong><span>自分で書く本文</span></div>
          <div><strong>Resources</strong><span>URL / 外部参照</span></div>
          <div><strong>Chat Refs</strong><span>会話の入口</span></div>
          <div><strong>Artifacts</strong><span>実ファイル成果物</span></div>
        </div>
      </section>

      <div className="filter-bar panel artifacts-filter-bar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ファイル名・元Entity・Themeで検索"
          aria-label="成果物を検索"
        />
        <select
          value={prefs.themeId}
          onChange={(event) => updatePrefs({ themeId: event.target.value })}
          aria-label="Themeで絞り込み"
        >
          <option value="all">Theme: すべて</option>
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>{theme.name}</option>
          ))}
        </select>
        <select
          value={prefs.sourceType}
          onChange={(event) => updatePrefs({ sourceType: event.target.value as ArtifactsPrefs["sourceType"] })}
          aria-label="元Entityで絞り込み"
        >
          <option value="all">元: すべて</option>
          {Object.entries(ARTIFACT_SOURCE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={prefs.typeFilter}
          onChange={(event) => updatePrefs({ typeFilter: event.target.value as TypeFilter })}
          aria-label="種類で絞り込み"
        >
          {Object.entries(TYPE_FILTER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
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
        <EmptyState title="成果物はまだありません" />
      ) : !artifacts.length ? (
        <div className="empty-state">
          <strong>条件に合う成果物がありません</strong>
          {filterActive && (
            <button
              className="secondary-button compact"
              onClick={() => {
                setQuery("");
                setPrefs(DEFAULT_PREFS);
              }}
            >
              フィルタを解除
            </button>
          )}
        </div>
      ) : (
        <ul className="artifact-list artifact-page-list">
          {artifacts.map((artifact) => (
            <li className="artifact-row artifact-page-row" key={artifact.id}>
              <span className="artifact-row-icon" aria-hidden="true"><ArtifactFileIcon fileType={artifact.file_type} /></span>
              <div className="artifact-row-name">
                <strong title={artifact.stored_path}>{artifact.filename}</strong>
                <small>
                  {[
                    (artifact.file_type || "file").toUpperCase(),
                    formatArtifactFileSize(artifact.file_size),
                    themeNameOf(artifact, data),
                    `${ARTIFACT_SOURCE_TYPE_LABELS[artifact.source_type] || artifact.source_type}: ${resolveArtifactSourceLabel(artifact, data)}`,
                    artifact.created_at ? new Date(artifact.created_at).toLocaleDateString("ja-JP") : "",
                  ].filter(Boolean).join(" / ")}
                </small>
              </div>
              <span className="artifact-row-actions">
                <button
                  className="text-button compact"
                  title={artifactOpenHint(artifact.file_type)}
                  onClick={() => {
                    void openArtifactFile(artifact, setToast).then(() => setRecentTick((value) => value + 1));
                  }}
                >
                  <IconExternalLink size={14} />{artifactOpenLabel(artifact.file_type)}
                </button>
                <button className="text-button compact" onClick={() => void showInFolder(artifact)}>
                  <IconFolderOpen size={14} />フォルダ
                </button>
                <button className="text-button compact" onClick={() => void copyPath(artifact)}>
                  <IconCopy size={14} />パス
                </button>
                <button
                  className="text-button compact"
                  onClick={() => {
                    if (!openArtifactSource(artifact, data, openDrawer)) {
                      setToast("元の場所が見つかりませんでした。削除済みの可能性があります。", "warning");
                    }
                  }}
                >
                  <IconLink size={14} />元へ
                </button>
                <button className="text-button compact is-danger" onClick={() => removeEntity("artifact", artifact)}>
                  <IconTrash size={14} />削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasAny && (
        <p className="field-help artifact-page-help">
          追加はChat参照・タスク・メモ・Themeの詳細から「成果物を追加」またはドラッグで行います。保存先はSettingsのArtifact保存先です。
        </p>
      )}
    </div>
  );
}
