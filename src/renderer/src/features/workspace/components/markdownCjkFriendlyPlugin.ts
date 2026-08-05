import { addSyntaxExtension$, realmPlugin } from "@mdxeditor/editor";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { gfmStrikethroughCjkFriendly } from "micromark-extension-cjk-friendly-gfm-strikethrough";

/**
 * Editor 内の強調・取り消し線の判定を Preview / PDF と揃える（#285）。
 *
 * 素の CommonMark は `文章中の**（重要）**です` のように約物が `**` の内側、
 * 日本語文字が外側に来る並びを強調と認識しない。lib/markdown.ts の
 * parseMarkdownBody と同じ拡張を Editor 側へも入れて、同じ Markdown が
 * Editor・Preview・PDF で同じ結果になるようにする。
 */
export const markdownCjkFriendlyPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addSyntaxExtension$]: [cjkFriendlyExtension(), gfmStrikethroughCjkFriendly()],
    });
  },
});
