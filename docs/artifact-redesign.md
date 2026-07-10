# Artifact 再整理方針（#136）

standard-version 参照: 2026-07.3  
決定日: 2026-07-10  
親 Issue: #136

この文書は #136 の完了条件を満たすための**設計決定の正本**である。実装はこの文書に沿って子 Issue へ分割する。

---

## 現状（実装ベース）

| 領域 | 現状 |
|---|---|
| Artifact エンティティ | `title`, `filename`, `file_type`, `mime_type`, `file_size`, `stored_path`, `original_path`, `source_type`, `source_id`, `theme_id`, `description`, `generated_by` |
| 保存 | Settings の単一 `artifactDirectory` 配下に `YYYY/MM/` へ常時コピー（= 事実上すべて managed） |
| UI | 1 行にファイル名・種別・サイズ・Theme・操作ボタン（開く / フォルダ / パス / 元へ / 削除）が密集 |
| 開く | すべて OS 関連付けアプリ経由。画像・Markdown のアプリ内プレビューは未実装（#130） |
| Theme | 保存ルートフィールドなし |
| Note「関連タスク」 | Note 編集 Drawer の `ItemSelect`（`item_id`）。対象は legacy `items` 一覧で、現行 Task 導線と乖離しておりほぼ未使用 |
| Resource | タイトル / URL / `body_markdown`（説明メモ）で論文運用は可能。専用項目なし |

SPEC §5.5 はもともと「成果物そのものをアプリ内に保存することは必須ではない。リンクで辿れることを重視する」と書いており、本方針はそれに戻す形で managed / linked を明示する。

---

## 1. Artifact 表示（カード / 一覧）

### 方針

チップではなく、余白のある**行カード一覧**にする。Drawer 内（`ArtifactSection`）と Artifacts ページで同じカード骨格を共有する。

### 表示情報

| 優先度 | 項目 | 出し方 |
|---|---|---|
| 必須・前面 | ファイル名（表示名） | 1 行目。長い名前は省略し `title` 属性に全文 |
| 必須・前面 | ファイル種別 | アイコン + 短いバッジ（`XLSX` / `MD` / `PNG` 等） |
| 必須・前面 | 保存方式 | バッジ: `Tasken管理` / `リンク`（詳細は hover またはメニュー内） |
| 前面（任意） | 主要操作 1 つ | 「開く」系ボタンのみ前面。ラベルは種別で変える |
| 2 行目 | サイズ / Theme / 元 Entity | 補助テキスト。0 件・未設定は出さない |
| 状態 | リンク切れ・アクセス不可 | `linked` のみ。警告色の短い状態ラベル |
| 出さない／畳む | フルパス、コピー日時、MIME 全文 | 詳細メニューまたは `title` に退避 |

### 主要操作

| 操作 | 配置 | 備考 |
|---|---|---|
| 開く（主） | 前面 | 種別でラベル変更。画像/Markdown は #130 のアプリ内ビューア、Excel/PPT/PDF 等は外部アプリ |
| その他… | メニュー（⋮） | 以下を格納 |
| フォルダを開く | メニュー | `managed` または `local_path` / `shared_path` のとき。URL のみは出さない |
| パス / URL をコピー | メニュー | モードに応じて文言を切替 |
| 元の Entity へ | メニュー | 既存の「元へ」 |
| Tasken管理へコピー | メニュー | `linked` のみ。managed 化 |
| 参照先を変更 | メニュー | `linked` のみ（後続実装） |
| 削除 | メニュー末尾（Danger） | 論理削除。ファイル実体は物理削除しない（現行どおり） |

### 種別ごとの主操作

| 種別 | 主操作 | 実装依存 |
|---|---|---|
| 画像（png/jpg/webp/svg 等） | プレビュー | #130 画像ビューア |
| Markdown | プレビュー | #130 Markdown ビューア |
| Excel / PowerPoint / PDF / その他 | 外部で開く | OS 関連付け（現行） |

