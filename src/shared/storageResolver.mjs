/**
 * 保存先の解決を一箇所へ集約する（#306）。
 *
 * 保存処理ごとにpathを組み立てると、用途が増えるたびに保存先設定と分岐が増え、
 * 同じ用途のファイルが複数フォルダへ散る。設定は原則「Tasken同期ルート」一つに集約し、
 * 配下の用途別・Theme別フォルダはTaskenが規定構成で自動生成する。
 *
 * Themeだけは例外として専用ルートを持てる。既存の案件・顧客フォルダへ合わせたり、
 * 共有範囲をTheme単位で分けたりするため。
 *
 * この関数はpathを組み立てるだけで、ファイルI/Oはしない（node:fsに依存しない）。
 */

import { canonicalThemeId, isPersonalDefaultThemeId } from "./themeRef.mjs";

/** 標準サブフォルダ。利用者へ細かい設定を公開せず、ここで最小限に固定する。 */
export const STORAGE_SUBFOLDERS = {
  notes: "Notes",
  artifacts: "Artifacts",
  exports: "Exports",
  ai_pack: "AI Pack",
  activity: "Activity",
};

/** Themeフォルダに置くmarker。Theme名を変えてもIDとの対応を見失わないようにする。 */
export const THEME_FOLDER_MANIFEST = ".tasken-theme.json";
export const THEME_FOLDER_MANIFEST_SCHEMA = "tasken-theme-folder/v1";

export function buildThemeFolderManifest({ themeId, displayName }) {
  return {
    schema: THEME_FOLDER_MANIFEST_SCHEMA,
    themeId: String(themeId || ""),
    displayName: String(displayName || ""),
  };
}

/** manifestが指すThemeか。Theme名の一致では判定しない。 */
export function themeFolderManifestMatches(manifest, themeId) {
  if (!manifest || manifest.schema !== THEME_FOLDER_MANIFEST_SCHEMA) return false;
  return String(manifest.themeId || "") === String(themeId || "");
}

export function safeFolderSegment(value, fallback = "theme") {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function subfolderFor(purpose) {
  return STORAGE_SUBFOLDERS[purpose] || STORAGE_SUBFOLDERS.artifacts;
}

/**
 * 保存先を解決する（#306）。
 *
 * 優先順位:
 * 1. 既存canonical path  … すでに正本の場所が決まっているファイルは動かさない
 * 2. 明示的なExport先    … PDF等、提出先が用途ごとに違うものだけ都度選ばせる
 * 3. Theme専用ルート     … Themeが自分のフォルダを持つ場合
 * 4. アプリ共通sync root … 通常の保存。配下はTaskenが自動生成する
 * 5. 未設定             … needs_root。内部データは失わせず、保存だけ保留する
 *
 * 選ばれた根拠を `source` として返す。どの設定が効いたのか画面から説明できるようにする。
 *
 * @returns {{ status: "ok", root: string, segments: string[], source: string }
 *   | { status: "needs_root" }}
 */
export function resolveStorageLocation({
  purpose = "artifacts",
  themeId = null,
  themeRef = null,
  themeCode = null,
  themeStorageRoot = null,
  syncRoot = null,
  canonicalPath = null,
  explicitExportRoot = null,
  isPersonalDefaultTheme = false,
} = {}) {
  const canonical = String(canonicalPath || "").trim();
  if (canonical) return { status: "ok", root: canonical, segments: [], source: "canonical" };

  const explicit = String(explicitExportRoot || "").trim();
  if (explicit) return { status: "ok", root: explicit, segments: [], source: "explicit_export" };

  const subfolder = subfolderFor(purpose);

  const themeRoot = String(themeStorageRoot || "").trim();
  // Theme専用ルート配下でも標準サブフォルダはTaskenが作る。利用者に構成を作らせない。
  if (themeRoot) return { status: "ok", root: themeRoot, segments: [subfolder], source: "theme_override" };

  const base = String(syncRoot || "").trim();
  if (!base) return { status: "needs_root" };

  const id = canonicalThemeId(themeRef?.id ?? themeId);
  // 既定Theme「個人業務」（#282）は案件フォルダを増やさず、Inboxへまとめる。
  if (!id || isPersonalDefaultTheme || isPersonalDefaultThemeId(id)) {
    return {
      status: "ok",
      root: base,
      segments: subfolder === STORAGE_SUBFOLDERS.artifacts ? ["Inbox"] : ["Inbox", subfolder],
      source: "app_default",
    };
  }
  return {
    status: "ok",
    root: base,
    segments: ["Themes", safeFolderSegment(themeCode || id), subfolder],
    source: "app_default",
  };
}

/** 解決の根拠を画面へ出すための日本語ラベル（内部コードを表示しない）。 */
export const STORAGE_SOURCE_LABELS = {
  canonical: "既存の保存場所",
  explicit_export: "書き出し時に指定",
  theme_override: "Theme専用フォルダ",
  app_default: "Tasken同期ルート",
};
