# Research Desk アプリケーション構造設計図

調査対象: 2026-06-14 時点のリポジトリ実装

## A. アプリ全体の説明

Research Desk は、研究開発職向けのローカルファーストな個人業務管理デスクトップアプリである。Theme、Item、Note、Link、Person、予定変更履歴、情報源、関係、Snapshotなどを一つのWorkspaceとして扱う。

実行時の中心経路は次のとおり。

```text
User
  -> React Renderer (`src/App.jsx`)
  -> API Adapter (`src/services/workspaceApi.js`)
  -> Preload Bridge (`electron/preload.cjs`)
  -> Electron IPC (`electron/main.mjs`)
  -> WorkspaceDatabase (`electron/database.mjs`)
  -> SQLite (`<Electron userData>/research-desk.sqlite`)
```

HTTPサーバーやREST APIはない。アプリ内の「API」はElectron IPCであり、ブラウザ単体実行には対応しない。

### フロントエンド

- React 19 + Vite 6。
- エントリポイントは`src/main.jsx`。
- 画面、状態管理、フォーム処理、ルーティング、主要UIコンポーネントの大半は`src/App.jsx`に集約されている。
- ルーティングライブラリは使わず、`location.hash`で画面を切り替える。
- グローバルな業務データは`App`の`workspace` stateに保持する。
- 画面固有のフィルターや選択状態は、各ページの`useState`に保持する。
- スタイルは`src/styles.css`から`design-standard/tokens.css`を読み込む。

### バックエンド

- Electron main processがバックエンド相当。
- `electron/main.mjs`がウィンドウ生成、IPC登録、ファイルダイアログ、外部URL起動を担当する。
- `electron/database.mjs`がSQLiteのスキーマ、CRUD、論理削除、Plan Revision、Snapshot差分適用を担当する。
- 独立したWebサーバー、常駐APIサーバー、クラウドバックエンドはない。

### API

HTTP APIではなく、次のIPCチャネルが公開される。

| API群 | IPCチャネル | 処理先 |
|---|---|---|
| Workspace | `workspace:load` | `WorkspaceDatabase.loadWorkspace()` |
| Workspace | `workspace:bootstrap` | `WorkspaceDatabase.bootstrap()` |
| Workspace | `workspace:meta` | `WorkspaceDatabase.getMeta()` |
| Entity | `entity:list` | `WorkspaceDatabase.list()` |
| Entity | `entity:get` | `WorkspaceDatabase.get()` |
| Entity | `entity:save` | `WorkspaceDatabase.save()` |
| Entity | `entity:save-many` | `WorkspaceDatabase.saveMany()` |
| Entity | `entity:remove` | `WorkspaceDatabase.remove()` |
| Entity | `entity:restore` | `WorkspaceDatabase.restore()` |
| Snapshot | `snapshot:export` | DB読込 + ZIP作成 + 保存ダイアログ |
| Snapshot | `snapshot:inspect` | ZIP読込 + チェック + 差分計算 |
| Snapshot | `snapshot:apply` | 選択された差分のDB反映 |

RendererからIPCを直接呼ばず、`electron/preload.cjs`の`contextBridge`と`src/services/workspaceApi.js`を通す。

### データベース

- `better-sqlite3`を利用する同期型SQLite。
- DBファイルは`app.getPath("userData")/research-desk.sqlite`。
- WALモードを有効化している。
- 主要テーブル:
  - `workspace_meta`: schema version、workspace ID、device ID。
  - `entities`: 全エンティティ共通のJSONブロブストア。
  - `plan_revisions`: Itemの日程・進捗変更履歴。
- `entities`は`entity_type + id`を主キーとし、業務項目の大半を`data_json`に保存する。保存前に`electron/domain.mjs`で共通検証と正規化を行う。
- `deleted_at`による論理削除、`version`による版管理、`device_id`と`source`による由来管理を行う。
- ThemeやItemごとの専用テーブル、DB外部キーはない。エンティティ間参照はJSON内のIDで表現する。
- 保存時はDB serviceが参照先の存在を検証する。Theme、Item、Note、Person、SourceRecordなどの削除時は、主要データの参照を退避して外し、Dependency、Relation、FieldValueなど親なしでは意味を持たない補助データを論理削除する。
- 削除に伴う参照解除と補助データ削除には親Entityの印を残し、Undo時に所属、親子関係、依存線などを復元する。

### 認証

- 認証機能は実装されていない。
- ユーザー、セッション、ログイン、権限、トークン検証に該当するコードやテーブルはない。
- ローカルの単一利用者を前提としている。
- Electronでは`contextIsolation: true`、`nodeIntegration: false`でRendererの権限を絞っている。これは認証ではなくプロセス境界の保護である。

