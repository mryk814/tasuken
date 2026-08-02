# Goodnotes reference audit for Tasken Sketch

## Evidence

2026-08-02に利用者が提供したWindows版Goodnotesのスクリーンショット2枚を、再配布せずローカルで確認した。

1. Notebook: 有限紙面、上部の共通ツールバー、選択中のペン直下に浮く道具固有パレット。
2. Whiteboard: 無限キャンバスでも同じツールアイコンと道具固有パレットを維持し、右下にZoomを置く。

公式情報も併せて確認した。

- [Goodnotes Whiteboard](https://www.goodnotes.com/tools/whiteboard)
- [Whiteboard support](https://support.goodnotes.com/hc/en-us/articles/13693350308751-Whiteboard)
- [Text Document](https://support.goodnotes.com/hc/en-us/articles/13692184123279-Text-Document)
- [Text Tool](https://support.goodnotes.com/hc/en-us/articles/7353727615375-Type-text-with-the-Text-Tool)

## Findings

### 採用

- 全体ナビゲーションとキャンバス道具を分ける。
- 選択中の道具と設定群を視覚的に一体化する。
- 色名やpx数だけでなく、太さを見た目のサンプルで選べるようにする。
- PageとInfiniteで道具の場所・アイコン・操作を共通化する。
- テキストは同じ面の上で作成し、再選択して編集する。

### Taskenとして変える

- Goodnotesの青いクロームや黒い浮動パレットはコピーせず、Taskenのburgundyと既存トークンを使う。
- Notebook、Whiteboard、Text Documentをそのまま製品分類にしない。TaskenはNoteを構造本文、Page/InfiniteをSketchの2モードとする。
- アカウントやオンライン機能へ依存せず、ローカル正本とクリップボードAI連携を維持する。
- SketchをNoteへコピーするのでなく参照として埋め込み、どちらの入口からも同じ正本を再編集する。

## Accessibility and interaction health

- 選択中の道具は色だけでなく`aria-pressed`と背景・アイコンで示す。
- 色ボタンには色値のaccessible name、太さにはpx値のradio semanticsを付ける。
- レイヤー操作とテキスト再編集はアイコンだけでもtitleとaccessible nameを持つ。
- 直接操作のカーソルは移動とリサイズで切り替える。

## Limits

- スクリーンショットだけではGoodnotesの筆圧曲線、遅延、アクセシビリティ実装、永続化形式は判断しない。
- Taskenの比較対象は視覚的な完全一致ではなく、道具選択から設定、作成、再編集までの迷いの少なさである。
