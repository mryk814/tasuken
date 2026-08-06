/**
 * Noteの正本Markdownを更新するときの判断（#291）。
 *
 * 通常のMarkdownは「毎回生成する出力物」ではなく、Note本文のポータブルな正本ファイル。
 * 保存のたびに新しいファイルやArtifactを増やさず、同じ `.md` を更新し続ける。
 *
 * ここはファイルI/Oをせず、判断だけを持つ（node:fsに依存しない）。
 * 実際の読み書きは Main 側が行う。
 */

/** 本文の同一性を見るための軽い署名。ハッシュの厳密さより、取り違えないことを優先する。 */
export function markdownSignature(content) {
  const text = String(content ?? "");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `${text.length}:${hash.toString(36)}`;
}

/**
 * 正本Markdownを書き込んでよいかを決める（#291）。
 *
 * Tasken外（別端末・エディタ・OneDriveの競合コピー）でファイルが変わっていることがある。
 * 保存前に、前回書いた内容の署名と、いまのファイルの署名を比べる。
 * 食い違えば黙って上書きせず、利用者へ選ばせる。
 *
 * @returns {{ action: "write" }
 *   | { action: "skip", reason: "unchanged" }
 *   | { action: "confirm", reason: "external_change", externalSignature: string }
 *   | { action: "unavailable", reason: "missing_path" | "root_unavailable" }}
 */
export function planCanonicalMarkdownWrite({
  canonicalPath = "",
  nextContent = "",
  lastWrittenSignature = "",
  currentFileSignature = null,
  fileExists = true,
  rootAvailable = true,
} = {}) {
  if (!String(canonicalPath || "").trim()) return { action: "unavailable", reason: "missing_path" };
  // ルートが一時的に見えない（OneDrive未同期・ネットワークドライブ等）ときは、
  // 失敗ではなく保留にして再試行できるようにする。内部の保存は先に確定させる。
  if (!rootAvailable) return { action: "unavailable", reason: "root_unavailable" };

  const nextSignature = markdownSignature(nextContent);

  // ファイルが消えている場合は作り直す。外部変更として止めない。
  if (!fileExists) return { action: "write" };

  if (currentFileSignature != null && lastWrittenSignature && currentFileSignature !== lastWrittenSignature) {
    // 前回Taskenが書いた内容と、いまのファイルが違う = 外部で変更された。
    // 内容がたまたま同じなら、わざわざ確認を出さない。
    if (currentFileSignature === nextSignature) return { action: "skip", reason: "unchanged" };
    return { action: "confirm", reason: "external_change", externalSignature: currentFileSignature };
  }

  if (currentFileSignature != null && currentFileSignature === nextSignature) {
    return { action: "skip", reason: "unchanged" };
  }
  return { action: "write" };
}

/**
 * 保存済み表示（#291）。
 * Tasken内部とファイルの両方を反映し、片方だけ成功した状態を「保存済み」に見せない。
 */
export function noteSaveStateLabel({ internalSaved = false, fileState = "none" } = {}) {
  if (!internalSaved) return "保存中…";
  switch (fileState) {
    case "synced":
      return "すべての変更を保存しました";
    case "pending":
      return "Taskenへ保存しました。Markdownの更新を待っています";
    case "external_change":
      return "Taskenへ保存しました。Markdownが外部で変更されています";
    case "failed":
      return "Taskenへ保存しましたが、Markdownを更新できませんでした";
    case "none":
    default:
      // 正本Markdownをまだ持たないNote。ファイル状態を語らない。
      return "保存しました";
  }
}

/** 通常保存で正本Markdownを更新しただけのときは、Artifactを増やさない（#291）。 */
export function shouldCreateExportArtifact(format) {
  return String(format || "") !== "markdown";
}