### 外部サービス

- SharePoint、OneDrive、Teams、Outlook、ChatGPT、Copilot、GitHubなどは`Link`や`SourceRecord`の種別として扱うだけで、API連携や同期は実装されていない。
- URLをクリックするとElectron main processの`shell.openExternal()`でOS既定ブラウザ等へ渡す。
- AI連携は外部API呼び出しではなく、JSON/YAMLの貼り付けImportとMarkdown/YAML/JSONのクリップボードExport。
- Snapshot ZIPはローカルファイルシステムへ書き出し・読み込みする。ユーザーがOneDrive等へ置くことはできるが、自動同期はしない。
- Google FontsからNunitoを読み込む。ネットワーク上の実依存として確認できるのはこれだけである。
- `src/data/initialData.js`の`example.com` URLは初期サンプルデータであり、サービス連携ではない。

### 設定・環境変数

- `.env`や`process.env`、`import.meta.env`を利用する実装はない。
- Vite設定は`vite.config.mjs`。`base: "./"`としてElectronの`file://`読み込みに対応する。
- アプリ設定・ビルド設定は`package.json`。
- UIテーマはSQLiteの`workspace_meta.theme_mode`に保存する。
- WorkspaceはSQLiteの`entities`と`plan_revisions`へ保存する。
- DBが空の場合は`src/data/initialData.js`から初期Workspaceを作る。
- デザイン設定は`design-standard/tokens.css`と`src/styles.css`。

### デプロイ・ビルド

- 開発: `npm run dev`でrendererをビルドし、Electronを起動する。
- Webビルド: `npm run build`で`dist/`を生成する。
- デスクトップ起動: `npm run desktop`でビルド後にElectronを起動する。
- デスクトップSmoke Test: `npm run smoke:desktop`。Note作成、保存、再読み込み後の永続化を検証する。
- 配布: `npm run package`でelectron-builderがWindows x64 NSISインストーラーを`release/`へ生成する。
- 配布物には`dist/**/*`、`electron/**/*`、`package.json`を含める。

### 画面構造

すべての主要画面は`src/App.jsx`内の関数コンポーネントである。

| hash route | 画面 | 実装 | 主な子コンポーネント | 呼び出すAPI |
|---|---|---|---|---|
| `#home` | Theme Dashboard | `HomePage` | `PageHeader`, `Metric`, `SimpleRows`, `StatusBadge`, `EntityDrawer` | Entity save/remove/restore |
| `#todo` | ToDo | `TodoPage` | `Metric`, 一覧、貼付Import、`EntityDrawer` | Item save/remove/restore |
| `#timeline` | Timeline/Gantt | `TimelinePage` | `GanttItemRow`, `TimeAxis`, `DependencyOverlay`, `LightningOverlay` | Item save |
| `#milestones` | Milestone Map | `MilestonePage` | `PageHeader`, `SimpleRows`, `EntityDrawer` | Item save/remove |
| `#themes` | Theme一覧 | `ThemesPage` | Theme card, `StatusBadge` | Theme save/remove |
| `#notes` | Notes/Links一覧 | `NotesPage` | 検索、`NoteDetailDrawer`, `DetailDrawer` | Note/Link save/remove |
| `#waiting` | Waiting一覧 | `WaitingPage` | `StatusBadge`, `EntityDrawer` | Item save/remove |
| `#ai-io` | AI Import / Export | `ImportExportPage` | Import preview、Export formatter | SourceRecord/Item/Note/Link/ImportBatch save |
| `#settings` | Settings / Snapshot | `SettingsPage` | Person editor、Snapshot preview | Person save、Snapshot export/inspect/apply |

全画面共通の右ドロワーは`EntityDrawer`で、詳細表示と編集フォームを切り替える。`EditDrawer`と`saveForm()`が複数エンティティの編集を共通処理する。

### データの流れ

1. 起動時に`App.loadWorkspace()`が`workspaceApi.load()`を呼ぶ。
2. デスクトップ版では`window.researchDesk.workspace.bootstrap()`を経て`workspace:bootstrap` IPCへ進む。
3. DBが空なら`buildBootstrapWorkspace()`の初期データを登録し、空でなければ既存Workspaceを返す。
4. `App`が返却値を`workspace` stateへ保存する。
5. `useMemo`で論理削除済みデータを除外した`data`を作り、各画面へpropsで渡す。
6. ユーザー操作はページ固有handler、または共通`saveForm()`へ入る。
7. `saveEntity()`が`workspaceApi.save()`を呼ぶ。
8. IPC経由で`WorkspaceDatabase.save()`が`entities`へUPSERTする。
9. Itemの日程・進捗が変わった場合は、同じSQLite transaction内で`plan_revisions`へ履歴を追加する。
10. 保存されたEntityがRendererへ返り、`replaceEntity()`が`workspace` stateの該当配列を差し替える。
11. Reactが再描画し、Toastで結果を通知する。

