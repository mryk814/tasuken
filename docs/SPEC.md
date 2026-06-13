# 研究開発職向け タスク・長期スケジュール・メモ管理アプリ 仕様ドラフト v0.1

## 1. コンセプト

本アプリは、メーカー研究職・研究開発職が複数の研究テーマや業務テーマを抱える中で、長期的な予定、マイルストーン、タスク、メモ、成果物リンク、AIとの壁打ち結果を一元的に管理するための個人向け業務管理アプリである。

一般的なToDoアプリやカレンダーでは拾いにくい、以下のような情報を扱うことを目的とする。

* 複数テーマの長期的な流れ
* 年間・四半期・月間レベルの大きな予定
* 報告会、レビュー、実験結果到着、顧客対応などのマイルストーン
* 予定のズレ、前倒し、遅延
* 誰か・何かを待っている状態
* 研究メモ、意思決定メモ、会議メモ、AI壁打ちメモ
* SharePoint、OneDrive、Teams、Outlook、ChatGPT、Copilot、ローカルファイルなどへのリンク
* 外部AIに渡しやすい構造化されたエクスポート
* 外部AIがまとめた予定・タスク・メモのインポート

本アプリの中心は「タスクを消すこと」ではなく、「研究開発活動の現在地を失わないこと」である。

## 2. 想定ユーザー

主な想定ユーザーは、一般メーカーの研究職・研究開発職である。

特に以下のような人を想定する。

* 複数の研究テーマ・業務テーマを並行して抱えている
* 各テーマの細かい予定はOutlookやTeamsに存在している
* しかし、長期的な全体像やマイルストーンを忘れがちである
* 会議、実験、解析、資料作成、他部署待ちなどが混在している
* ChatGPTやCopilotなどで頻繁に壁打ちしている
* AIとのやり取りや学びが流れて消えてしまうことに課題を感じている
* ガントチャートで長期予定を俯瞰したい
* ただし、本格的なプロジェクト管理ツールほど重い運用はしたくない

## 3. 基本方針

### 3.1 仕事向けを主軸にする

本アプリは基本的に仕事用である。

家庭、趣味、学習、個人開発などにも使える余地は残すが、それらは主目的ではない。
設計としては、仕事内の複数テーマを扱うことを最優先する。

### 3.2 入力は軽くする

研究開発の業務では、メモやタスクを思いついた瞬間に残せることが重要である。

そのため、タスクやメモの作成時に細かい分類を強制しない。
まずは雑に入れられることを優先し、分類や紐づけは後から行えるようにする。

### 3.3 長期の時間感覚を重視する

本アプリのガントチャートは、日々の細かい予定管理ではなく、長期的な流れを把握するためのものである。

具体的には、年間、半期、四半期、月間、週間などの時間スケールを切り替えながら、マイルストーンや大きな予定を俯瞰できることを重視する。

### 3.4 メモを第一級オブジェクトとして扱う

メモはタスクの補足ではなく、独立した重要な情報として扱う。

研究メモ、意思決定メモ、会議メモ、AI壁打ちメモ、学習メモなどを蓄積し、後から検索・参照・タスク化できるようにする。

### 3.5 AIフレンドリーな入出力を重視する

本アプリ自体に高度なAI機能を内蔵することは必須ではない。

一方で、外部AIに渡しやすい形式でエクスポートできること、外部AIが作成した構造化データをインポートできることを重視する。

これにより、ChatGPT、Copilot、その他AIサービスを活用して、予定整理、タスク分解、会議メモ整理、週次レビュー作成などを外部で行えるようにする。

## 4. 本アプリで扱う情報

## 4.1 Theme

研究テーマ、業務テーマ、プロジェクト的なまとまりを表す。

例：

* 材料A評価
* 加工条件最適化
* AI活用検討
* 月次報告対応
* 顧客向け技術提案
* 研究所内プロジェクト

Themeは本アプリの主要な分類単位である。

## 4.2 Item

予定、タスク、マイルストーン、待ち状態、期間予定などをまとめて扱う汎用オブジェクト。

Itemの種類は以下を想定する。

* task：通常タスク
* milestone：マイルストーン
* period：期間を持つ予定
* event：会議・イベント
* waiting：待ち状態
* deliverable：成果物
* reminder：備忘
* idea：タスク化前のアイデア

## 4.3 Note

メモを表すオブジェクト。

Noteの種類は以下を想定する。

* memo：通常メモ
* decision：意思決定ログ
* meeting：会議メモ
* experiment：実験メモ
* analysis：解析メモ
* ai_chat：AI壁打ちメモ
* learning：学習メモ
* reflection：ふりかえり

## 4.4 Link

成果物、外部資料、AIチャット、会議、ファイルなどへのリンクを表す。

Linkの種類は以下を想定する。

* sharepoint
* onedrive
* teams
* outlook
* chatgpt
* copilot
* github
* local_file
* notebook
* paper
* folder
* other

## 4.5 Person

人に関する軽量な情報を扱う。

本格的な共同作業機能は不要。
ただし、以下のような情報は持てるようにする。

* 誰のタスクか
* 誰待ちか
* 誰に確認するか
* 誰からの回答待ちか

## 5. 中心機能

## 5.1 長期ガントチャート

本アプリの中核機能。

### 目的

複数テーマの長期予定を俯瞰し、重要なマイルストーンや予定のズレを忘れないようにする。

### 表示対象

* Theme
* Milestone
* Period
* Event
* Waiting
* Deliverable
* 大きめのTask

### 時間スケール

以下を切り替え可能にする。

* 年間
* 半年
* 四半期
* 月間
* 週間

### 必須表示

* 今日を示す縦線
* マイルストーン
* 期間バー
* テーマ別レーン
* 予定開始日・予定終了日
* 実績開始日・実績終了日
* 当初予定との差分
* 遅延・前倒し・オンタイムの状態

### 予定と実績

Itemには以下の日時情報を持たせる。

* baseline_start：最初に置いた開始予定
* baseline_end：最初に置いた終了予定
* planned_start：現在の開始予定
* planned_end：現在の終了予定
* actual_start：実際の開始日
* actual_end：実際の終了日
* due_date：締切日

これにより、以下を表現する。

* 当初予定から遅れている
* 当初予定より前倒しになった
* 予定を引き直した
* 実際にはまだ着手していない
* 実績としては完了済み
* 今日時点で危ない