サムネイルは**任意フェーズ**。まずカード骨格と操作整理を先に入れ、画像サムネは表示改善の後続でよい。

### 完了の定義（表示系 Issue）

- Drawer / Artifacts ページで同一カード骨格
- 前面は「名前・種別・保存方式・主操作」、詳細操作はメニュー
- 種別ごとの主操作ラベルが分岐している

---

## 2. `managed` / `linked` データモデル

### フィールド

既存 Artifact に次を追加する。**既存レコードは migration で `storage_mode: "managed"` とみなし**、物理ファイルの移動はしない。

```ts
storage_mode: "managed" | "linked"  // 既定: managed

// managed（現行相当）
stored_path: string                 // 必須（managed）
original_path?: string | null
copied_at?: string | null           // 初回コピー日時。未設定なら created_at を表示用に流用可

// linked
link_type?: "url" | "local_path" | "shared_path" | "onedrive" | "sharepoint" | "teams" | null
target?: string | null              // URL またはパス本体
link_status?: "unknown" | "ok" | "broken" | "inaccessible" | null
last_checked_at?: string | null

// 共通（既存）
title, filename, file_type, mime_type, file_size,
source_type, source_id, theme_id, description, generated_by
```

#### フィールド運用ルール

| モード | 必須 | 任意 | 禁止・無視 |
|---|---|---|---|
| `managed` | `stored_path`, `filename`, `source_*` | `original_path`, `copied_at`, size/mime | `target` は使わない（残っていても open に使わない） |
| `linked` | `target`, `link_type`, `filename` または表示名, `source_*` | `link_status`, `last_checked_at`, size/mime | `stored_path` は空文字可。open は `target` を使う |

`filename` は一覧の表示名として両方で使う。linked で元ファイル名が取れない場合は URL 末尾やユーザー入力の表示名を入れる。

### 参照種別（`link_type`）と制約

| link_type | 例 | open | フォルダを開く | 制約・注意 |
|---|---|---|---|---|
| `url` | 一般 https | 外部ブラウザ / OS | 不可 | 権限不足は Tasken では解決しない。切れは open/check 失敗で `broken`/`inaccessible` |
| `local_path` | `C:\Users\...` | パス open | 可 | 端末差。他端末では壊れやすい |
| `shared_path` | `\\server\share\...` | パス open | 可 | VPN・マウント依存 |
| `onedrive` | OneDrive URL または同期パス | URL 優先、パスがあればパス | パス時のみ | URL と同期パスの両持ちはしない。どちらか一方を `target` に |
| `sharepoint` | SharePoint / ライブラリ URL | URL | 不可 | API 統合は非ゴール。リンクのみ |
| `teams` | Teams メッセージ・ファイル URL | URL | 不可 | 同上 |

#### 共通制約（linked）

- Tasken は**参照の保持と open 試行**まで。同期・バックアップ・ACL 解決は保証しない（#136 非ゴール）。
- 別端末: `local_path` は成功を期待しない。URL 系は端末非依存。
- リンク確認は「存在確認のベストエフォート」。失敗時にデータを消さない。
- 添付 UI: 「コピーして管理に追加」（managed）と「場所だけリンク」（linked）を選べるようにする。ドラッグ既定は **managed（現行互換）**。

### 基本操作

| 操作 | managed | linked |
|---|---|---|
| 開く | `stored_path` | `target` |
| フォルダを開く | ○ | local/shared のみ |
| パス/URL コピー | `stored_path` | `target` |
| managed 化 | — | ファイルを Tasken 保存ルールへコピーし `storage_mode=managed` に更新。元 `target` は `original_path` に退避可 |
| リンク状態確認 | — | open 前または手動。`link_status` / `last_checked_at` 更新 |
| 参照先変更 | — | `target` / `link_type` を差し替え |
| 削除 | 論理削除。実体ファイルは残す | 論理削除のみ（外部実体は触らない） |