### モジュール間の依存関係

```text
src/main.jsx
  -> src/App.jsx
  -> src/styles.css

src/App.jsx
  -> src/services/workspaceApi.js
  -> src/utils/dataFormat.js

src/services/workspaceApi.js
  -> src/data/workspace.js
  -> window.researchDesk (preloadが公開)

src/data/workspace.js
  -> src/data/initialData.js

electron/main.mjs
  -> electron/database.mjs
  -> electron/snapshots.mjs
  -> Electron APIs

electron/preload.cjs
  -> Electron ipcRenderer

electron/snapshots.mjs
  -> electron/database.mjs の型・schema version定義
  -> adm-zip

electron/database.mjs
  -> better-sqlite3
```

依存が集中している重要ファイル:

- `src/App.jsx`: 全画面、状態、フォーム、画面遷移、業務ロジックが集中する最大の変更ホットスポット。
- `src/services/workspaceApi.js`: Rendererから許可済みElectron APIだけを呼ぶ境界。
- `electron/main.mjs`: IPC、OS機能、DB初期化、外部URL処理の接続点。
- `electron/database.mjs`: 全Entityの永続化ルールとSnapshot反映の正本。
- `ENTITY_KEYS`と`ENTITY_TYPES`: RendererとDBで別々にエンティティ一覧を持つため、追加時に同時更新が必要。

循環依存:

- import文を基準にした循環依存は確認できない。
- `electron/snapshots.mjs -> electron/database.mjs`は一方向。

密結合・注意箇所:

- `src/App.jsx`が約1500行の単一モジュールで、UIと業務ロジックが強く結合している。
- ページは`App`の共通関数とWorkspace全体をpropsで受けるため、独立テストが難しい。
- `saveForm()`が多数のEntity schemaを知っており、新Entityや項目追加の影響が集中する。
- `ENTITY_KEYS`の`dependency -> dependencys`、`import_batch -> import_batchs`は非標準複数形だが、DBの`loadWorkspace()`も同じ単純な`s`付与を使うため暗黙に結合している。
- DBがJSONブロブ中心のため、schema変更は軽い一方、DB制約、参照整合性、列単位検索・migrationが弱い。
- Electron IPC handlerは引数の構造検証を行わず、Rendererから渡されたEntityをDB層の許可type確認だけで保存する。
- Snapshotの`pendingSnapshots`はmain processのメモリ上にあり、再起動するとプレビューtokenは無効になる。これは意図された一時状態。
- Snapshot v2は論理削除済みEntityとPlan Revisionを含み、端末間で削除と予定変更履歴を受け渡す。

### 変更影響範囲

#### 新しい画面を追加する

主な影響:

- `src/App.jsx`
  - 画面コンポーネント追加。
  - `pages` mapへroute追加。
  - `CROSS_NAV_ITEMS`または`TOOL_NAV_ITEMS`へ導線追加。
  - 必要なら`Sidebar`や`EntityDrawer`を更新。
- `src/styles.css`
  - 新画面固有のレイアウト。
- `design-standard/tokens.css`
  - 原則変更不要。変更する場合は事前確認が必要。

データを保存する画面なら、さらに`saveForm()`、`ENTITY_KEYS`、`workspaceApi`、DB Entity typeへの影響を確認する。

#### APIを追加する

IPC API追加の場合:

- `src/services/workspaceApi.js`: Renderer向けメソッド。
- `electron/preload.cjs`: `contextBridge`公開メソッド。
- `electron/main.mjs`: `ipcMain.handle()`。
- `electron/database.mjs`または新しいmain-process service: 実処理。
- `src/App.jsx`: 呼び出し元UIと状態更新。

HTTP APIを新設する場合は現行構造に存在しないサーバー導入になるため、技術選定と境界設計を先に行う必要がある。

#### DBの項目を追加する

既存EntityのJSON項目追加:

- `src/App.jsx`: `saveForm()`、編集Field、詳細表示、一覧・Export・Import。
- `src/data/workspace.js`: 初期移行時の変換。
- `src/data/initialData.js`: 初期値が必要な場合。
- `electron/snapshots.mjs`: JSON Entityは自動で含まれるが、summary表示対象なら更新。
- `docs/SPEC.md`: データモデル仕様。