### 操作性

ガントチャートでは以下の操作を重視する。

* バーのドラッグによる開始日・終了日の変更
* バー全体の移動
* マイルストーンの移動
* クリックで右サイドバーに詳細表示
* テーマ単位で折りたたみ
* 時間スケールのズーム切替
* 複数テーマの重なり確認

### 重要な利用イメージ

* 「この時期に大きい会議がある」
* 「この頃に実験結果が出る」
* 「このテーマとこのテーマの山場が重なっている」
* 「この待ち状態が長引くと後ろが詰まる」
* 「この報告会までに何が必要か」
* 「当初予定からどれくらいズレたか」

## 5.2 Theme Dashboard

Themeごとの現在地を確認する画面。

### 表示内容

* Theme名
* 概要
* 現在の状態
* 直近のマイルストーン
* 重要な予定
* 関連タスク
* 待ち状態
* 関連メモ
* 関連リンク
* 最近の更新
* 簡易ガント
* リスクや懸念のメモ

### 目的

複数テーマを抱えていると、「このテーマって今どうなってたっけ？」が発生する。
Theme Dashboardは、その問いにすぐ答えるための画面である。

## 5.3 Quick Capture

どの画面からでも素早く呼び出せる入力機能。

### 入力対象

* タスク
* メモ
* マイルストーン
* 待ち状態
* リンク
* AIインポート候補
* アイデア

### 方針

入力時点で完全に分類されている必要はない。
まずはInboxに入れ、後でThemeやItem種別を設定できるようにする。

### 入力例

```text
Aテーマ、7/1中間報告。6/20までに測定結果が来るはず。解析方針未確定。
```

このような自然文をまず保存できればよい。
自動分解やAI分類は後回しでもよい。

## 5.4 Notes

Obsidianのように、メモを蓄積できる機能。

### 必須機能

* Markdownで記録できる
* タイトルを持てる
* 本文検索ができる
* Themeに紐づけられる
* Itemに紐づけられる
* Linkを貼れる
* メモ種別を持てる
* 作成日時・更新日時を持てる

### 将来的に欲しい機能

* バックリンク
* タグ
* メモからタスク作成
* メモからマイルストーン作成
* AI壁打ちログの取り込み
* 関連メモ推薦

## 5.5 Links / Artifacts

成果物や外部情報へのリンクを管理する機能。

### 方針

成果物そのものをアプリ内に保存することは必須ではない。
多くの成果物はSharePoint、OneDrive、Teams、ローカルフォルダ、GitHubなどに存在するため、リンクで辿れることを重視する。

### 対象例

* PowerPoint資料
* Excelデータ
* Pythonノートブック
* 解析コード
* 実験データフォルダ
* SharePointページ
* OneDriveファイル
* Teams会議
* Outlookメール
* ChatGPT会話
* Copilot会話
* 論文PDF
* ローカルフォルダ

## 5.6 Waiting管理

「待ち」を明示的に管理する。

### 目的

研究開発の仕事では、自分が作業していない間も物事は進んだり止まったりする。
そのため、「誰待ち」「何待ち」「いつから待っているか」を見えるようにする。

### Waiting Itemが持つ情報

* 何を待っているか
* 誰を待っているか
* いつから待っているか
* いつ確認・催促するか
* 待ちが解除された後の次アクション
* 関連Theme
* 関連Item
* 関連Link

## 5.7 AI Import

外部AIが作成した構造化データをアプリに取り込む機能。

### 目的

Outlook、Teams、ChatGPT、CopilotなどをAIに読ませたり要約させたりした結果を、アプリに取り込めるようにする。

### 方針

OutlookやTeamsへの直接接続は、会社環境では制約がある可能性が高い。
そのため、まずは「AIが生成したJSON/YAML/Markdownを貼り付けて取り込む」方式を優先する。

### 必須機能

* JSONまたはYAMLを貼り付ける
* 内容をパースする
* 取り込み候補をプレビューする
* 既存Themeとの紐づけ候補を表示する
* 追加・更新・無視を選べる
* 実行後にImportBatchとして履歴を残す

### Import例

```yaml
items:
  - kind: milestone
    title: "Aテーマ 中間報告"
    theme: "Aテーマ"
    planned_start: "2026-07-01"
    planned_end: "2026-07-01"
    description: "部門レビューで進捗を報告する"

  - kind: waiting
    title: "測定結果の受領待ち"
    theme: "Aテーマ"
    waiting_for: "評価チーム"
    planned_end: "2026-06-20"
    description: "結果受領後に解析方針を決める"

notes:
  - note_type: ai_chat
    title: "AI壁打ち：Aテーマ解析方針"
    theme: "Aテーマ"
    body: "条件Bのばらつきは測定位置の影響を疑う。追加確認が必要。"
```

## 5.8 AI Export

外部AIに渡すためのエクスポート機能。

### 目的

アプリ内の現在状況をChatGPTやCopilotに渡し、要約、優先順位付け、タスク分解、報告文作成などを外部AIに依頼しやすくする。

### Export範囲

* 全体
* 特定Theme
* 今週
* 今月
* 次の30日
* 次の90日
* 未完了Item
* Waitingのみ
* 直近メモ
* ガント上のマイルストーン

### Export形式

* Markdown
* YAML
* JSON

### Export例

```markdown
# Current Work Context

## Theme: Aテーマ

### Current Status
- 中間報告が2026-07-01に予定されている
- 測定結果は2026-06-20に受領予定
- 解析方針は未確定

### Upcoming Milestones
- 2026-06-20 測定結果受領
- 2026-06-25 解析方針決定
- 2026-07-01 中間報告

### Waiting
- 評価チームから測定結果待ち

### Recent Notes
- 条件Bのばらつきが大きい
- 測定位置の影響を疑う
```

## 5.9 Stats

統計量は最初から作り込みすぎない。
運用しながら必要なものを確認する。

### 初期表示候補

* Theme別Item数
* 未完了Item数
* Waiting数
* 期限超過Item数
* 直近30日の完了Item数
* Theme別メモ数
* 直近更新されていないTheme
* 近いマイルストーン一覧

作業時間や見積もり精度などの高度な統計は後回しでよい。

## 6. 画面構成

