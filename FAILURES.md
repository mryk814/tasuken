# 失敗の記録

このリポジトリで試して失敗したことと、その直し方・再発防止。ほかのリポジトリでも起きる失敗（PC・シェル・道具の癖）は `~/.codex/FAILURES.md` に書く。

## 2026-11-11 新しい試験が WorkspaceDatabase を直に使い、アーキテクチャ監査の試験が「24 !== 23」で落ちた

- しようとしたこと: #688 で `tests/core-capability-parity.test.mjs`（Desktop と NAS の Core を本物の DB で組み立てて capability を比べる）を足し、`npm run ci` を流す。
- 起きたこと: `tests/architecture-audit.test.mjs` の 3 件が `24 !== 23`・`1 !== 0` で落ちた。何が増えたかは assert の文に出ず、`artifacts/architecture/report.md` を読んで、新しい試験が互換の面 `workspace-repository` の利用者として基準に無い（`compatibility.consumer_added`）と分かった。#703（同日）でも新しい試験で同じことが起き、同じ読み方をした。
- 原因: 互換の面を直に使う新しいファイルは `architecture/compatibility-baseline.json` の consumers に載せる決まりで、試験の数え方は件数だけだった。
- 直し方: consumers に足した。
- 再発防止: 監査の試験の件数の assert に、基準に無く抑止も無い指摘を名指しし、直し方（consumers に足す／suppressions に issue 付きで足す）を添える文を付けた（`unexplainedFindings`）。次からは落ちた文だけで直せる。

## 2026-11-11 get_note の応答に欄を足したら、旧来の読み取りとの一致の試験が GitHub で落ちた

- しようとしたこと: #714 で `get_note` の応答に本文の署名（`body_signature`）を足し、関係しそうな試験だけを手元で流して push した。
- 起きたこと: windows-quality で `tests/tasken-core-mcp-wave5-content.test.mjs` と `tests/tasken-core-mcp-wave5-integration.test.mjs` が落ちた（Core の get_note と、旧来の読み取りの投影 `tests/fixtures/legacyReadOnlyContext.mjs` が deepEqual で一致しない）。
- 原因: 手元で流す試験を、変えたサービスの名前で選び、読み取りの契約の名前（`getNote`・`toolGetNote`）で選ばなかった。
- 直し方: 旧来に無い欄として比べる対象から外し、全文のときだけ値を持つことを別に確かめた。
- 再発防止: 記録だけ。共有の読み取り・書き込みの応答の形を変えたら、`rg -l "<関数名>|<tool名>" tests` で拾った試験を全部流す。

## 2026-11-11 `npm run ci` の全体実行で agent-session-hook-collector の並行書き込みが timeout した

- しようとしたこと: #703 の PR（#712）の前に、Git Bash から `npm run ci` を流す。
- 起きたこと: 2,272 件中、`tests/agent-session-hook-collector.test.mjs` の「concurrent hook processes merge by observation time without corrupting state」が `OBSERVATION_LOCK_TIMEOUT`（session observationの排他待ちがtimeoutしました）で落ちた。同じファイルだけを流すと通った。
- 原因: 不明。PR は hook collector に触れていない。全体実行で重いときに、並行の子プロセスが排他を待ちきれなかったと見ている（EBUSY の件と同じく負荷の推測）。
- 直し方: 単独で流し直して通ることを確かめた。
- 再発防止: 記録だけ。もう一度起きたら、試験の排他待ちの上限を見直す。
- 追記（2026-11-12）: #724 の GitHub の Windows の CI で、同じファイルの「Stop racing SessionEnd keeps the latest outcome in the terminal observation」が同じ `OBSERVATION_LOCK_TIMEOUT` で落ちた（3.2 秒）。待ちの上限は 10ms×200 回（約 2 秒）で、重いと待ちきれない。本番でも Hook が重なると出来事の記録を落とす形なので、試験ではなく本体の上限を時間で決めて 10 秒にした（`agentSessionHookCollector.mjs` の `LOCK_WAIT_MS`）。

## 2026-11-08 手順書のツール名を確かめる試験が、何も確かめずに通っていた