専用SQL列・テーブル追加:

- `electron/database.mjs`: `SCHEMA_VERSION`、`migrate()`、読書き処理。
- `electron/snapshots.mjs`: Snapshot対象・互換性。
- 必要に応じて`workspaceApi`、preload、IPC。

注意: 現行`migrate()`はschema versionを常に上書きするだけで、version別migration手順はまだない。

#### 認証処理を変更する

現状は認証がないため、「変更」ではなく新規導入になる。

推測: ローカルロックのみなら`electron/main.mjs`、`electron/preload.cjs`、起動時UI、秘密情報の安全な保存層が主な変更点になる。

推測: クラウド認証なら、ログイン画面、認証state、OAuth callback、token保管、API client、IPC許可、DBのユーザー/Workspace所属、ログアウト時のデータ分離まで広範囲に影響する。`localStorage`へのtoken保存は避けるべきである。

#### 外部サービス連携を変更する

現在の「URLを保存して外部で開く」方式の変更:

- `src/App.jsx`: Link/SourceRecordフォーム、表示、Import/Export。
- `electron/main.mjs`: URL許可、`shell.openExternal()`、必要ならOAuthやファイル操作。
- `electron/preload.cjs`と`src/services/workspaceApi.js`: 新IPC。
- `electron/database.mjs`: credential以外の連携metadataや同期状態。
- `package.json`: SDK依存を追加する場合。

推測: OAuth/API同期を追加する場合は、認証情報をRendererやEntity JSONへ直接保存せず、OS credential store等をmain processから扱う構成が必要になる。

## B. C4モデル風の構造整理

### System Context

**中心System: Research Desk**

- 利用者: 単一のローカルユーザー。
- 目的: 研究テーマ、予定、タスク、メモ、リンク、待ち状態、情報源、バックアップを管理する。
- 外部との関係:
  - OSファイルシステムへSQLiteとSnapshot ZIPを保存。
  - 外部URLをOS既定アプリで開く。
  - クリップボードを介して外部AIと構造化データを交換。
  - Google Fontsからフォントを取得。
- 認証サービス、クラウドDB、外部AI APIとは接続しない。

### Container

1. **React Renderer**
   - `src/main.jsx`, `src/App.jsx`, `src/styles.css`
   - 画面描画、ユーザー操作、UI state、Workspace stateを担当。

2. **Renderer API Adapter**
   - `src/services/workspaceApi.js`
   - Electron preload APIの呼び出しを集約。

3. **Electron Preload Bridge**
   - `electron/preload.cjs`
   - 許可したIPCだけを`window.researchDesk`として公開。

4. **Electron Main Process**
   - `electron/main.mjs`
   - ウィンドウ、IPC、OSダイアログ、外部URL、DB lifecycleを担当。

5. **Persistence Component**
   - `electron/database.mjs`
   - SQLite CRUD、論理削除、revision、Snapshot mergeを担当。

6. **Snapshot Component**
   - `electron/snapshots.mjs`
   - ZIP生成、manifest/checksum、読込検証を担当。

7. **SQLite Database**
   - Electron userData内の`research-desk.sqlite`。

### Component

Renderer内:

- `App`: Workspaceのロード、共通state、route、CRUD coordinator。
- `Sidebar`: route/theme選択、Quick Capture。
- Page群: Home、ToDo、Timeline、Milestone、Themes、Notes、Waiting、AI I/O、Settings。
- `EntityDrawer`: Entity詳細・編集の共通入口。
- `saveForm`: Entity別フォーム値を保存payloadへ変換。
- Timeline部品: Gantt row、time axis、dependency、lightning。
- Import/Export helper: JSON/YAML parse、scope抽出、Markdown生成。

Main process内:

- `registerIpc`: IPC endpoint登録。
- `WorkspaceDatabase`: DB service。
- `createSnapshot` / `readSnapshot`: ZIP service。
- `createWindow`: Rendererを読み込み、外部遷移を制御。

### Code levelで見るべき重要ファイル

1. `src/App.jsx`: 画面一覧、state、操作、CRUD、画面間のつながり。
2. `src/services/workspaceApi.js`: Rendererから永続化層へ進む入口。
3. `electron/preload.cjs`: Rendererに公開された権限の全量。
4. `electron/main.mjs`: IPCとOS境界。
5. `electron/database.mjs`: DB schemaと保存規則。
6. `electron/snapshots.mjs`: バックアップ形式とImport安全性。
7. `src/data/workspace.js`: 旧データから現行Workspaceへの変換。
8. `package.json`: 起動、ビルド、配布、依存関係。
9. `src/styles.css`と`design-standard/tokens.css`: UI標準の実装。