## 6.1 基本レイアウト

以下のような3ペイン構成を基本とする。

* 左サイドバー：ナビゲーション
* 中央：メインビュー
* 右サイドバー：選択中オブジェクトの詳細

### 左サイドバー

* Inbox
* Timeline / Gantt
* Themes
* Notes
* Links
* Waiting
* AI Import / Export
* Stats
* Settings

### 中央メイン

選択した画面に応じた一覧、ガント、ダッシュボード、メモエディタを表示する。

### 右サイドバー

選択中のTheme、Item、Note、Linkの詳細を表示する。

表示内容例：

* タイトル
* 種別
* 状態
* Theme
* 予定日
* 実績日
* 関連メモ
* 関連リンク
* 関連Item
* 更新履歴

## 7. データモデル案

## 7.1 Theme

```text
Theme
- id
- name
- description
- status
- color
- created_at
- updated_at
```

## 7.2 Item

```text
Item
- id
- title
- kind
- theme_id
- status
- priority
- owner_person_id
- waiting_for_person_id
- baseline_start
- baseline_end
- planned_start
- planned_end
- actual_start
- actual_end
- due_date
- progress
- description
- created_at
- updated_at
- completed_at
```

### kind

```text
task
milestone
period
event
waiting
deliverable
reminder
idea
```

### status

```text
inbox
todo
doing
waiting
review
done
archived
cancelled
```

## 7.3 Note

```text
Note
- id
- title
- body_markdown
- note_type
- theme_id
- item_id
- source
- source_url
- created_at
- updated_at
```

### note_type

```text
memo
decision
meeting
experiment
analysis
ai_chat
learning
reflection
```

### source

```text
manual
chatgpt
copilot
outlook
teams
gmail
calendar
imported
other
```

## 7.4 Link

```text
Link
- id
- title
- url
- link_type
- theme_id
- item_id
- note_id
- description
- created_at
- updated_at
```

### link_type

```text
sharepoint
onedrive
teams
outlook
chatgpt
copilot
github
local_file
notebook
paper
folder
other
```

## 7.5 Person

```text
Person
- id
- name
- role
- organization
- note
- created_at
- updated_at
```

## 7.6 ImportBatch

```text
ImportBatch
- id
- source
- raw_text
- parsed_json
- status
- created_at
```

## 8. MVP範囲

## 8.1 MVPで作るもの

最初のバージョンでは、以下を作る。

* Theme作成・編集・削除
* Item作成・編集・削除
* Note作成・編集・削除
* Link作成・編集・削除
* Person作成・編集
* Quick Capture
* Inbox
* 長期ガントチャート
* Theme Dashboard
* Notes一覧・検索
* Waiting一覧
* AI Importプレビュー
* AI Export
* ローカル保存

## 8.2 MVPで後回しにするもの

以下は後回しにする。

* Outlook直接接続
* Teams直接接続
* Gmail直接接続
* Google Calendar直接接続
* 本格的な共同編集
* 通知機能
* 高度な統計
* AIによる自動分類
* AIによる自動要約
* 複雑な依存関係管理
* 本格的なカンバンビュー
* モーションや高度なアニメーション

## 9. 技術方針

まずはローカルで動くWebアプリとして実装する。

候補：

* React / TypeScript
* Vite
* SQLite
* Prisma または Drizzle
* ローカルファースト
* JSON / YAML import-export
* Markdown editor

ガントチャートは最初から高機能ライブラリに依存しすぎず、まずは以下を満たすシンプルな実装を目指す。

* Theme別レーン表示
* Itemの期間バー表示
* マイルストーン表示
* 今日線
* 年/月/週スケール切替
* ドラッグによる期間変更

## 10. 重要な非目標

本アプリは以下を主目的にしない。

* チーム全体のプロジェクト管理
* 厳密な工数管理
* 会社公式の予定表の完全代替
* OutlookやTeamsの完全同期
* JiraやPlannerの代替
* 家庭・趣味を含む万能ライフログ
* 高度なAIエージェント内蔵

あくまで、個人の研究開発活動における長期予定、現在地、メモ、リンク、AI壁打ち結果を扱うためのアプリである。

## 11. このアプリの価値

このアプリの価値は、以下にある。

* 複数テーマの長期予定を忘れにくくする
* 大きな会議やマイルストーンを常に見えるようにする
* 予定のズレを把握できる
* 待ち状態を見える化できる
* AIとの壁打ち結果を蓄積できる
* メモ、タスク、リンク、予定をゆるく構造化できる
* 外部AIに渡せる形で現在状況を出力できる
* 外部AIがまとめた予定やタスクを取り込める

一言で言えば、本アプリは、研究開発職向けの「長期ガントが強い、AIフレンドリーな個人業務メモ・タスク管理アプリ」である。

# 仕様追記案：データ共有方針およびUI詳細設計

## 12. データ共有・バックアップ方針

## 12.1 基本方針

本アプリは、初期段階ではローカル環境での利用を前提とする。
データの正本は各PC上のローカルデータベースとし、複数PC間の共有は明示的なSnapshot Export / Importによって実現する。

リアルタイム同期やクラウドDB連携は初期MVPでは対象外とする。
ただし、将来的な同期機能の追加を見据えて、データモデルには同期に必要な情報をあらかじめ持たせる。

## 12.2 Phase 2としての共有方式

複数PCでの利用を想定し、Phase 2では以下の方式を採用する。

* 各PCではローカルDBを用いてアプリを利用する
* 任意のタイミングでWorkspace SnapshotをExportできる
* ExportしたSnapshotをOneDrive、Google Drive、Dropbox、NASなどに保存できる
* 別PCではSnapshotをImportすることでデータを取り込める
* Import時には、既存データとの差分を確認できるプレビュー画面を表示する
* 追加、更新、無視を選択してから反映できるようにする

SQLiteなどのDBファイルそのものをクラウド同期フォルダに直接置き、複数PCから同時利用する方式は採用しない。
これは、ファイル同期の競合やDB破損のリスクを避けるためである。

## 12.3 Snapshot Export

Workspace Snapshotは、アプリ内データ全体をバックアップ・移行・AI参照しやすい形式で出力する機能である。

出力形式はzipファイルを基本とし、内部にJSON、Markdown、必要に応じてYAMLを含める。

例：

