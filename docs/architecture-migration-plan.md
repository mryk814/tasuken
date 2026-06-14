# Research Desk アーキテクチャ移行計画

## 移行結果

構造移行は2026-06-14に完了した。

- Main / Preload / Rendererはelectron-viteの`out/`へ統合出力する。
- `src/shared/ipc/contracts.ts`をIPC channelと`window.api`型の正本とした。
- MainはIPC、Workspace Repository、Snapshot/OS Serviceへ分割した。
- Rendererの正式Workspaceデータと共有UI状態はZustand Storeを経由する。
- `App.tsx`はルート構成だけを持ち、既存画面群はworkspace featureへ移した。
- Tailwindはtokens.cssを参照する補助層として導入し、既存の複雑なGantt CSSを維持した。
- NSIS installerとportableを標準成果物にした。
- 既存SQLite schema version 1とSnapshot v2は変更していない。

互換性を優先し、画面feature内部の大きなJSXは一括変換していない。新しいMain、Preload、
shared契約、Store、entryはTypeScript strictであり、画面内部は機能変更時に小さく分割して
TypeScript化する。これは実行構造の移行完了後の保守改善で、旧実行経路は残していない。

基準確認:

- `npm run typecheck`
- `npm run build`
- `npm run smoke:model`
- `npm run smoke:desktop`
- `npm run package`

## 目的

Research Deskを、[`desktop-app-standard.md`](./desktop-app-standard.md)で定めた
個人用Electronアプリ標準の参照実装へ移行する。

機能追加ではなく、既存のSQLiteデータ、画面挙動、Snapshot互換性を維持したまま
開発基盤と責任分割を整える。

## 移行後の構成

```text
src/main          Electron Main、IPC、Repository、Service
src/preload       typed window.api
src/renderer      React、Zustand、Tailwind、画面
src/shared        Entity型、IPC契約、schema、定数
```

採用:

- TypeScript strict
- electron-vite
- React 19
- Zustand
- Tailwind CSS
- Tabler Icons
- SQLite + better-sqlite3
- electron-builder
- NSIS + portable

今回は保留:

- PDF.js: PDF閲覧機能の設計時に追加する。
- electron-updater: 更新配布先とコード署名方針を決めてから追加する。

## 非交渉の互換条件

1. 既存`research-desk.sqlite`をそのまま読める。
2. DB schema versionとSnapshot formatを不要に変更しない。
3. Theme、Item、Note、Link、Person等のCRUD結果を変えない。
4. 論理削除、Undo、参照退避、Plan Revisionを維持する。
5. `design-standard/tokens.css`を見た目の正本として維持する。
6. 移行中も各phase終了時にpackage可能な状態へ戻す。

## Phase 0: 基準固定

- 現行の`build`、`smoke:model`、`smoke:desktop`、`package`を通す。
- SQLiteとSnapshotのfixtureまたはハッシュを保存する。
- 主要画面の操作smokeを固定する。
- 既存IPC一覧と`window.researchDesk` APIを記録する。

完了条件:

- 移行前の動作基準を自動比較できる。

## Phase 1: electron-viteとTypeScript基盤

- `electron.vite.config.ts`を追加する。
- Main、Preload、Rendererのentryを`src/`配下へ移す。
- `tsconfig.node.json`、`tsconfig.web.json`を追加し、`strict: true`にする。
- `package.json`のentryとscriptsをelectron-viteへ切り替える。
- electron-builderのfilesを`out/`中心へ変更する。
- まず既存JSを`allowJs`でビルドし、実行経路だけ先に切り替える。

完了条件:

- 開発時にRenderer HMRが動く。
- production buildとpackaged executableが起動する。

## Phase 2: Shared契約とtyped IPC

- Entity型、Workspace型、IPC channel定数を`src/shared/`へ移す。
- `window.api`のrequest/response型を定義する。
- PreloadをTypeScript化する。
- IPC登録を`src/main/ipc/registerIpc.ts`へ分離する。
- Rendererの`workspaceApi`をtyped `window.api` adapterへ変更する。

完了条件:

- IPC channel文字列の重複がない。
- RendererからElectron/Node.jsをimportしていない。
- typecheckでIPC引数と戻り値の不一致を検出できる。

## Phase 3: RepositoryとService分割

- `WorkspaceDatabase`をmigration、Entity、Preference、Snapshot適用へ分割する。
- DB接続とtransaction管理を`src/main/db/`へ置く。
- Snapshot ZIP、clipboard、external URL、reloadをServiceとして整理する。
- handlerは検証とService呼び出しだけにする。

完了条件:

- Repository単体のmodel smokeが通る。
- transaction、参照整合性、Undo、Snapshot往復結果が移行前と一致する。

## Phase 4: Renderer分割とZustand

- `App.jsx`を`App.tsx`、pages、features、componentsへ分割する。
- `workspaceStore`へload/save/remove/restoreと正式データを移す。
- `uiStore`へroute、drawer、toast、theme、selectionを移す。
- ページ固有のfilterやフォーム途中値はcomponent stateへ残す。
- 派生データをselectorと純粋関数へ移す。

完了条件:

- `App.tsx`はルート構成と共通providerだけを持つ。
- 画面間で共有する正式データの更新経路がStore actionに一本化される。
- 保存失敗時に入力と既存Store stateが残る。

## Phase 5: TailwindとUI部品

- Tailwind Vite pluginを導入する。
- `tokens.css`とTailwind theme variableの対応を一箇所に定義する。
- Button、Field、Panel、Badge、Drawer、Toastを共通component化する。
- レイアウトと状態classを段階移行する。
- ガント、チャート、複雑な擬似要素は既存CSSを維持する。
- Tabler Iconsを導入し、テキストと併用する。

完了条件:

- トークン外の色、余白、角丸、文字サイズが増えていない。
- ライト/ダーク、focus、hover、active、disabledが維持される。
- 主要画面の視覚差分を確認する。

## Phase 6: 配布標準

- electron-builderでNSISとportableを生成する。
- package metadata、icon、artifact名を整理する。
- packaged executableでDB保存と再起動復元を確認する。
- インストール版とportable版でuserDataの保存先を明示する。

完了条件:

- installerとportableが生成される。
- 両方で起動、保存、再読み込み、Snapshot export/importが通る。

## Phase 7: 更新機構

更新配布先、コード署名、release手順が確定した後に実施する。

- electron-updaterをMain Serviceとして追加する。
- typed IPCで更新状態をRendererへ通知する。
- Settingsに確認、download、再起動導線を追加する。
- 失敗時に現行版を継続利用できるようにする。

## 導入依存

中核:

```text
typescript
electron-vite
zustand
tailwindcss
@tailwindcss/vite
@tabler/icons-react
```

型・検証:

```text
@types/node
@types/react
@types/react-dom
```

実行時schema validatorは、既存domain validationをTypeScript化した後に不足が明確なら追加する。
最初から重複するschema定義を二系統作らない。

## 検証コマンドの最終形

```powershell
npm run typecheck
npm run build
npm run smoke:model
npm run smoke:desktop
npm run package
```

必要に応じてRenderer component testとRepository testを追加するが、package版の実動確認を
置き換えない。