## C. リッチ図作成用のノード・エッジ一覧

推測した接続は各descriptionの先頭に`推測:`を付ける。このJSON内には、実装から確認できた接続のみを収録している。

```json
{
  "nodes": [
    {
      "id": "user",
      "label": "Local User",
      "type": "external",
      "path": "",
      "description": "Research Deskを操作する単一のローカル利用者",
      "importance": "high"
    },
    {
      "id": "app-root",
      "label": "App / Workspace State",
      "type": "component",
      "path": "src/App.jsx",
      "description": "全画面、hash route、Workspace state、CRUD coordinator",
      "importance": "high"
    },
    {
      "id": "sidebar",
      "label": "Sidebar / Quick Capture",
      "type": "component",
      "path": "src/App.jsx",
      "description": "画面遷移、Theme選択、Inboxへのクイック記録",
      "importance": "medium"
    },
    {
      "id": "screen-home",
      "label": "Theme Dashboard",
      "type": "screen",
      "path": "src/App.jsx#HomePage",
      "description": "選択Themeの現在地、指標、マイルストーン、タスク、メモ",
      "importance": "high"
    },
    {
      "id": "screen-todo",
      "label": "ToDo",
      "type": "screen",
      "path": "src/App.jsx#TodoPage",
      "description": "タスク整理、一括更新、CSV/TSV貼り付けImport",
      "importance": "high"
    },
    {
      "id": "screen-timeline",
      "label": "Timeline",
      "type": "screen",
      "path": "src/App.jsx#TimelinePage",
      "description": "Theme別Gantt、依存線、計画と実績、ドラッグ日程変更",
      "importance": "high"
    },
    {
      "id": "screen-milestones",
      "label": "Milestone Map",
      "type": "screen",
      "path": "src/App.jsx#MilestonePage",
      "description": "期間別の重要マイルストーン一覧",
      "importance": "medium"
    },
    {
      "id": "screen-themes",
      "label": "Themes",
      "type": "screen",
      "path": "src/App.jsx#ThemesPage",
      "description": "Theme横断一覧とTheme Dashboardへの入口",
      "importance": "medium"
    },
    {
      "id": "screen-notes",
      "label": "Notes / Links",
      "type": "screen",
      "path": "src/App.jsx#NotesPage",
      "description": "NoteとLinkの統合検索・一覧",
      "importance": "high"
    },
    {
      "id": "screen-waiting",
      "label": "Waiting",
      "type": "screen",
      "path": "src/App.jsx#WaitingPage",
      "description": "待ち状態のItem一覧",
      "importance": "medium"
    },
    {
      "id": "screen-ai-io",
      "label": "AI Import / Export",
      "type": "screen",
      "path": "src/App.jsx#ImportExportPage",
      "description": "JSON/YAMLのプレビューImportとMarkdown/YAML/JSON Export",
      "importance": "high"
    },
    {
      "id": "screen-settings",
      "label": "Settings / Snapshot",
      "type": "screen",
      "path": "src/App.jsx#SettingsPage",
      "description": "テーマ表示、Person管理、Snapshot Export/Import",
      "importance": "high"
    },
    {
      "id": "entity-drawer",
      "label": "Entity Drawer",
      "type": "component",
      "path": "src/App.jsx#EntityDrawer",
      "description": "Entity詳細、編集、削除、関係・依存追加の共通UI",
      "importance": "high"
    },
    {
      "id": "save-form",
      "label": "Entity Form Mapper",
      "type": "component",
      "path": "src/App.jsx#saveForm",
      "description": "フォーム値をEntity別保存payloadへ変換",
      "importance": "high"
    },
    {
      "id": "workspace-api",
      "label": "workspaceApi",
      "type": "api",
      "path": "src/services/workspaceApi.js",
      "description": "RendererからElectron preload APIを呼ぶadapter",
      "importance": "high"
    },
    {
      "id": "legacy-mapper",
      "label": "Legacy Workspace Mapper",
      "type": "component",
      "path": "src/data/workspace.js",
      "description": "初期データを現行Workspaceへ変換",
      "importance": "medium"
    },
    {
      "id": "preload-bridge",
      "label": "Preload Bridge",
      "type": "api",
      "path": "electron/preload.cjs",
      "description": "window.researchDeskとして許可済みIPCを公開",
      "importance": "high"
    },
    {
      "id": "electron-main",
      "label": "Electron Main / IPC Server",
      "type": "server",
      "path": "electron/main.mjs",
      "description": "BrowserWindow、IPC、dialog、external URL、DB lifecycle",
      "importance": "high"
    },
    {
      "id": "workspace-db-service",
      "label": "WorkspaceDatabase",
      "type": "server",
      "path": "electron/database.mjs",
      "description": "Entity CRUD、論理削除、revision、Snapshot merge",
      "importance": "high"
    },
    {
      "id": "sqlite-db",
      "label": "research-desk.sqlite",
      "type": "db",
      "path": "<Electron userData>/research-desk.sqlite",
      "description": "workspace_meta、entities、plan_revisionsを保持",
      "importance": "high"
    },
    {
      "id": "snapshot-service",
      "label": "Snapshot ZIP Service",
      "type": "server",
      "path": "electron/snapshots.mjs",
      "description": "ZIP、manifest、SHA-256 checksumの作成・検証",
      "importance": "high"
    },
    {
      "id": "local-filesystem",
      "label": "Local File System",
      "type": "external",
      "path": "",
      "description": "SQLite、Snapshot ZIP、外部ローカルファイルの保存先",
      "importance": "high"
    },
    {
      "id": "external-links",
      "label": "External URLs / OS Apps",
      "type": "external",
      "path": "",
      "description": "SharePoint等の保存URLをOS既定アプリで開く。API同期ではない",
      "importance": "medium"
    },
    {
      "id": "clipboard-ai",
      "label": "Clipboard / External AI",
      "type": "external",
      "path": "",
      "description": "JSON/YAML/Markdownの手動コピー&ペースト境界",
      "importance": "medium"
    },
    {
      "id": "google-fonts",
      "label": "Google Fonts",
      "type": "external",
      "path": "index.html",
      "description": "Nunito Web Fontを配信",
      "importance": "low"
    },
    {
      "id": "vite-config",
      "label": "Vite Config",
      "type": "config",
      "path": "vite.config.mjs",
      "description": "React plugin、relative base、dist出力",
      "importance": "medium"
    },
    {
      "id": "build-config",
      "label": "Build / Package Config",
      "type": "config",
      "path": "package.json",
      "description": "npm scripts、Electron entry、electron-builder NSIS設定",
      "importance": "high"
    },
    {
      "id": "design-tokens",
      "label": "Design Tokens",
      "type": "config",
      "path": "design-standard/tokens.css",
      "description": "色、余白、角丸、文字、状態色の正本",
      "importance": "medium"
    }
  ],
  "edges": [
    {
      "from": "user",
      "to": "sidebar",
      "type": "calls",
      "description": "ナビゲーションとQuick Captureを操作する"
    },
    {
      "from": "user",
      "to": "entity-drawer",
      "type": "calls",
      "description": "Entityの詳細確認・編集・削除を行う"
    },
    {
      "from": "app-root",
      "to": "sidebar",
      "type": "renders",
      "description": "共通Sidebarを描画する"
    },
    {
      "from": "app-root",
      "to": "screen-home",
      "type": "renders",
      "description": "hash route homeで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-todo",
      "type": "renders",
      "description": "hash route todoで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-timeline",
      "type": "renders",
      "description": "hash route timelineで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-milestones",
      "type": "renders",
      "description": "hash route milestonesで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-themes",
      "type": "renders",
      "description": "hash route themesで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-notes",
      "type": "renders",
      "description": "hash route notesで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-waiting",
      "type": "renders",
      "description": "hash route waitingで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-ai-io",
      "type": "renders",
      "description": "hash route ai-ioで描画する"
    },
    {
      "from": "app-root",
      "to": "screen-settings",
      "type": "renders",
      "description": "hash route settingsで描画する"
    },
    {
      "from": "app-root",
      "to": "entity-drawer",
      "type": "renders",
      "description": "選択Entityの共通右ドロワーを描画する"
    },
    {
      "from": "entity-drawer",
      "to": "save-form",
      "type": "calls",
      "description": "編集フォームsubmitを共通mapperへ渡す"
    },
    {
      "from": "sidebar",
      "to": "workspace-api",
      "type": "calls",
      "description": "Quick CaptureしたItemを保存する"
    },
    {
      "from": "save-form",
      "to": "workspace-api",
      "type": "calls",
      "description": "Entity save/remove/restoreを呼ぶ"
    },
    {
      "from": "screen-todo",
      "to": "workspace-api",
      "type": "calls",
      "description": "Itemの追加、一括更新、完了切替を行う"
    },
    {
      "from": "screen-timeline",
      "to": "workspace-api",
      "type": "calls",
      "description": "ドラッグ後の日程をItemとして保存する"
    },
    {
      "from": "screen-ai-io",
      "to": "workspace-api",
      "type": "calls",
      "description": "SourceRecord、Entity、ImportBatchを保存する"
    },
    {
      "from": "screen-settings",
      "to": "workspace-api",
      "type": "calls",
      "description": "Snapshot export/inspect/applyを呼ぶ"
    },
    {
      "from": "screen-ai-io",
      "to": "clipboard-ai",
      "type": "writes",
      "description": "構造化Exportをクリップボードへ書く"
    },
    {
      "from": "clipboard-ai",
      "to": "screen-ai-io",
      "type": "writes",
      "description": "外部AI等で作成したJSON/YAMLをユーザーが貼り付ける"
    },
    {
      "from": "screen-notes",
      "to": "external-links",
      "type": "calls",
      "description": "保存済みURLを新しい外部ウィンドウで開く"
    },
    {
      "from": "workspace-api",
      "to": "preload-bridge",
      "type": "calls",
      "description": "デスクトップ版ではwindow.researchDeskを呼ぶ"
    },
    {
      "from": "workspace-api",
      "to": "legacy-mapper",
      "type": "calls",
      "description": "初期Workspaceまたは旧データ移行値を作る"
    },
    {
      "from": "preload-bridge",
      "to": "electron-main",
      "type": "calls",
      "description": "ipcRenderer.invokeでmain processのhandlerを呼ぶ"
    },
    {
      "from": "electron-main",
      "to": "workspace-db-service",
      "type": "calls",
      "description": "WorkspaceとEntityのCRUDを委譲する"
    },
    {
      "from": "workspace-db-service",
      "to": "sqlite-db",
      "type": "reads",
      "description": "Workspace、Entity、revision、metaを読む"
    },
    {
      "from": "workspace-db-service",
      "to": "sqlite-db",
      "type": "writes",
      "description": "Entity UPSERT、論理削除、revision、metaを書き込む"
    },
    {
      "from": "electron-main",
      "to": "snapshot-service",
      "type": "calls",
      "description": "Snapshot ZIPの作成・読込を委譲する"
    },
    {
      "from": "snapshot-service",
      "to": "workspace-db-service",
      "type": "imports",
      "description": "Entity type一覧とschema versionを参照する"
    },
    {
      "from": "snapshot-service",
      "to": "local-filesystem",
      "type": "reads",
      "description": "選択されたSnapshot ZIPを読む"
    },
    {
      "from": "snapshot-service",
      "to": "local-filesystem",
      "type": "writes",
      "description": "Snapshot ZIPを書き出す"
    },
    {
      "from": "sqlite-db",
      "to": "local-filesystem",
      "type": "writes",
      "description": "Electron userData配下のローカルDBファイルとして存在する"
    },
    {
      "from": "electron-main",
      "to": "external-links",
      "type": "calls",
      "description": "shell.openExternalで外部URLまたはfile URLを開く"
    },
    {
      "from": "app-root",
      "to": "design-tokens",
      "type": "configures",
      "description": "styles.css経由でライト/ダークのデザイントークンを利用する"
    },
    {
      "from": "vite-config",
      "to": "app-root",
      "type": "configures",
      "description": "React Rendererをdistへビルドする"
    },
    {
      "from": "build-config",
      "to": "electron-main",
      "type": "configures",
      "description": "Electron entry、desktop起動、NSIS packageを定義する"
    },
    {
      "from": "google-fonts",
      "to": "app-root",
      "type": "configures",
      "description": "index.htmlからNunito fontを提供する"
    }
  ]
}
```

