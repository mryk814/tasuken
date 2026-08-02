# Tasken surface model

## 決定

Taskenは「何を書くか」ではなく、編集単位と操作モデルで3つの面を分ける。

| 面 | 正本 | 主な操作 | 関係 |
|---|---|---|---|
| Note | 構造化されたMarkdown本文 | 読む、段落を編集する、参照を並べる | SketchをID参照で埋め込む利用側 |
| Page Sketch | `Sketch.document`の有限ページ | 手書き、図解、ページ送り、印刷向けExport | Sketchエンティティの`mode: page` |
| Infinite Canvas | `Sketch.document`の拡張可能ページ | 空間配置、俯瞰、パン・ズーム | Sketchエンティティの`mode: infinite` |

Page SketchとInfinite Canvasは、現時点では同じオブジェクト種別、保存、検索、Theme関連付け、削除、Exportを共有する。このため別テーブルや別エンティティを作らず、既存の`Sketch.document.mode`を境界にする。ライフサイクル、権限、検索単位、Export形式のいずれかが将来分かれた時点で、schema version付きmigrationとして再検討する。

## 参照の原則

- Note本文へ軌跡や画像のコピーを保存しない。`tasken-sketch:<sketch-id>/<page-id>`参照を保存する。
- Note上の表示画像はSketch正本から生成する。参照を開くと同じSketchの同じページを編集する。
- Sketchを複数のNoteから参照しても編集正本は1つ。書き出したPNG・SVG・Markdownは派生物である。
- 削除済みSketchへの参照は本文から消さず、参照切れとして表示し復元経路を残す。

## ローカルファーストの製品原則

- アカウント登録、クラウド同期、常時接続を主要操作の条件にしない。
- SQLite Repositoryを唯一の書き込み経路にし、SnapshotとExport/Importの往復性を維持する。
- AI連携は画像と指示のクリップボード往復を標準とし、外部APIキーを必須にしない。
- オンライン機能を将来追加しても、ローカル正本を置き換えず任意の派生・同期経路として設計する。

## 参考製品から採用する考え方

GoodnotesがNotebook、Whiteboard、Text Documentを同じ製品内の別形式として扱う構成は、面ごとの操作モデルを明示する参考になる。一方、TaskenではNoteとSketchを同じ描画文書へ統合しない。Noteの構造編集とSketchの直接操作を保ち、参照で往復できることを個性にする。

画面の色や配置は模倣せず、次の操作文法だけを採用する。

- 選択中の道具をアイコンと背景の2要素で明示する。
- 道具を選ぶと、その道具固有の色・太さ・種類だけを近くへ出す。
- ペン、蛍光ペン、消しゴムはそれぞれ最後の設定を覚える。
- PageとInfiniteで同じ道具アイコンと直接操作を維持する。

## 変更しない互換条件

1. 既存のschema version 1 Sketchはそのまま読める。
2. `mode`省略時はPageとして読む。
3. 既存のNote埋め込み参照とSnapshot形式を変えない。
4. 図形種類の追加は既存shape unionの拡張とし、保存形式のmigrationを要求しない。
5. 書き出しは派生処理であり正本を変更しない。
