# 失敗の記録

このリポジトリで試して失敗したことと、その直し方・再発防止。ほかのリポジトリでも起きる失敗（PC・シェル・道具の癖）は `~/.codex/FAILURES.md` に書く。

## 2026-11-07 better-sqlite3 に全体の型宣言を足したら、src/main/index.ts の型検査が落ちた

- しようとしたこと: headless の replica-check（`src/main/headless/replicaCheck.ts`）で better-sqlite3 を TypeScript から直に使うため、`src/main/types/better-sqlite3.d.ts` に `declare module "better-sqlite3"` を足した。
- 起きたこと: `npm run typecheck` が `src/main/index.ts(2711,5): error TS2322: Type 'WorkspaceDatabase' is not assignable to type 'DesktopPersistence'`（`listMobileDevices()` の戻りの型が合わない）で落ちた。宣言を外すと消えた。
- 原因: `tsconfig.node.json` は `allowJs` で、`workspaceRepository.mjs` の型を中身から推論する。better-sqlite3 に型が無いあいだは `prepare().all()` が `any` で、宣言を足すと `unknown[]` になり、推論された戻りの型が変わった。
- 直し方: 全体の宣言はやめ、replica-check の import の行だけ `@ts-expect-error` にして、使う範囲の型をその場で付けた（理由は import の横のコメント）。
- 再発防止: import の横のコメントに書いた。型検査がすぐ見つけるので仕組みは足していない。