```text
workspace_export_2026-06-13.zip
  - themes.json
  - items.json
  - notes.json
  - links.json
  - people.json
  - dependencies.json
  - view_preferences.json
  - summary.md
```

`summary.md` には、人間や外部AIが読みやすい形で、現在のテーマ、マイルストーン、未完了Item、Waiting、直近メモなどをまとめる。

## 12.4 Snapshot Import

Snapshot Importでは、Export済みのWorkspace Snapshotを読み込み、現在のWorkspaceとの差分を確認できるようにする。

Import時には、以下のような候補を表示する。

* 新規追加されるTheme / Item / Note / Link
* 既存データを更新する候補
* 競合している候補
* 削除済みとして扱う候補
* 無視する候補

Importは即時反映ではなく、必ずプレビューを挟む。
ユーザーが確認した上で、追加・更新・無視を選択できるようにする。

## 12.5 将来の同期に備えたデータ項目

将来的な差分同期や複数PC利用に備え、主要オブジェクトには以下のメタデータを持たせる。

```text
- id
- created_at
- updated_at
- deleted_at
- device_id
- source
- version
```

`deleted_at` を持たせることで、物理削除ではなく論理削除を扱えるようにする。
これにより、将来的な差分同期やImport時の競合処理がしやすくなる。

## 13. UI詳細設計：Split Gantt

## 13.1 基本方針

ガントチャートは、単なる可視化ではなく、長期予定を編集・確認するための中心画面とする。

本アプリのガントチャートは、左側にItemの表、右側に時間軸を持つSplit Gantt形式とする。

左側の表では、Item名、状態、開始日、終了日、担当、進捗などを確認できる。
右側の時間軸では、期間バー、マイルストーン、今日線、予定と実績の差分、依存関係、イナズマ線を表示する。

## 13.2 Split Ganttの構成

ガント画面は以下の構成とする。

```text
左ペイン：Item表
右ペイン：時間軸ガント
右サイドバー：選択中Itemの詳細
```

左ペインは横スクロールせず固定表示とし、右ペインの時間軸部分のみ横スクロールできるようにする。

左ペインの列は、初期状態では以下を想定する。

```text
- Item名
- 状態
- 開始
- 終了
- 担当 / 待ち相手
- 進捗
```

## 13.3 Item階層

ガント画面では、Itemの親子関係を表示できるようにする。

例：

```text
実験
  - サンプル作成
  - 条件1
  - 条件2
  - 物性評価
解析・報告
  - データ整理
  - 図表作成
  - 報告資料作成
```

親Itemは折りたたみ・展開ができる。
また、画面上部に「全展開」「全折りたたみ」操作を設ける。

このため、Itemには以下の項目を追加する。

```text
Item
- parent_item_id
- sort_order
- depth
```

## 13.4 ガント表示コントロール

ガント画面には、以下の表示切替機能を持たせる。

```text
- 年度選択
- 年間フィット
- 半年表示
- 四半期表示
- 月間表示
- 週間表示
- 今日へ移動
- 標準表示
- 依存線ON/OFF
- イナズマ線ON/OFF
- 完了Item表示ON/OFF
- 全展開 / 全折りたたみ
```

特に年間フィットは重要な機能とする。
長期の研究テーマや大きなマイルストーンを、1画面で俯瞰できるようにする。

## 13.5 今日線

ガントチャート上には、現在日を示す縦線を常に表示できるようにする。

今日線により、長期予定の中で現在がどこにあるかを直感的に把握できるようにする。

## 13.6 イナズマ線

ガントチャートには、進捗状況を視覚的に把握するためのイナズマ線を表示できるようにする。

イナズマ線は、今日時点で各Itemが予定に対して進んでいるか、遅れているかを示す補助線である。

MVPでは必須実装としないが、将来的な重要機能として仕様に含める。
初期実装では、イナズマ線ON/OFFのUIを用意し、後から機能追加しやすい構成にする。

## 13.7 依存関係線

Item間には依存関係を設定できるようにする。

例：

```text
サンプル作成 → 測定 → 解析 → 報告資料作成
```

MVPでは依存関係の高度な自動調整は行わない。
まずは依存線を表示できることを目標とする。

依存関係は以下のデータモデルで扱う。

```text
ItemDependency
- id
- source_item_id
- target_item_id
- dependency_type
- created_at
- updated_at
```

初期の `dependency_type` は `finish_to_start` のみでよい。

## 14. 日程未確定・仮予定・確定予定の扱い

## 14.1 背景

研究開発業務では、やることは決まっているが日程が未確定の予定が多い。
また、「6月中」「7月上旬」「第3週ごろ」のような粗い予定も多い。

そのため、本アプリでは日付が確定しているItemだけでなく、日程未確定や仮予定を自然に扱えるようにする。

## 14.2 Schedule Status

Itemには、日程の状態を表す `schedule_status` を持たせる。

```text
schedule_status
- unscheduled
- tentative
- scheduled
- fixed
```

意味は以下の通り。

```text
unscheduled：日程未確定
tentative：仮予定
scheduled：予定あり
fixed：確定予定
```

## 14.3 Schedule Confidence

Itemには、予定の確からしさを表す `schedule_confidence` を持たせる。

```text
schedule_confidence
- rough
- tentative
- fixed
```

意味は以下の通り。

```text
rough：かなり粗い見込み
tentative：仮置き
fixed：確定に近い
```

## 14.4 ガント上の表現

ガント上では、日程状態に応じて表示を変える。

```text
unscheduled：
  左側のItem表には表示するが、ガントバーは表示しない。
  日程未確定バッジを表示する。

tentative / rough：
  通常バーよりも薄い表示、点線、斜線などで表示する。

scheduled：
  通常の期間バーとして表示する。

fixed：
  通常の期間バーより強調して表示する。
```

これにより、確定した予定と仮置きの予定を区別できるようにする。

## 15. ToDo画面の詳細設計

## 15.1 基本方針

ToDo画面は、日々の作業を軽く管理するための画面とする。

本アプリの中心は長期ガントとTheme管理だが、毎日の作業入口としてToDo画面を用意する。

ToDoは、プロジェクトに紐づくタスクだけでなく、テーマに紐づかない業務上の個人タスクも扱えるようにする。

## 15.2 Personal Work ToDo

