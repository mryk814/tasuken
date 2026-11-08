# 失敗の記録

このリポジトリで試して失敗したことと、その直し方・再発防止。ほかのリポジトリでも起きる失敗（PC・シェル・道具の癖）は `~/.codex/FAILURES.md` に書く。

## 2026-11-08 新しい worktree の `npm ci` が ffmpeg-static のダウンロードで落ちた

- しようとしたこと: `git worktree add` で作った worktree で `npm ci --no-audit --no-fund` を流す。
- 起きたこと: `node_modules\ffmpeg-static` の `node install.js` が `Error: Request timed out after 30004ms` で落ち、`npm ci` が exit 1 で終わった。
- 原因: ffmpeg-static は install のたびに GitHub の release からバイナリを取る。この時はその取得がタイムアウトした（回線側の一時的なものか、続くものかは不明）。
- 直し方: `npm ci --ignore-scripts` の後、本体のチェックアウトの `node_modules/ffmpeg-static/ffmpeg.exe`（と `.LICENSE`・`.README`、同じ 5.2.0）を写した。install.js は既にファイルがあれば取得を飛ばすので、続けて `npm rebuild` と `npm run postinstall` を流した。`npm rebuild` は Electron の本体を入れなかったので、`node node_modules/electron/install.js` を流した（`%LOCALAPPDATA%\electron\Cache` から入る）。
- 再発防止: 記録だけ。同じ手順で数分で戻せるため、仕組みは足していない。

## 2026-11-08 `npm run ci` の全体実行で agent-interactive-launch の後片付けが EBUSY で落ちた

- しようとしたこと: ドロワー保存の修正（#703 手順0）の後、PowerShell から `npm run ci` を流す。
- 起きたこと: 2,222 件中 1 件だけ、`tests/agent-interactive-launch.test.mjs` の「Windows実プロセスへ日本語・引用符・改行を含むargvをそのまま渡す」が `EBUSY: resource busy or locked, rmdir 'C:\Users\ootan\AppData\Local\Temp\Tasken 日本語 & 空白-5Q1CDh'` で落ちた。同じファイルだけを流すと 6 件とも通った。
- 原因: 不明。テストはその場で csc.exe で作った exe を動かし、1.1 秒待ってから一時フォルダを消す。全体実行で重いときに、作ったばかりの exe をまだ誰か（Defender などの推測）が掴んでいたと見ている。
- 直し方: 単独で流し直して通ることを確かめた。修正の範囲外なのでテストは変えていない。
- 再発防止: 記録だけ。もう一度起きたら、後片付けの `rm` に `maxRetries`・`retryDelay` を付ける。

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
