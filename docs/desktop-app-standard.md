# 個人用Electronアプリ標準

この文書は、個人用デスクトップアプリを新規作成・拡張するときの既定構成を定める。
迷ったときはこの構成を採用し、外す場合だけ理由を記録する。

## 1. 既定スタック

| 領域 | 既定 | 方針 |
|---|---|---|
| デスクトップ | Electron | RendererからNode.jsやDBを直接触らない |
| 言語 | TypeScript | Main、Preload、Renderer、共有契約をすべて型付けする |
| ビルド | electron-vite + Vite | Main、Preload、Rendererを一つの設定で開発・ビルドする |
| UI | React | 画面とユーザー操作に限定する |
| CSS | Tailwind CSS + design tokens | `tokens.css`を意味と実値の正本にする |
| アイコン | Tabler Icons | アプリ内で他セットと混在させない |
| 状態管理 | Zustand | 正式データ、UI状態、非同期状態の責任を分ける |
| DB | SQLite + better-sqlite3 | Main ProcessだけがDBへアクセスする |
| 配布 | electron-builder | Windows NSIS installerとportableを生成する |
| 更新 | electron-updater | 更新配布先があるアプリで有効化する |
| PDF | PDF.js | PDF閲覧・注釈が必要なアプリで追加する |

ライブラリのバージョンは新規作成時に安定版を確認して固定する。アプリ間でElectronの
メジャーバージョンを永久に揃えることより、各アプリで再現可能なlockfileと検証済みの
組み合わせを持つことを優先する。

## 2. 実行時の境界

```text
React Page / Component
  -> Zustand action
  -> window.api
  -> Preload
  -> typed IPC handler
  -> Service
  -> Repository
  -> SQLite / File System / OS API
```

### 必須ルール

1. Rendererから`electron`、Node.js、`better-sqlite3`をimportしない。
2. Rendererから`ipcRenderer`を直接呼ばない。必ず`window.api`を使う。
3. Preloadは許可したメソッドだけを`contextBridge`で公開する。
4. IPC channel名、引数、戻り値は`shared/`の型を正本にする。
5. IPC handlerでは入力を検証し、ServiceまたはRepositoryへ処理を委譲する。
6. RepositoryはDB操作だけを担当し、UI文言や画面状態を持たない。
7. 複数更新はRepositoryまたはServiceのtransaction内で完結させる。
8. DB、ファイル、更新、外部URL、クリップボードはMain Process側の権限として扱う。

`contextIsolation: true`と`nodeIntegration: false`は必須とする。
Chromium sandboxは対象Windows環境で配布版検証が通る場合に有効化する。

## 3. ディレクトリ構成

```text
src/
├── main/
│   ├── index.ts
│   ├── ipc/
│   │   ├── registerIpc.ts
│   │   └── handlers/
│   ├── repositories/
│   ├── services/
│   └── db/
├── preload/
│   ├── index.ts
│   └── api.ts
├── renderer/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── pages/
│       ├── components/
│       ├── features/
│       ├── stores/
│       ├── services/
│       ├── hooks/
│       ├── utils/
│       └── styles/
└── shared/
    ├── entities/
    ├── ipc/
    ├── schemas/
    └── constants/
```

- `pages/`: route単位の画面。データ取得の開始と画面構成を担当する。
- `features/`: Theme、Item、Noteなど業務機能単位。フォーム、一覧、変換処理をまとめる。
- `components/`: 3箇所以上で共有するUI部品。
- `stores/`: Zustand store。API呼び出しとRenderer側の正式状態を管理する。
- `renderer/services/`: `window.api`を使う薄いadapter。業務データを永続化しない。
- `main/ipc/`: IPC登録と入力検証。業務処理を直接書き込まない。
- `main/services/`: 複数RepositoryやOS機能をまたぐユースケース。
- `main/repositories/`: SQLiteのquery、transaction、row変換。
- `shared/`: Main、Preload、Rendererで共有する型と契約。環境依存APIを置かない。

## 4. TypeScriptの作法

- `strict: true`を必須にする。
- Entity、IPC request/response、Store stateを明示的に型付けする。
- `any`は外部ライブラリ境界以外では使わない。`unknown`から検証して絞り込む。
- IPC境界、Import、Snapshotなど外部入力は実行時schemaでも検証する。
- Renderer用の`window.api`型定義をglobal declarationとして提供する。
- DB row型とDomain Entity型を分け、Repositoryで変換する。
- enum風の値は文字列unionと`as const`を基本にする。