家庭や趣味の管理を主目的にはしないが、仕事内の雑務や個人作業を扱うために、Personal Work ToDoを用意する。

例：

```text
- 週報を書く
- 経費精算をする
- 講習を受ける
- PC関連の申請をする
- 上司に予定を確認する
```

Personal Work ToDoは、特定のThemeに紐づかなくてもよい。

このため、Itemには以下を持たせる。

```text
Item
- is_personal_task
```

## 15.3 ToDo画面のサマリーカウンター

ToDo画面上部には、作業状況を把握するためのサマリーカウンターを表示する。

初期表示候補は以下とする。

```text
- 今日やる
- 1週間以内
- 期限超過
- 今月完了
- Waiting
- 日程未確定
```

これにより、今すぐ見るべきタスクや危険なタスクを把握しやすくする。

## 15.4 Quick Add Row

ToDo画面には、タスクをすぐ追加できる入力欄を設ける。

入力欄にタスク名を入れてEnterを押すと、即座にItemが作成される。

作成時点でTheme、期限、状態などが未設定でもよい。
詳細は右サイドバーで後から編集できるようにする。

## 15.5 タスク行の表示

ToDo一覧の各行には、以下を表示する。

```text
- チェックボックス
- ドラッグハンドル
- タスク名
- 期限
- 状態バッジ
- 関連Theme
- 関連Item
- メニュー
```

チェックボックスで完了状態にできる。
ドラッグハンドルにより、並び順を変更できる。

## 15.6 完了済みタスク

完了済みタスクは削除せず、`done` 状態として保持する。

ToDo画面では、完了済みタスクを別セクションに表示する。
表示期間は切り替えられるようにする。

例：

```text
- 今日完了
- 今週完了
- 今月完了
- 3か月以内に完了
```

完了済みタスクは、ふりかえりやAI Export、報告資料作成の材料として利用できる。

## 16. 右サイドバー詳細編集

## 16.1 基本方針

一覧、ガント、ToDo、Notesなどの画面では、選択中のオブジェクトを右サイドバーで編集できるようにする。

モーダル画面を多用するのではなく、一覧やガントを見ながら詳細を編集できる体験を重視する。

## 16.2 右サイドバーで編集する項目

Item選択時には、右サイドバーで以下を編集できる。

```text
- タイトル
- 種別
- 状態
- Theme
- 親Item
- 期限
- planned_start
- planned_end
- actual_start
- actual_end
- baseline_start
- baseline_end
- schedule_status
- schedule_confidence
- 優先度
- 進捗
- 担当者
- 待ち相手
- メモ
- 関連Note
- 関連Link
```

Note選択時には、以下を編集できる。

```text
- タイトル
- note_type
- Theme
- 関連Item
- 本文Markdown
- source
- source_url
- 関連Link
```

Link選択時には、以下を編集できる。

```text
- タイトル
- URL
- link_type
- Theme
- 関連Item
- 関連Note
- 説明
```

## 17. フィルター・状態バッジ

## 17.1 状態バッジ

Itemの状態は、テキストだけでなく色付きバッジとして表示する。

対象となる状態は以下を想定する。

```text
- 未着手
- 進行中
- 確認待ち
- 待ち
- 日程未確定
- 完了
- 保留
- 中止
```

状態バッジは、ToDo、Gantt、Theme Dashboard、右サイドバーで共通して使用する。

## 17.2 常駐フィルター

左サイドバーまたは画面上部に、状態フィルターを常駐させる。

初期フィルターは以下を想定する。

```text
- 全て
- 未着手
- 進行中
- 確認待ち
- 待ち
- 日程未確定
- 完了
```

将来的には、以下のフィルターも追加する。

```text
- Theme
- Item種別
- 担当者
- 待ち相手
- schedule_status
- schedule_confidence
- 期限あり / 期限なし
- 今週
- 今月
- 次の90日
```

## 18. データモデル追記

既存のItemモデルに以下を追加する。

```text
Item
- parent_item_id
- sort_order
- depth
- schedule_status
- schedule_confidence
- date_granularity
- is_personal_task
- deleted_at
- device_id
- source
- version
```

各項目の意味は以下の通り。

```text
parent_item_id：
  Itemの親子関係を表す。

sort_order：
  同一階層内での表示順を表す。

depth：
  階層の深さを表す。

schedule_status：
  日程未確定、仮予定、予定あり、確定予定を表す。

schedule_confidence：
  予定の確からしさを表す。

date_granularity：
  日付の粒度を表す。
  day, week, month, quarter などを想定する。

is_personal_task：
  Themeに紐づかない個人業務タスクかどうかを表す。

deleted_at：
  論理削除日時を表す。

device_id：
  データを作成・更新した端末を表す。

source：
  manual, imported, ai, calendar など、データの由来を表す。

version：
  将来的な同期やImport時の競合解決に使う。
```

新たにItemDependencyを追加する。

```text
ItemDependency
- id
- source_item_id
- target_item_id
- dependency_type
- created_at
- updated_at
- deleted_at
```

表示設定を保存するため、ViewPreferenceを追加する。

```text
ViewPreference
- id
- view_name
- scale
- fiscal_year
- show_today_line
- show_lightning_line
- show_dependencies
- show_completed
- filter_statuses
- created_at
- updated_at
```

## 19. MVP優先度の見直し

画像UIの検討を踏まえ、MVPでは以下の優先度を上げる。

```text
優先度を上げるもの：
- Split Gantt
- 左表 + 右時間軸のガント
- 右サイドバー詳細編集
- 日程未確定の扱い
- 仮予定 / 確定予定の区別
- ToDo画面のサマリーカウンター
- Quick Add Row
- 完了済みタスクの保持
- 状態バッジ
- 常駐フィルター
```

一方で、以下はMVPでは後回しにする。

```text
後回しにするもの：
- リアルタイム同期
- Outlook / Teams直接接続
- 高度なイナズマ線計算
- 依存関係による自動日程調整
- 高度な統計
- AIによる自動分類
- 本格的な共同編集
```

## 20. 追記後のアプリ像

本アプリは、長期ガントを中心に、テーマ、タスク、メモ、リンク、待ち状態、AI入出力を扱う個人業務管理アプリである。

特に、以下を重視する。

