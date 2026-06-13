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
