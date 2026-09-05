# Tasuken app charter

## アプリの性格

- 主性格: 個人用の研究・業務ワークスペース（作業ツール）
- 部分性格: Sketchだけはキャンバス系。キャンバス内の紙面とインク色を先に設計し、周辺クロームは共通デザイントークンへ従う
- 中心価値: タスクを消すことではなく、研究開発活動の現在地と考えた過程を失わないこと
- 日常の役割: ローカルで行った作業と成果文書を集め、OneDrive上の読める文章からM365 Copilotと利用者が仕事を振り返れるようにする。AI Packを使うことは前提にしない。
- 通常のNote・日誌は保存先で参照範囲を決める。Taskenに項目別の公開・非公開設定を要求せず、不要なNoteは削除して対応するMarkdownも取り除く。Undoでは対応ファイルも復元する。
- 出力の役割と改善方針は [`work-record-publication.md`](./work-record-publication.md) に記録する。

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

## Androidの日常利用（2026-09-05）

- DesktopのTask・Theme・Captureの意味と見た目を骨格とし、スマホでは短い操作で記録・確認・完了できるようにする。
- 主な利用画面はGalaxy Z Fold7のカバー画面。Galaxy S23を実機検証、専用エミュレーターを狭幅・展開時の検証に使う。
- 右手での片手操作を優先する。頻用操作は右側・下側に置き、詳細の完了操作はスクロールしても下端から使えるようにする。
- 利用者がS23で示した可動範囲と黄金ゾーンは[`android-thumb-reach.md`](./android-thumb-reach.md)を参照する。画面全体の割合で評価し、下端ならすべて押しやすいとは扱わない。
- Taskはタイトルだけで完結してよい。本文やThemeを必須にせず、音声入力でも認識結果を確認してから既存の保存経路へ送る。
- 音声の転記からタイトル・Theme・予定・チェック項目・補足を整理する用途に限り、利用者の許可に基づくLLM API連携を設ける。元の発話を保ち、整理案の確認・修正・採用後に既存のCreateTask経路で保存する。Taskの本文には補足と元の発話を残し、Androidへ再読み込みできる。
- 推論はDesktop側のGatewayから呼び出す。OpenAI、Azure OpenAI、Gemini、OpenCode Zen／Goの接続情報・モデル・APIキーはDesktopプロセスの環境変数で指定し、AndroidやDB・ソースコードへキーを保存しない。
- 外部APIへ渡す業務データは当該入力の転記テキストとTheme候補のID・名称に限定する。相対日付の基準となる入力日時・タイムゾーンと選択中のTheme IDを併送する。音声データや既存Task・Noteの本文は送らない。
- 未設定・オフライン・推論失敗時も入力を保ち、通常の追加を続けられるようにする。整理案は自動確定せず、利用者が採用するまで正式データを変更しない。

## アクセント

- 共通のburgundyアクセントを維持する
- Sketchの紙面内では黒・青・burgundy・orangeをインク色として使う。danger等の状態色とは意味を混ぜない

## Sketchの境界契約

1. Ink Captureは素早い入口であり、保存後は通常のSketchとして同じ編集面に到達する。
2. SketchはSidebarのKnowledge配下に独立した棚と編集面を持ち、Markdown本文へ生の軌跡データを埋め込まない。
3. NoteはSketchの派生画像を参照する利用側とし、編集可能な正本はSketch棚へ残す。現在のPNG添付＋`derived_from`参照は、Note側から埋め込んで再編集できる経路へ置換するまでの既存契約とする。
4. Sketchの推論実行はCodex等の外部Agentへ委ねる。SketchにLLM APIキー、provider設定、model選択、streaming実行を持たない。Androidの入力整理だけは上記の限定API連携を例外とする。
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