```text
- 複数テーマの長期予定を忘れない
- 日程未確定や仮予定を自然に扱う
- 大きなマイルストーンを俯瞰する
- 予定と実績のズレを把握する
- 毎日のToDoも軽く扱える
- メモやAI壁打ち結果を蓄積する
- 成果物リンクを辿れるようにする
- Snapshot Export / Importで複数PC利用に対応する
```

ガントチャートは単なる表示ではなく、研究開発活動の現在地を把握し、予定を調整し、忘れやすいマイルストーンや待ち状態を見える化するための中心UIとする。

# 仕様追記案：ビュー・履歴・関係性・情報源管理の拡張

## 21. 追加設計方針

既存仕様では、長期ガント、ToDo、メモ、リンク、Waiting、AI Import / Exportを中心に設計した。

本追記では、実際の業務管理ツール、プロジェクト管理ツール、ナレッジ管理ツールの設計思想を参考に、以下の機能を追加候補として整理する。

* Saved View
* Custom Field
* Plan Revision
* Theme Status Update
* SourceRecord / Provenance
* Milestone Map
* ItemRelation
* Typed Note / LogEntry
* Bulk Edit / Spreadsheet Mode
* Rough Date
* Import Preview強化

これらは、初期MVPですべて実装する必要はない。
ただし、将来的な拡張性に関わるため、データモデルやUI設計にはあらかじめ反映しやすい構造を持たせる。

## 22. Saved View

## 22.1 目的

Saved Viewは、ユーザーがよく使う表示条件を保存し、ワンクリックで呼び出せるようにする機能である。

本アプリでは、Theme、Item、Note、Link、Waitingなどを複数の観点から見る必要がある。
そのため、固定画面だけでなく、ユーザーが自分用のビューを保存できることが重要である。

## 22.2 想定するSaved View例

```text
- 次の90日のマイルストーン
- 今月の山場
- 日程未確定のItem
- Waiting一覧
- 確認待ち一覧
- Aテーマの未完了Item
- 最近更新されていないTheme
- AI壁打ちメモ一覧
- 今月完了したItem
- 報告会関連Item
- 予定が遅れているItem
```

## 22.3 Saved Viewの種類

Saved Viewは以下の表示形式を持つ。

```text
view_type
- table
- list
- gantt
- timeline
- dashboard
- notes
- milestone_map
```

## 22.4 データモデル

```text
SavedView
- id
- name
- view_type
- description
- filters_json
- sort_json
- group_by
- visible_columns_json
- scale
- theme_id
- is_default
- created_at
- updated_at
- deleted_at
```

## 22.5 UI

左サイドバーまたは専用のViewsセクションに、保存済みビューを表示する。

```text
Views
- 今月の山場
- Waiting
- 日程未確定
- AI壁打ちメモ
- 次の90日
```

ビュー表示中にフィルターや列表示を変更した場合は、以下を選択できるようにする。

```text
- このビューを更新
- 別名で保存
- 一時的に表示
```

## 23. Custom Field

## 23.1 目的

研究開発テーマでは、テーマや業務内容によって必要な属性が異なる。

固定スキーマだけでは、以下のような情報を自然に扱いにくい。

```text
- 試料番号
- 測定装置
- 評価方法
- 担当部署
- 報告先
- 顧客名
- サンプル到着予定
- スライドリンク
- 装置予約番号
- 実験条件
```

そのため、Theme、Item、Note、Linkに対して、ユーザーが任意の項目を追加できるCustom Fieldを導入する。

## 23.2 方針

Custom Fieldは、NotionやAirtableのような完全な汎用DB化を目指すものではない。
基本データモデルは固定しつつ、研究テーマごとの追加属性を扱うための補助機能とする。

## 23.3 Field Type

```text
field_type
- text
- long_text
- number
- date
- select
- multi_select
- checkbox
- url
- person
- relation
```

## 23.4 データモデル

```text
FieldDefinition
- id
- name
- field_type
- applies_to
- theme_id
- options_json
- sort_order
- is_required
- created_at
- updated_at
- deleted_at
```

```text
applies_to
- theme
- item
- note
- link
```

```text
FieldValue
- id
- field_definition_id
- entity_type
- entity_id
- value_text
- value_number
- value_date
- value_json
- created_at
- updated_at
- deleted_at
```

## 23.5 UI

右サイドバーの詳細編集画面に、Custom Fieldセクションを表示する。

Themeごとに異なるFieldDefinitionを設定できるようにし、特定Themeだけで使う項目も定義できる。

例：

```text
Aテーマ用Custom Field
- 試料番号
- 測定装置
- 評価条件

報告系テーマ用Custom Field
- 報告先
- 資料リンク
- レビュー担当
```

## 24. Plan Revision

## 24.1 目的

研究開発の予定は、当初予定から何度も変更される。
ガントチャート上でバーを動かすだけでは、なぜ予定が変わったのかが後から分からなくなる。

Plan Revisionは、予定変更の履歴を記録する機能である。

## 24.2 記録する内容

以下のような変更を記録する。

```text
- planned_startの変更
- planned_endの変更
- due_dateの変更
- schedule_statusの変更
- schedule_confidenceの変更
- progressの大きな変更
```

## 24.3 データモデル

```text
PlanRevision
- id
- item_id
- changed_at
- changed_by_device_id
- old_planned_start
- old_planned_end
- new_planned_start
- new_planned_end
- old_due_date
- new_due_date
- old_schedule_status
- new_schedule_status
- old_schedule_confidence
- new_schedule_confidence
- reason
- related_note_id
- created_at
```

## 24.4 UI

ガントチャート上でItemの期間バーを移動・変更した場合、必要に応じて予定変更理由を入力できるようにする。

ただし、毎回理由入力を強制すると運用が重くなるため、入力は任意とする。

例：

```text
予定変更理由：
- 測定結果の受領が遅れたため
- 会議日程が変更されたため
- 解析方針を変更したため
- 他テーマの優先度が上がったため
```

## 24.5 活用

Plan Revisionは以下に活用する。

```text
- 当初予定と現在予定の差分確認
- 予定変更履歴の表示
- 週次・月次ふりかえり
- AI Export
- 報告資料作成
- 遅延要因の分析
```

## 25. Theme Status Update

## 25.1 目的

Theme Dashboardでは、各Themeの現在地を把握できることが重要である。