## 5. Zustandの作法

Storeは「何でも入れる箱」にしない。

```text
workspaceStore  正式データ、load/save/remove、loading/error
uiStore         route、drawer、toast、theme、selection
feature state   ページ内だけで完結する一時入力やフィルター
```

- 正式データの更新はStore action経由に統一する。
- API成功後にStoreを更新し、失敗時は入力と既存データを残す。
- 派生値はselectorまたは純粋関数で計算する。
- フォーム入力をすべてStoreへ入れない。閉じたら捨ててよい状態はcomponent stateでよい。
- StoreからDOM操作、dialog表示、React component生成をしない。

## 6. Tailwindとデザイントークン

Tailwindはデザインの正本ではなく、`design-standard/tokens.css`を使うための記法とする。

- 色、余白、角丸、文字サイズ、影、動きは既存トークンを参照する。
- Tailwindの既定色名を画面へ直接使わない。
- 任意値を場当たり的に増やさない。
- 再利用するUIはcomponent化し、長大なclass列を各画面へ複製しない。
- 複雑なガント、チャート、擬似要素、印刷スタイルは通常CSSを併用してよい。
- `tokens.css`とTailwind theme variableの対応は一箇所に置く。

Tailwind導入は「vanilla CSSを禁止する」という意味ではない。レイアウトと状態指定は
utilityを基本にし、アプリ固有の複雑な描画はCSSへ残す。

## 7. IPCの作法

channel文字列をMain、Preload、Rendererへ直書きしない。

```ts
export const IPC = {
  workspaceLoad: "workspace:load",
  entitySave: "entity:save",
} as const;
```

- channelごとにrequestとresponse型を定義する。
- Preload APIは業務語彙で公開し、汎用`invoke(channel, ...args)`を公開しない。
- エラーはMain側でログを残し、Rendererへは原因と直し方を含む安全な文言を返す。
- 長時間処理は進捗イベントとキャンセルを設計する。
- 新機能は`型 -> Repository -> Service -> IPC -> Preload -> Store -> UI`の順に接続する。

## 8. DBとRepository

- migrationは連番で追加し、適用済みmigrationを書き換えない。
- Repository単位は原則として集約または機能境界に合わせる。
- SQL、row変換、transactionをRepositoryへ閉じ込める。
- 参照整合性、論理削除、Undo、SnapshotはDB境界を越えて検証する。
- 一覧表示用の集計はRendererの読込済み配列ではなく、必要ならDB queryで全件から算出する。
- 保存後はアプリ再読み込みとDB再読込まで確認する。

## 9. 配布と更新

標準成果物:

- NSIS installer
- portable executable
- blockmapおよび更新metadata（自動更新を使う場合）

自動更新を有効化する条件:

1. 更新ファイルを配置する公開先または認証済み配布先がある。
2. コード署名と公開手順が決まっている。
3. 更新確認、利用可能、download中、download済み、失敗のUIがある。
4. 更新失敗でも現在版を起動できる。

更新機構だけを先に入れて配布先未設定のままにしない。

## 10. 完成条件

最低限、次を自動または実画面で確認する。

1. TypeScript typecheck。
2. Main、Preload、Rendererのproduction build。
3. Repositoryのtransactionとmigration。
4. 作成、一覧、詳細、編集、論理削除、Undo。
5. アプリ再読み込み後のSQLite復元。
6. Import失敗時に既存データと入力が残る。
7. packaged executableの起動。
8. installerとportableの生成。
9. 自動更新を使う場合はテスト用更新先で一往復。

## 11. 採用判断

### 常に採用

- Electron三層分離
- TypeScript strict
- electron-vite
- React
- SQLite + Repository
- typed IPC + restricted Preload API
- design tokens
- packaged executableでの検証

### 規模に応じて採用

- Zustand: 複数画面で正式データや非同期状態を共有するアプリ
- Tailwind: Reactで複数画面を持つアプリ
- PDF.js: PDF表示が製品機能に含まれるアプリ
- electron-updater: 継続配布するアプリ

### 標準では採用しない

- RendererからのNode.js直接利用
- 汎用IPC passthrough
- CSS-in-JS
- 複数アイコンセットの混在
- DB Entityをそのまま画面componentへ対応させる構成
- 見栄え用seedや未接続画面
