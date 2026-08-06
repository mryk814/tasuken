/**
 * このウィンドウが本体か、切り離したNote編集ウィンドウかを決める（#290）。
 *
 * 切り離しウィンドウは本体と同じrenderer（index.html）をクエリ付きで開く。
 * Editorを二重に実装しないので、Edit / Preview / Raw、検索・置換、画像、Mermaidが
 * そのまま動き、保存経路も同じ正本を通る。違いは外枠（Sidebar・Context Pane・
 * ナビゲーション）を出すかどうかだけ。
 */

export type WindowMode =
  | { kind: "main" }
  | { kind: "note"; noteId: string };

export function parseWindowMode(search: string): WindowMode {
  const params = new URLSearchParams(search);
  const noteId = params.get("noteId")?.trim();
  if (params.get("window") === "note" && noteId) return { kind: "note", noteId };
  return { kind: "main" };
}

export function currentWindowMode(): WindowMode {
  if (typeof window === "undefined") return { kind: "main" };
  return parseWindowMode(window.location.search);
}