ただし、ItemやNoteを見れば分かる状態と、ユーザーが一言でまとめる「現在地」は異なる。

Theme Status Updateは、Themeの状態を定期的に記録するための機能である。

## 25.2 想定利用

週次や報告前に、Themeごとに短い状態メモを残す。

例：

```text
Aテーマ：
測定結果待ち。中間報告には間に合う見込みだが、解析方針が未確定。

Bテーマ：
顧客レビューが前倒しになったため、資料作成を優先する必要あり。

Cテーマ：
当面は保留。次の判断タイミングは8月末。
```

## 25.3 データモデル

```text
ThemeStatusUpdate
- id
- theme_id
- date
- status
- summary
- progress
- risks
- next_actions
- related_note_id
- created_at
- updated_at
- deleted_at
```

```text
status
- on_track
- at_risk
- delayed
- paused
- completed
```

## 25.4 UI

Theme Dashboardに、最新のTheme Status Updateを表示する。

また、過去のStatus Updateをタイムライン形式で確認できるようにする。

表示例：

```text
現在地：
- 状態：At Risk
- 概要：測定結果待ち。解析方針が未確定。
- リスク：中間報告までに解析が間に合わない可能性
- 次アクション：測定結果受領後、条件Bのばらつきを確認
```

## 26. SourceRecord / Provenance

## 26.1 目的

本アプリでは、AI壁打ち、会議、メール、資料、メモなどからItemやNoteが作成される。

そのため、以下を後から確認できることが重要である。

```text
- このタスクはどこから生まれたのか
- この判断の根拠は何か
- このメモはどのAI会話や会議に基づくのか
- この予定はどの資料・メール・会議に由来するのか
```

SourceRecordは、情報の出所を記録するためのオブジェクトである。

## 26.2 Source Type

```text
source_type
- manual
- chatgpt
- copilot
- outlook
- teams
- email
- calendar
- meeting
- document
- sharepoint
- onedrive
- imported_yaml
- imported_json
- snapshot
- other
```

## 26.3 データモデル

```text
SourceRecord
- id
- source_type
- source_title
- source_url
- captured_at
- raw_text
- summary
- import_batch_id
- created_at
- updated_at
- deleted_at
```

## 26.4 各オブジェクトとの関係

Theme、Item、Note、Linkには、必要に応じて `source_record_id` を持たせる。

```text
Item
- source_record_id

Note
- source_record_id

Link
- source_record_id
```

また、複数のSourceRecordに紐づく可能性がある場合は、中間テーブルを用意する。

```text
EntitySource
- id
- entity_type
- entity_id
- source_record_id
- relation_type
- created_at
```

```text
relation_type
- created_from
- referenced_by
- evidence_for
- imported_from
```

## 26.5 UI

Item、Note、Linkの右サイドバーに「情報源」セクションを表示する。

表示例：

```text
情報源：
- ChatGPT会話：Aテーマ解析方針の壁打ち
- Teams会議：6/12 中間報告準備会
- SharePoint：評価データ格納フォルダ
```

SourceRecordは、AI Import時に特に重要である。
AIが生成したItemやNoteについて、元になった会議メモ、チャット、資料リンクを保持できるようにする。

## 27. Milestone Map

## 27.1 目的

ガントチャートは長期予定を俯瞰するのに有効だが、重要な節目だけを素早く確認したい場面も多い。

Milestone Mapは、マイルストーンだけを抽出して一覧・時系列表示するビューである。

## 27.2 表示対象

```text
- kind = milestone のItem
- due_dateがある重要Item
- schedule_statusがfixedまたはscheduledの重要予定
- Go/No-Go判断
- 報告会
- 顧客レビュー
- 実験結果受領
- 資料提出
```

## 27.3 表示単位

```text
- 今月
- 次の30日
- 次の90日
- 半期
- 年度
- Theme別
```

## 27.4 UI例

```text
次の90日のマイルストーン

6/20  Aテーマ  測定結果受領
7/01  Aテーマ  中間報告
7/15  Bテーマ  顧客レビュー
8/30  Cテーマ  Go/No-Go判断
9/10  Dテーマ  技術報告会
```

## 27.5 活用

Milestone Mapは以下に活用する。

```text
- 大きな予定の確認
- 複数Themeの山場の重なり確認
- 週次・月次レビュー
- AI Export
- Theme Dashboard
```

## 28. ItemRelation

## 28.1 目的

既存仕様では、ItemDependencyによってガント上の依存関係を扱う。

ただし、実務では依存関係よりも広い意味の関係性が多い。

例：

```text
- このメモがこの判断の根拠である
- このタスクがこのマイルストーンをブロックしている
- このWaitingがこの報告資料作成に影響している
- このItemは別Itemと関連している
- このタスクはAI壁打ちメモから作成された
```

そのため、Dependencyとは別に、より汎用的なItemRelationを持たせる。

## 28.2 Relation Type

```text
relation_type
- blocks
- blocked_by
- relates_to
- duplicated_by
- follows
- references
- created_from
- evidence_for
- caused_by
- supports
```

## 28.3 データモデル

```text
ItemRelation
- id
- source_entity_type
- source_entity_id
- target_entity_type
- target_entity_id
- relation_type
- description
- created_at
- updated_at
- deleted_at
```

```text
entity_type
- theme
- item
- note
- link
- source_record
```

## 28.4 Dependencyとの使い分け

```text
ItemDependency：
  ガント上の依存線や日程関係に使う。
  例：サンプル作成が終わらないと測定できない。

ItemRelation：
  広い意味での関係性に使う。
  例：このメモはこの判断の根拠である。
```

## 29. Typed Note / LogEntry

## 29.1 目的

Noteは自由なMarkdownメモとして扱う。
一方で、研究開発では、特定の型を持つメモを構造化して残したい場面がある。

例：

```text
- Risk
- Issue
- Decision
- Action
- Assumption
```

これらをTyped NoteまたはLogEntryとして扱えるようにする。

## 29.2 LogEntry Type

```text
log_type
- risk
- issue
- decision
- action
- assumption
```

## 29.3 データモデル

```text
LogEntry
- id
- log_type
- theme_id
- item_id
- title
- body
- severity
- probability
- impact
- owner_person_id
- status
- related_note_id
- source_record_id
- created_at
- updated_at
- resolved_at
- deleted_at
```