- しようとしたこと: `tests/muse-connector.test.mjs` で、`clients/muse/CONNECTOR.md` の「Which tool for which moment」の表に出てくるツール名が実在することを確かめる。
- 起きたこと: 表の切り出しを `doc.slice(doc.indexOf("### Which tool…"), doc.indexOf("```text"))` で取っていた。最初の「```text」が表より前（Connect の節）にあるため範囲が空になり、ループが一度も回らないまま通っていた。表に実在しない名前を書いても落ちなかった。構成の監査で同じ試験を直していたときに、読んで気づいた。
- 原因: 終わりの印を、始まりより後から探していなかった。範囲が空でも assert が一つも走らず、試験は成功になる。
- 直し方: 終わりの印を見出しより後から探し、見つかった名前が 10 件以上あることも assert する。
- 再発防止: 試験の中のコメントに理由を書いた。文書や出力から項目を拾って確かめる試験は、拾えた件数の下限も確かめる（空のループで通らないように）。

## 2026-11-08 GitHub の windows-quality で、replica が作った Note が Desktop に届いていない試験が落ちた

- しようとしたこと: PR #708 の CI。`tests/ai-item-creation.test.mjs` の「creation-only replica joins while empty and publishes personal Task/Note to Desktop」。
- 起きたこと: `host.get("note", …)` が null で `Cannot read properties of null (reading body_markdown)`。Task は届いていた。手元では何度も通っていた。
- 原因: `SharedFolderSyncService#syncNow` は、同期が走っている最中に呼ばれると、その回を待つだけだった。定期の同期が Note の保存より前に始まっていると、`syncNow()` が返っても Note は公開されていない。#704 で同期の一回に status.json の読み書きが増え、隙間が広がった見込み。
- 直し方: 走っている最中に呼ばれたら、終わった後にもう一回だけ回す（重ねて呼ばれても一つにまとめる）。
- 再発防止: `tests/shared-folder-sync.test.mjs` に、取り込みの段で止めた回の途中で保存し `syncNow()` を呼ぶ試験を足した（直す前は必ず落ちる）。

## 2026-11-08 worktree の `npm ci` が ffmpeg-static の取得で落ちた

- しようとしたこと: 新しい worktree（`.claude/worktrees/replica-freshness`）で `npm ci` を流す。
- 起きたこと: `ffmpeg-static` の install が `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz` の取得で `statusCode: 504` になり、`npm ci` 全体が exit 1 で止まった。
- 原因: GitHub の releases 側の一時的な 504。同じコマンドをもう一度流すと通った。
- 直し方: `npm ci` を流し直した。
- 再発防止: 記録だけ。一時的な障害で、こちらで防げる仕組みが無いため。続くようなら、本体の checkout の `node_modules/ffmpeg-static/ffmpeg.exe` を写す手を考える。
- 同じ日にもう一度（`.claude/worktrees/drawer-save-external-change`）: 今度は `Error: Request timed out after 30004ms`。流し直す代わりに、写す手で戻した。手順は、`npm ci --ignore-scripts` → 本体の checkout の `node_modules/ffmpeg-static/` から `ffmpeg.exe`・`ffmpeg.exe.LICENSE`・`ffmpeg.exe.README` を写す（版が同じ 5.2.0 であることを確かめる。install.js はファイルがあれば取得を飛ばす）→ `npm rebuild` → `npm run postinstall` → `node node_modules/electron/install.js`（`npm rebuild` は Electron の本体を入れなかった。`%LOCALAPPDATA%\electron\Cache` から入る）。

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
- 追記（2026-11-09）: v0.1.85 のリリース作業で同じ2件にまた当たったため、テストを直した。子の env を作る前に、大文字小文字を問わず `comspec` のキーを全部除いてから `ComSpec` を入れる。Git Bash から流しても通る。

## 2026-11-12 足した androidTest を「CI で走る」と思い込み、2 件が準備の段階で落ちるまま PR を出した