## D. 図にするときのおすすめレイアウト

- 左から右に`User -> Screens -> App State / Form Mapper -> workspaceApi -> Preload / IPC -> Database Service -> SQLite / File System / External`の順に置く。
- Renderer、Electron Boundary、Persistence、Externalの4グループに分ける。
- `src/App.jsx`は大きな親ノードにし、その内部に各画面、Sidebar、Entity Drawerを配置する。
- `workspaceApi`はRendererからPreload Bridgeへ進む単一経路として配置する。
- `Preload Bridge`をRendererとMain Processの境界線上に置く。
- `WorkspaceDatabase`と`SQLite`を別ノードにし、アプリロジックと物理保存を区別する。
- 認証は「未実装」と書いた灰色の注記にする。実ノードとして処理線へ接続しない。
- DBは青、外部URL/AI/Google Fontsは緑、認証未実装は灰、Snapshot/File Systemは橙などで色分けする。
- importance=`high`は大きく、`src/App.jsx`、`workspaceApi`、Preload、Electron Main、WorkspaceDatabase、SQLiteを主経路として強調する。
- 推測の将来接続を追加する場合だけ点線にする。上記JSONのedgeは実装確認済みなので実線でよい。
- 画面詳細図では、各画面から`EntityDrawer`と`workspaceApi`へ線を集約し、画面ごとにIPCまで重複配線しない。

