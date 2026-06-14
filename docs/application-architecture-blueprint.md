# Research Desk アプリケーション構造設計図

調査対象: 2026-06-14 構造移行完了後

## 実行経路

```text
React page / workspace feature
  -> Zustand action
  -> renderer workspaceApi
  -> window.api
  -> typed Preload
  -> validated IPC handler
  -> WorkspaceService / WorkspaceDatabase
  -> SQLite / Snapshot ZIP / Clipboard / OS
```

HTTPサーバーやREST APIはない。Main Processがローカルバックエンドであり、
RendererからNode.js、Electron、SQLiteへ直接アクセスしない。

## ディレクトリ

```text
src/
├── main/
│   ├── index.ts
│   ├── ipc/registerIpc.ts
│   ├── repositories/
│   │   ├── workspaceRepository.mjs
│   │   └── domain.mjs
│   └── services/
│       ├── workspaceService.ts
│       └── snapshotService.mjs
├── preload/index.ts
├── renderer/
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       ├── features/workspace/
│       ├── pages/
│       ├── stores/
│       ├── services/
│       ├── data/
│       ├── utils/
│       └── styles/
└── shared/
    ├── ipc/
    └── types/
```

## 責任分割

| 層 | 正本 | 責任 |
|---|---|---|
| Shared | `src/shared/ipc/contracts.ts` | IPC channel、Preload API、request/response型 |
| Main entry | `src/main/index.ts` | app lifecycle、BrowserWindow、desktop smoke |
| IPC | `src/main/ipc/registerIpc.ts` | 入力検証、Service/Repository呼び出し |
| Repository | `src/main/repositories/workspaceRepository.mjs` | SQLite、transaction、CRUD、論理削除、Undo、Plan Revision |
| Service | `src/main/services/workspaceService.ts` | Snapshot dialog、clipboard、reload |
| Preload | `src/preload/index.ts` | 許可済みAPIだけを`window.api`へ公開 |
| Workspace Store | `src/renderer/src/stores/workspaceStore.ts` | 正式データ、load/save/remove/restore |
| UI Store | `src/renderer/src/stores/uiStore.ts` | route、theme、toast、選択Theme |
| Renderer adapter | `src/renderer/src/services/workspaceApi.ts` | `window.api`の薄い業務語彙adapter |
| Workspace feature | `src/renderer/src/features/workspace/WorkspaceApp.jsx` | 現行画面とフォームの互換実装 |
| Root | `src/renderer/src/App.tsx` | アプリルートだけ |

## データ互換

- DB: `<Electron userData>/research-desk.sqlite`
- schema version: 1を維持
- Snapshot: 既存ZIP manifest、checksum、論理削除、Plan Revisionを維持
- 初回bootstrap: DBが空の場合だけ既存初期Workspaceを登録
- Entity保存: Repository transaction内で正規化、参照検証、履歴記録
- 削除: 論理削除と参照退避
- Undo: 親子、Theme、Dependency等の退避参照を復元

## Buildと配布

```powershell
npm run dev
npm run typecheck
npm run build
npm run smoke:model
npm run smoke:desktop
npm run package
```

electron-viteは次を生成する。

```text
out/main/index.js
out/preload/index.mjs
out/renderer/index.html
```

electron-builderはNSIS installerとportable executableを`release/`へ生成する。

## 変更時の順番

新しい保存機能は次の順で接続する。

1. `src/shared`へEntityとIPC契約を追加する。
2. RepositoryへDB操作を追加する。
3. 複数境界をまたぐ場合はServiceへユースケースを追加する。
4. `registerIpc.ts`で入力検証して公開する。
5. Preloadの`window.api`へ業務語彙のメソッドを追加する。
6. Renderer adapterとZustand actionを追加する。
7. page / feature / componentからStore actionを呼ぶ。
8. typecheck、model smoke、desktop smoke、packageを通す。

## 保守上の注意

- `window.researchDesk`は旧smokeや移行時互換のaliasであり、新規コードは`window.api`を使う。
- RepositoryとSnapshot内部の`.mjs`は互換性を守るため移設を優先した。変更時に小単位で
  TypeScript化し、DB/Snapshot fixture比較を必ず行う。
- workspace featureのJSXは画面挙動を一括変更しないため残している。新規画面を同ファイルへ
  足さず、`pages/`と`features/`へTypeScriptで追加する。
- Tailwindの既定色を直接使わず、`design-standard/tokens.css`を正本にする。