- しようとしたこと: #688 で Android の接続先の乗り換えの守りを足し、androidTest（`MobileOutboxDatabaseTest`・`MobileNodeSwitchPairingTest`）を書いた。実装役は手元でコンパイルだけを確かめ、実行は CI の android-quality に任せるとして PR #722 を出した。CI は緑だった。
- 起きたこと: 試験用のエミュレータ（Pixel_8）で `connectedDebugAndroidTest` を走らせると、足した 2 件が `UNIQUE constraint failed: outbox_command.commandId` で落ちた。
- 原因: android-quality は `compileDebugAndroidTestKotlin` で androidTest をコンパイルするだけで、実行していない。試験の側は、`insertOutbox`（上書きしない insert）で既存の行を書き換えようとしていた。
- 直し方: 試験で、消してから入れ直す `replaceOutbox` を使うようにした。エミュレータで 62 件通った。
- 再発防止: android-quality.yml の Gradle の呼び出しの横に、androidTest は走らせないことと手元で走らせる手順を書いた。CI でエミュレータを動かすのは時間がかかるので、まだ入れていない。

## 2026-11-12 NASのMobile Gatewayの写真の試験が、全体実行の一回目だけ validation_failed で落ちた

- しようとしたこと: #688 段階3で `tests/headless-mobile-gateway.test.mjs` を足し、`npm run ci` を流す。
- 起きたこと: 一回目の全体実行で「写真つきのCapture」の CreateCapture が 400 validation_failed（2,314件中1件）。単独で4回、他の重い試験と並べて1回流すと通り、二回目の全体実行も全件通った。
- 原因: 試験の書き方。CreateCapture は `capture.capturedAt` と `issuedAt` が同じ時刻でなければ 400 になる（schema.ts）が、試験は `capturedAt` を `new Date()` で、`command()` が `issuedAt` を別の `new Date()` で作っていた。1ms ずれると 400 validation_failed。写真の保存やI/Oの失敗ではなかった。「壊れた写真」の確認も、1件目の `capturedAt` を使い回して、寸法の検査ではなく時刻の不一致で 400 になっていた。
- 直し方: `command()` が `issuedAt` を受け取れるようにし、Capture の試験は同じ時刻を渡す。壊れた写真も同じ時刻にそろえ、寸法の検査で断られファイルが残らないことを確かめる。
- 再発防止: `command()` の上のコメントに制約を書いた。「不明」「負荷の推測」で済ませず、validation_failed は本文のどの検査かを先に疑う。
- 同じ作業で、新しい試験が WorkspaceDatabase を使い architecture-audit が落ちた（`compatibility.consumer_added`。baseline の consumers に足して直した）。また `prettier --write` を ディレクトリに掛けると CRLF の作業ツリーで無関係なファイルが変わるので、ファイルを名指しして掛ける。

## 2026-11-12 Android の試験で、権限の取り消しがプロセスごと落とし、実画面の撮影物が消えた

- しようとしたこと: #727 の場所のリマインダーの androidTest で、通知の権限が無い状態を `uiAutomation.revokeRuntimePermission(POST_NOTIFICATIONS)` で作る。画面の確認用の撮影物を `connectedDebugAndroidTest` の中で撮って取り出す。
- 起きたこと: 権限を取り消すとアプリのプロセスが終了し、`Instrumentation run failed due to Process crashed` で以降の試験が走らない。撮影物は、走り終わるとアプリごとアンインストールされ、`getExternalFilesDir` ごと消えて `adb pull` できない。位置の許可の画面が前に出ると、操作する試験が「No compose hierarchies found」で落ちる。
- 原因: Android は実行時の権限を取り消すとそのアプリのプロセスを殺す。Gradle の connected 系は終了時に両 APK を消す。
- 直し方: 権限が無い状態は関数の引数（`canPost`・`readinessOverride`）で作り、許可の画面が出ないよう操作する試験では先に許可しておく。撮影物は `assembleDebug*` の APK を `adb install` し、`am instrument -e class ...#screenshots` で走らせて取り出す。画面の形は `wm size` / `wm density` / `cmd uimode night` / `font_scale` をエミュレータ側で変えて撮る。
- 再発防止: 試験のコメントに書いた。`ANDROID_SERIAL=emulator-5554` を付けないと、無線 adb でつながった本人の実機にも connected 系が入るので、必ず付ける。