## E. 代表的な処理フロー

代表機能として「Timelineで期間Itemをドラッグし、予定を更新する」流れを選ぶ。

1. ユーザーがTimelineを開く。
   - `src/App.jsx`の`pages.timeline`が`TimelinePage`を描画する。
   - `TimelinePage`は`workspace.items`から表示対象を絞り、`buildTimelineRows()`でTheme別レーンを作る。

2. ユーザーがGanttバーをドラッグする。
   - `GanttItemRow.beginDrag()`がpointer移動量を日数差へ変換する。
   - 移動結果を`TimelinePage.moveItem(item, delta, mode)`へ渡す。

3. Renderer内で次のItemを組み立てる。
   - `moveItem()`が`planned_start`、`planned_end`、必要なら`due_date`を`addDays()`でずらす。
   - 終了日が開始日より前になる場合は保存せずToastを出す。

4. 共通保存処理を呼ぶ。
   - `TimelinePage`から`App.saveEntity("item", next)`を呼ぶ。
   - `saveEntity()`は`src/services/workspaceApi.js`の`workspaceApi.save()`を呼ぶ。

5. RendererからElectronへ渡す。
   - デスクトップ版では`window.researchDesk.entities.save()`を呼ぶ。
   - `electron/preload.cjs`が`ipcRenderer.invoke("entity:save", type, entity, options)`を実行する。

