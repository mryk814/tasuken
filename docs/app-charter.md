# Tasuken app charter

## アプリの性格

- 主性格: 個人用の研究・業務ワークスペース（作業ツール）
- 部分性格: Sketchだけはキャンバス系。キャンバス内の紙面とインク色を先に設計し、周辺クロームは共通デザイントークンへ従う
- 中心価値: タスクを消すことではなく、研究開発活動の現在地と考えた過程を失わないこと

## データの重さ

- Tasukenが正本データを所有するローカルファーストアプリ
- SQLite Repositoryを唯一の書き込み経路とする
- Snapshot / Import / Exportの往復性を保つ
- 通常起動時の自動Snapshotを既定で有効にし、Settingsから保存先・世代数・最新結果を確認できるようにする
- Sketchはレンダリング画像ではなく編集可能なオブジェクト文書を正本とする。画像・Markdown・AI向けデータは派生物

## 利用者と配布

- 主利用者: Windows 11上で研究・業務を進める個人
- 入力機器: マウス、タッチ、板タブレット、ペン対応モバイルモニター
- 配布: ElectronのWindows installer / portable
- 利用条件: アカウント作成・クラウド同期・常時接続を要求しない。主要な作成・編集・検索・書き出しはオフラインで完結する

## アクセント

- 共通のburgundyアクセントを維持する
- Sketchの紙面内では黒・青・burgundy・orangeをインク色として使う。danger等の状態色とは意味を混ぜない

## Sketchの境界契約

1. Ink Captureは素早い入口であり、保存後は通常のSketchとして同じ編集面に到達する。
2. SketchはSidebarのKnowledge配下に独立した棚と編集面を持ち、Markdown本文へ生の軌跡データを埋め込まない。
3. NoteはSketchの派生画像を参照する利用側とし、編集可能な正本はSketch棚へ残す。現在のPNG添付＋`derived_from`参照は、Note側から埋め込んで再編集できる経路へ置換するまでの既存契約とする。
4. TaskenはContextの選択・Preview・生成を担い、推論実行はCodex等の外部Agentへ委ねる。LLM APIキー、provider設定、model選択、streaming実行をアプリ内に持たない。
5. 既存のNotes・Snapshot・Import/Export形式を壊さず、Sketchを追加コレクションとして扱う。
6. PageとInfiniteは同じ編集可能オブジェクト文書の表示モードであり、ライフサイクルが分かれるまでは別テーブル・別エンティティへ分裂させない。

## AI書き込みの境界契約

1. MCPと手動Importはいずれも正式Entityを直接変更せず、`ai_proposal`を作る。
2. 外部AgentによるNote編集は対象IDと`base_version`を固定する。採用は差分hunk単位で選べる。
3. Sketch/SVG/ArtifactはPreview後だけ保存する。SVGは許可要素だけのinline内容とし、script・event属性・外部参照を拒否する。
4. Artifact Proposalは任意パスを受け取らず、許可したinline contentをmanaged保存先へ新規ファイルとして作る。
5. Agent接続失敗、Proposal検証失敗、保存失敗では既存Noteと入力途中の値を変更しない。

## Contextの境界契約

1. Theme Charterは「なぜ続けるか」、Theme Stateは「いま何を考えているか」、Session / Activityは「何が起きたか」と役割を分ける。
2. Taskはタイトルだけで成立し、任意の`description`を短いContext / memoとして使える。構造化入力を必須にしない。
3. MCPへは正本を丸ごと渡さず、Work / Planning / Debrief / Learningの用途別bounded projectionを返す。
4. Context Viewはread-onlyとし、AIがTheme State、Human reflection、Learning Historyを直接確定しない。
5. 詳細契約の正本は[`tasken-context-architecture.md`](./tasken-context-architecture.md)とする。
