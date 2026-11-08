# 失敗の記録

このリポジトリで試して失敗したことと、その直し方・再発防止。ほかのリポジトリでも起きる失敗（PC・シェル・道具の癖）は `~/.codex/FAILURES.md` に書く。

## 2026-11-08 worktree の `npm ci` が ffmpeg-static の取得で落ちた

- しようとしたこと: 新しい worktree（`.claude/worktrees/replica-freshness`）で `npm ci` を流す。
- 起きたこと: `ffmpeg-static` の install が `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz` の取得で `statusCode: 504` になり、`npm ci` 全体が exit 1 で止まった。
- 原因: GitHub の releases 側の一時的な 504。同じコマンドをもう一度流すと通った。
- 直し方: `npm ci` を流し直した。
- 再発防止: 記録だけ。一時的な障害で、こちらで防げる仕組みが無いため。続くようなら、本体の checkout の `node_modules/ffmpeg-static/ffmpeg.exe` を写す手を考える。

## 2026-11-07 better-sqlite3 に全体の型宣言を足したら、src/main/index.ts の型検査が落ちた

- しようとしたこと: headless の replica-check（`src/main/headless/replicaCheck.ts`）で better-sqlite3 を TypeScript から直に使うため、`src/main/types/better-sqlite3.d.ts` に `declare module "better-sqlite3"` を足した。
- 起きたこと: `npm run typecheck` が `src/main/index.ts(2711,5): error TS2322: Type 'WorkspaceDatabase' is not assignable to type 'DesktopPersistence'`（`listMobileDevices()` の戻りの型が合わない）で落ちた。宣言を外すと消えた。
- 原因: `tsconfig.node.json` は `allowJs` で、`workspaceRepository.mjs` の型を中身から推論する。better-sqlite3 に型が無いあいだは `prepare().all()` が `any` で、宣言を足すと `unknown[]` になり、推論された戻りの型が変わった。
- 直し方: 全体の宣言はやめ、replica-check の import の行だけ `@ts-expect-error` にして、使う範囲の型をその場で付けた（理由は import の横のコメント）。
- 再発防止: import の横のコメントに書いた。型検査がすぐ見つけるので仕組みは足していない。

## 2026-11-07 性能の計測で、TASKEN_PERF_DIAGNOSTICS が全体読み込みの数字を膨らませた

- しようとしたこと: 実データの写しで Desktop を起動し、`TASKEN_PERF_DIAGNOSTICS=1` の main.log から Main の停止と workspace:load の時間を拾う。
- 起きたこと: 全体再読込が約1.9〜2.5秒と出た。CPU profile を見ると、そのうち約0.35秒は診断自身が workspace:load の結果（約147MB）を毎回 JSON.stringify して大きさを数える処理（measureMainPerformance）だった。
- 原因: 診断が測る対象の結果を丸ごと文字列にする。結果が大きいほど、診断がその分だけ遅くする。
- 直し方: `scripts/perf-desktop-bench.mjs` は診断を使わず、起動直後に Main へ 50ms 間隔のタイマーを入れて停止を集める形にした。
- 再発防止: 計測スクリプトの冒頭のコメントに理由を書いた。

## 2026-11-07 Git Bash から `npm run ci` を流すと、CI ランナーのテストが2件落ちた

- しようとしたこと: Claude Code の Bash ツール（Git Bash）から `npm run ci` を流す。
- 起きたこと: `tests/ci-runner.test.mjs` の「CI runs the full suite once ... (win32/PATH npm)」と「CI propagates each gate failure ... (win32/PATH npm)」が、`command: 'C:\WINDOWS\system32\cmd.exe'` と `'fixture-cmd.exe'` の違いで落ちた。PowerShell から流すと通った。
- 原因: Git Bash の環境では `COMSPEC`（大文字）で渡る。テストは `{ ...process.env, ComSpec: "fixture-cmd.exe" }` で差し替えるが、Windows の子プロセスでは大文字小文字違いの同名が並び、元の `COMSPEC` が勝つ。
- 直し方: 手元の品質ゲートは PowerShell から流した（2,213件中 fail 0）。
- 再発防止: 記録だけ。テストを直すなら、差し替える前に `COMSPEC` と `ComSpec` の両方を env から消す。