### 既存 managed の移行

| 項目 | 決定 |
|---|---|
| スキーマ | 読み込み時または migration で `storage_mode` 未設定 → `managed` |
| 物理ファイル | **移動しない**。既存 `stored_path` を正本のまま使い続ける |
| 新規保存 | 下記「3. Theme 保存先」ルールを適用 |
| UI | 既存行は「Tasken管理」バッジ表示 |

---

## 3. Theme 単位の保存先ルール

### 原則

- **managed のみ**が Tasken 管理フォルダへ書き込む。linked は保存先ルールの対象外。
- 保存先を毎回聞かない。未設定時だけ設定を促す（現行の `needs_directory` と同様）。

### ルートの持ち方

| 設定 | 置き場所 | 内容 |
|---|---|---|
| Tasken 共通ルート | Settings `artifactDirectory`（既存） | Theme なし・フォールバックの根 |
| Theme 保存ルート | Theme の任意フィールド `storage_root` | 絶対パス。未設定なら共通ルートから自動配置 |

**自動配置のフォルダ名は Theme の `code`（なければ `id`）を使う。表示名変更でフォルダを追従させない。**

### 配置ルール

#### Theme あり（`storage_root` 設定済み）

```text
{storage_root}/Artifacts/     … managed Artifact
{storage_root}/Exports/       … Note Markdown / 汎用書き出し（将来）
{storage_root}/Notes/         … Note Markdown 書き出し既定（将来）
```

月次サブフォルダ（`YYYY/MM`）は **任意**。初期実装は Theme ルート直下の `Artifacts/` にフラット保存 + 同名衝突は既存の `(2)` サフィックスでよい。件数が多い Theme だけ後から月次を足す。

#### Theme あり（`storage_root` 未設定）

```text
{artifactDirectory}/Themes/{theme_code|theme_id}/Artifacts/
```

#### Theme なし

```text
{artifactDirectory}/Inbox/
```

#### PDF 共有

- Document Publish の PDF は**都度保存先を選ぶ**（現行の `chooseDirectory` 寄りを維持）。
- 最後に使ったフォルダは preference（例: `lastPdfExportDirectory`）に記憶して初期表示に使う。
- Theme の `Exports/` を「おすすめ」として出すのは後続でよい。

### Theme 名変更・削除

| 事象 | 挙動 |
|---|---|
| Theme 名変更 | フォルダは動かさない（code/id ベース or ユーザー指定 `storage_root`） |
| Theme code 変更 | 自動配置パスが変わるため、**新規保存のみ新パス**。既存 `stored_path` は更新しない |
| Theme 削除 | 現行どおり theme 由来 Artifact は cascade 論理削除。ファイル実体は残す |
| `storage_root` 変更 | 以降の新規 managed のみ新ルート。既存は移動しない（手動整理） |

### 設定 UI 候補（実装 Issue で段階導入）

1. Settings: 共通 `artifactDirectory`（既存）
2. Theme 編集: 任意の `storage_root` + 「フォルダを開く」
3. 未設定時フォールバック文言
4. （後続）PDF 最終保存先の記憶

### 既存ファイルの移行要否

**不要（強制移行しない）。**  
理由: 既存パスを壊さず、open は `stored_path` 依存のため。新ルールは新規 managed 添付から適用する。必要なら将来「この Theme の Artifact を新ルートへ整理」を別 Issue にする。

---

## 4. Note の「関連タスク」導線

### 決定: **UI から削除（非表示）。データフィールドは維持**

| 項目 | 内容 |
|---|---|
| UI | Note 編集 Drawer の `ItemSelect`（ラベル「関連タスク」）を外す |
| データ | `note.item_id` は残す。既存値・Import・learning 系を壊さない |
| Task 側 | Task 詳細の learning notes（`item_id` 一致）は現状維持。新規に Note→Task リンク UI は作らない |
| 将来 | Task 起点の「関連 Note」が必要なら、現行 Task モデル（`task` id）向けに別設計する。legacy `items` への紐づけは復活させない |