```text
status
- open
- monitoring
- resolved
- closed
- cancelled
```

## 29.4 例

```text
Risk：
測定結果の受領が遅れる可能性がある。
Impact：中間報告の解析結果が不足する。

Issue：
条件Bのデータに異常値がある。

Decision：
条件Cは今回評価しない。
理由：前回データで効果が小さく、納期を優先するため。

Assumption：
ばらつきの主因は熱処理条件ではなく測定位置である可能性が高い。
```

## 29.5 UI

Theme Dashboardに、未解決のRisk / Issue / Decisionを表示する。

また、AI Export時にLogEntryを含められるようにする。

## 30. Rough Date

## 30.1 目的

研究開発の予定は、必ずしも日付単位で確定していない。

以下のような粗い予定を自然に扱えるようにする。

```text
- 6月中
- 7月上旬
- 第3週ごろ
- 第2四半期
- 下期中
- 装置が空き次第
```

## 30.2 方針

Itemには通常の日付項目に加え、人間が理解しやすい日程表現を保持する。

## 30.3 データモデル

```text
ItemDate
- id
- item_id
- start_date
- end_date
- date_text
- granularity
- confidence
- created_at
- updated_at
```

```text
granularity
- day
- week
- month
- quarter
- half_year
- fiscal_year
- unknown
```

```text
confidence
- rough
- tentative
- fixed
```

## 30.4 表示

ガント上では、granularityやconfidenceに応じて表示を変える。

```text
day：
  通常の日付・マイルストーンとして表示。

week：
  週単位の幅を持つバーとして表示。

month：
  月全体、または月内の粗い範囲として表示。

quarter：
  四半期の範囲として表示。

unknown：
  日程未確定として左表やInboxに表示。
```

`date_text` は右サイドバーや表に表示し、ユーザーが「7月上旬」「6月中」などの表現をそのまま確認できるようにする。

## 31. Bulk Edit / Spreadsheet Mode

## 31.1 目的

ガントやToDoの運用では、複数Itemをまとめて編集したい場面がある。

例：

```text
- 複数タスクの期限を1週間ずらす
- 複数ItemをWaitingにする
- 複数ItemのThemeを変更する
- 複数Itemを完了にする
- 複数Itemのschedule_statusをtentativeにする
```

Bulk Edit / Spreadsheet Modeは、複数Itemを表形式で効率的に編集するための機能である。

## 31.2 MVPでの扱い

初期MVPでは、本格的なSpreadsheet Modeは必須ではない。
ただし、Split Ganttの左表を表形式編集に拡張できるよう、設計上の余地を残す。

## 31.3 将来的な機能

```text
- 複数選択
- 一括ステータス変更
- 一括Theme変更
- 一括日程変更
- 一括削除
- CSV貼り付け
- 表形式での直接編集
- 選択Itemの一括Export
```

## 32. Import Preview強化

## 32.1 目的

本アプリでは、AI ImportおよびSnapshot Importが重要な機能である。

AIが生成した構造化データや、別PCからExportしたSnapshotを安全に取り込むため、Import前に差分や競合を確認できるプレビューを強化する。

## 32.2 Import Previewで表示する分類

```text
- 新規追加されるもの
- 既存データを更新するもの
- 競合しているもの
- 既存データと重複している可能性があるもの
- Themeに紐づかなかったもの
- 無視されるもの
- 削除候補
```

## 32.3 競合処理

競合が発生した場合、以下の操作を選べるようにする。

```text
- 新規作成
- 既存Itemに統合
- 既存Itemを更新
- 両方残す
- 無視
```

## 32.4 UI例

```text
AI Import候補：
「測定結果の受領待ち」

既存候補：
「Aテーマ 測定待ち」

処理：
[既存に統合] [新規作成] [無視]
```

## 32.5 SourceRecordとの連携

ImportされたItem、Note、Linkには、Import元のSourceRecordを紐づける。

これにより、後から以下を確認できる。

```text
- どのAI出力から作られたか
- どのSnapshotから取り込まれたか
- 元の会議メモやチャットリンクは何か
```

## 33. データモデル追加まとめ

本追記で追加する主要モデルは以下である。

```text
SavedView
FieldDefinition
FieldValue
PlanRevision
ThemeStatusUpdate
SourceRecord
EntitySource
ItemRelation
LogEntry
ItemDate
```

既存モデルへの追加項目は以下である。

```text
Theme
- source_record_id

Item
- source_record_id

Note
- source_record_id
- properties_json

Link
- source_record_id
```

`properties_json` は、Typed NoteやCustom Fieldの補助的な構造化情報を格納するために使用する。

## 34. MVP優先度

## 34.1 優先度A

以下は、可能であれば早めに設計・実装したい。

```text
- Saved View
- SourceRecord / Provenance
- Milestone Map
- Theme Status Update
- Plan Revision
```

## 34.2 優先度B

以下は、データモデルだけ先に見据え、実装は後回しでもよい。

```text
- Custom Field
- ItemRelation
- Rough Date
- Import Preview強化
```

## 34.3 優先度C

以下は、運用しながら必要性を確認してから実装する。

```text
- LogEntry
- Bulk Edit / Spreadsheet Mode
- 高度な依存関係管理
- Critical Path
- Workload / Capacity
- グラフビュー
```

## 35. 追記後の設計思想

本アプリは、単なるタスク管理ツールやガントチャートツールではなく、研究開発活動の現在地、予定、判断、根拠、メモ、成果物リンク、AI壁打ち結果を、後から再利用できる形で蓄積する個人業務管理アプリである。

特に以下を重視する。

```text
- よく使う見方をSaved Viewとして保存できる
- テーマごとに必要な追加属性をCustom Fieldで扱える
- 予定変更の履歴をPlan Revisionとして残せる
- Themeの現在地をStatus Updateとして記録できる
- ItemやNoteの情報源をSourceRecordとして追跡できる
- 重要な節目をMilestone Mapで一覧できる
- Item、Note、Link、SourceRecordの関係性をItemRelationで表現できる
- AI ImportやSnapshot Import時に安全な差分確認ができる
```

これにより、本アプリは「長期ガントが強い業務管理ツール」であるだけでなく、「研究開発活動の記憶を構造化して残すツール」として機能する。