6. Main processがDB serviceを呼ぶ。
   - `electron/main.mjs`の`ipcMain.handle("entity:save", ...)`が受信する。
   - `WorkspaceDatabase.save()`へ渡す。

7. SQLite transactionで履歴とEntityを更新する。
   - `electron/database.mjs`が既存Itemを読む。
   - `recordPlanRevision()`が日程・進捗差分を比較する。
   - 差分があれば`plan_revisions`へ旧値、新値、理由をINSERTする。
   - 同じtransactionで`entities`のItem JSONをUPSERTする。

8. 保存結果を画面へ反映する。
   - 保存済みItemがIPC responseとしてRendererへ戻る。
   - `App.replaceEntity()`が`workspace.items`内のItemを差し替える。
   - ReactがTimelineを再描画し、変更後のバー位置を表示する。
   - `saveEntity()`が「変更を保存しました。」Toastを表示する。

## F. 初心者が読むべき順番

1. `README.md`
   - アプリの目的、起動方法、主要画面を把握する。

2. `package.json`
   - React/Vite/Electron/SQLiteという技術構成と、dev/build/packageの流れを把握する。

3. `src/main.jsx`
   - Rendererの入口が`App`だけであることを確認する。

4. `src/App.jsx`の`App`関数と`pages` map
   - Workspace state、hash route、全画面の入口を理解する。

5. `src/App.jsx`の`Sidebar`と各Page
   - 通常操作でどの画面へ到達し、何を表示・操作するかを追う。

6. `src/App.jsx`の`EntityDrawer`、`EditDrawer`、`saveForm`
   - 詳細、編集、削除、Entity別payload生成を理解する。

7. `src/services/workspaceApi.js`
   - UIから永続化へ渡る共通APIと、Electron/ブラウザ分岐を理解する。

8. `electron/preload.cjs`
   - Rendererに何の権限が公開されているかを確認する。

9. `electron/main.mjs`の`registerIpc()`
   - API endpointとOS機能の接続を理解する。

10. `electron/database.mjs`
    - SQLite schema、CRUD、論理削除、Plan Revision、Snapshot mergeを理解する。

11. `electron/snapshots.mjs`
    - バックアップのファイル形式、checksum、schema互換性を理解する。

12. `src/data/workspace.js`と`src/data/initialData.js`
    - 初回起動と旧データ移行の仕組みを理解する。

13. `src/styles.css`と`design-standard/design-guide.md`
    - UI実装を変更するときのデザイン規則を確認する。

14. `docs/SPEC.md`と`docs/PLAN.md`
    - 実装の背景、用語、将来構想を確認する。仕様書には将来案も含まれるため、実装済みかどうかはコードと`PLAN.md`で照合する。