理由: 紐づけ対象が legacy `items` であり現行 Task 運用と噛み合っておらず、Note を本文中心に単純化したい（#136）。#128 の「使えていない導線を畳む」とも一致する。

---

## 5. Resource で論文を貯める運用

### 決定: **新機能は作らない。既存 Resource で運用検証する**

#### 推奨運用（ドキュメント / 運用メモ）

| 欲しい情報 | 既存の置き場 |
|---|---|
| 論文タイトル | Resource タイトル |
| DOI / arXiv / 論文 URL | URL 欄 |
| 著者・年・掲載誌・読む目的 | 説明 / `body_markdown` に定型で書く |
| PDF | Artifact（managed または linked URL）を Resource に紐づけ |
| 読んだ気づき | Note を Theme に紐づけ（本文）。必要なら Resource のメモ欄に短く |
| 構造化知見 | 必要になったものだけ Knowledge 化 |

定型メモ例（body）:

```markdown
- 著者:
- 年:
- 掲載:
- 目的:
- 状態: 未読 / 読了
```

#### 実装しないもの（検証後に再判断）

- 著者 / 年 / 掲載誌の専用カラム
- DOI / arXiv ID の正規化
- BibTeX 入出力
- 読了状態・優先度の専用 enum
- 論文専用タグ体系

**検証の目安:** 10〜30 件貯めたあと、本当に足りない項目だけ Issue 化する。

---

## 6. 実装分割（子 Issue）

優先度順。依存は矢印。

```text
#136（本方針）
 ├── A. Note「関連タスク」UI削除          … 独立・最小
 ├── B. Artifact カード表示の整理         … 現行 managed のまま UI のみ
 ├── C. managed / linked モデルと添付     … B と並行可、表示バッジは B に接続
 ├── D. Theme 単位の保存先ルール          … C の後が望ましい（managed 保存パス）
 └── （運用のみ）Resource 論文運用        … 実装 Issue なし。本ドキュメント §5
```

プレビュー導線は **#130** が正本。B の主操作は #130 完了後にアプリ内ビューアへ indirection を足す（#130 側の受け入れと重複させない）。

### 子 Issue

| # | 内容 |
|---|---|
| #144 | Note編集から「関連タスク」を外し、Noteを本文中心にする |
| #145 | Artifact添付をカード表示にし、主要操作とメニューを整理する |
| #147 | Artifactに managed / linked を導入し、参照添付と管理コピーを選べるようにする |
| #146 | Theme単位のArtifact保存ルートとInboxフォールバックを実装する |

推奨実装順: #144 → #145 → #147 → #146（#145 と #147 は並行可。#146 は #147 の後が望ましい）

---

## 7. 非ゴール（再掲）

- 本方針 Issue 内ですべてを一括実装すること
- 論文専用 Resource 機能の先作り
- Teams / SharePoint API との本格統合
- linked 先ファイルの同期やバックアップ保証
- 既存 managed ファイルの一括移動

---

## 8. 完了条件チェック（#136）

- [x] Artifact カード / 一覧に表示する情報と主要操作が決まっている → §1
- [x] `managed` / `linked` のデータモデルと基本操作が決まっている → §2
- [x] linked Artifact で扱う参照種別と制約が整理されている → §2
- [x] Theme あり / なし / PDF 共有時の保存ルールが決まっている → §3
- [x] 既存 managed Artifact の移行要否が決まっている → §2・§3（強制移行しない）
- [x] Note の「関連タスク」を削除・非表示・維持のどれにするか決まっている → §4（UI削除・データ維持）
- [x] Resource の論文管理は実装せず運用検証することが明文化されている → §5
- [x] 実装単位ごとの子 Issue に分割されている → §6 および GitHub 子 Issue
