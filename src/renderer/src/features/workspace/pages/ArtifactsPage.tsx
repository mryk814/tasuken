import { useMemo, useState } from "react";

import { workspaceApi } from "../../../services/workspaceApi";
import { usePersistentState } from "../../../utils/usePersistentState";
import {
  ArtifactCard,
  readRecentArtifactIds,
  resolveArtifactSourceLabel,
  themeNameOf,
} from "../components/artifacts";
import { EmptyState, PageHeader } from "../components/common";
import { ARTIFACT_SOURCE_TYPE_LABELS } from "../domain-model/labels";
import type { ArtifactSourceType, PageProps } from "../types";

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

function matchesTypeFilter(artifact: { file_type?: string }, filter: TypeFilter): boolean {
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
    workspaceApi.copyText([header, ...rows].join("\n")).then(() => setToast("Artifact 一覧をコピーしました。", "success"));
  }

  return (
    <div className="page artifacts-page">
      <PageHeader
        title="Artifacts"
        subtitle="AI作業や調査から生まれた Excel・画像・PDF・Markdown などの実ファイル。メモ本文・URL・Chat Refs とは役割が違います。"
      >
        <button className="secondary-button" onClick={copyList} disabled={!artifacts.length}>一覧をコピー</button>
      </PageHeader>

      <section className="panel artifact-role-panel" aria-label="役割の整理">
        <div className="artifact-role-grid">
          <div><strong>Notes</strong><span>自分で書く本文</span></div>
          <div><strong>Resources</strong><span>URL / 外部参照</span></div>
          <div><strong>Chat Refs</strong><span>会話の入口</span></div>
          <div><strong>Artifacts</strong><span>実ファイル</span></div>
        </div>
      </section>

      <div className="filter-bar panel artifacts-filter-bar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ファイル名・元Entity・Themeで検索"
          aria-label="Artifact を検索"
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
        <EmptyState title="Artifact はまだありません" />
      ) : !artifacts.length ? (
        <div className="empty-state">
          <strong>条件に合う Artifact がありません</strong>
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
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              data={data}
              openDrawer={openDrawer}
              removeEntity={removeEntity}
              setToast={setToast}
              showSource
              onOpened={() => setRecentTick((value) => value + 1)}
            />
          ))}
        </ul>
      )}

      {hasAny && (
        <p className="field-help artifact-page-help">
          追加は Chat Refs・Task・Note・Theme の詳細から「Artifact を追加」またはドラッグで行います。保存先は Settings の Artifact 保存先です。
        </p>
      )}
    </div>
  );
}
