# 失敗の記録

このリポジトリで試して失敗したことと、その直し方・再発防止。ほかのリポジトリでも起きる失敗（PC・シェル・道具の癖）は `~/.codex/FAILURES.md` に書く。

## 2026-11-14 `npm run ci` の最後の smoke が「10 秒以内に閉じる」だけで 6 回中 5 回落ちた

- しようとしたこと: #755 の束 3・束 9a を main に入れる前に `npm run ci` を流す。PC はほかの作業で CPU 90% 前後。
- 起きたこと: `smoke:proposal-live:focused` が、確かめの中身を全部通った後の `closeElectron` で「Tasken did not close within ten seconds.」。束 9a は src に触れない（Android と試験だけ）のに同じ所で落ち、単独で流し直しても 3 回中 2 回落ちた。
- 原因: 終了の待ちに余裕が無かった。アプリは before-quit で画面の書き出しを最大 10 秒待ち、その後に Core・Android 連携の受け口・動いている自動バックアップを上限なしで止める。smoke は閉じるのを 10 秒しか待たないので、書き出しが少し延びるだけで、その後の片付けが入る余地が無かった。最近の main の変更に終了を遅くする物は見つからなかった（before-quit の本体は 11/7 から変わっていない）。
- 直し方: `live-proposal-electron-smoke.mjs` と `activity-electron-smoke.mjs` の終了の待ちを 30 秒にした。止まったままの終了は 30 秒で捕まえる。
- 再発防止: 待ちの横にコメントで理由を書いた。smoke の終了の待ちは、アプリ側の書き出しの上限（10 秒）より長くする。
- 追記（同じ日、段ごとの時間を測った）: 一時の worktree で before-quit・will-quit の各段に時刻を出し、今の main と #733 の前の版（ff3e3e73）で 5 回ずつ流した（CPU 50〜100%）。アプリの終了処理（書き出し・Core の stop・バックアップの中止・will-quit）は、app.quit() から quit イベントまで、今の main で 64〜96 ms、前の版で 45〜76 ms。#733 で増えたのは `stats.close()` の 30〜50 ms だけ。遅いのは quit イベントの後、Electron のプロセスが消えるまでの尾で、今の main で 0.6〜18.8 秒、前の版でも 1 回は 30 秒を越えて閉じなかった。終了の途中の保存はどの回も 0.1 秒以内に済んでいて、待ちを延ばしても遅い保存は隠していない。尾の中身（GPU・utility・renderer の後始末など）はまだ調べていない。30 秒でも越える回はありうるので、落ち続けるなら尾の中身を調べる。

## 2026-11-14 Android の未送信の列で、同じ時刻に積んだ子の命令が親を止め、送信が全部止まった

- しようとしたこと: #761 で、再送待ちの命令を飛ばして依存の無い命令を先へ送る。同じ Task への後の命令は、「同じ対象で先に作られた未完了の命令があれば待つ」として、作成順（createdAt、同じなら commandId）で比べた。
- 起きたこと: `MobileTaskEditChainTest` の 3 件と `MobileOutboxDatabaseTest` の 1 件で、何も送られなくなった（`expected:<3> but was:<1>` など）。
- 原因: 試験も実際の連続操作も、一度の時刻で複数の命令を積むので createdAt が同じになる。同じなら commandId（ランダムな UUID）で比べるため、子の命令が親より「先」に見え、親は子に、子は dependsOnCommandId で親に止められていた。
- 直し方: 先後は dependsOnCommandId の連なりの先頭どうしで比べるようにした（`MobileOutboxOrder.kt`）。
- 再発防止: 関数の横にコメントを書き、`MobileOutboxOrderTest` に「同じ時刻の子が親を止めない」試験を足した。命令の先後を比べる時は、createdAt を時刻の順として信じない。

## 2026-11-14 v0.1.89 の Windows release が、Release の時だけ流れる smoke の古い文で落ちた

- しようとしたこと: #736（ナビの言葉の日本語化）と #741 を入れた後、v0.1.89 のタグを push して Windows release を流す。
- 起きたこと: 段「Verify tag and create Windows artifacts」の `smoke:activity:packaged` が、帯の文「やったことを保存しました。DebriefのActivityで確認できます。」を 30 秒待って TimeoutError。Release は作られず、タグ v0.1.89 だけが残った。
- 原因: 画面の帯は「日誌のActivity…」に変わったが、`scripts/activity-electron-smoke.mjs` が古い文を完全一致で待っていた。この smoke は `release:check` でだけ流れ、`npm run ci` に入っていないので、CI では気づけなかった（#736 で台本の旧ラベルを直した時も、この文は画面の名前のラベルではなく帯の文なので拾えなかった）。
- 直し方: 帯の前半「やったことを保存しました。」で待つ形にした（確かめたいのは保存できたことで、後半は画面の名前を含み言葉をそろえるたびに変わる）。出したタグは動かさず、v0.1.90 で出し直す（docs/release.md の決まり）。
- 再発防止: `tests/smoke-release-text.test.mjs` を足した。Release の時だけ流れる smoke が完全一致で待つ文字列が、src か台本自身の架空のデータにあることを確かめる（直す前の台本では、この行を名指しして落ちる）。

## 2026-11-14 全体の試験でだけ、子プロセスを起こす試験が ETIMEDOUT で落ちた（#735）

- しようとしたこと: 全体の試験（2,326 件）を続けて3回通す。PC はほかのセッション（python・エミュレータ・試験）で CPU 70〜100%。
- 起きたこと: 1回目は `architecture-audit-profiles` が `spawnSync ... electron.exe ETIMEDOUT`、2回目は全部通ったが `ci-runner` の1件が 54 秒（単独では 0.9 秒）、3回目は `ci-runner` の3件が ETIMEDOUT。同じ日の上の記録の11件も同じ形。
- 原因: 試験は Electron を node として動かすので、試験の中で `process.execPath` で起こす子も electron.exe になる。Electron 45 の node 形は仮想アドレスを約 3.5 TB 予約する（素の node は約 5 GB）。PC が忙しいと、子はスクリプトを終えた後、プロセスが消えるまでに 5〜24 秒かかった（出力までは 0.1〜0.3 秒。`process.kill(SIGKILL)` でも同じなので OS 側の破棄を待っている）。同じ時に素の node は中央値 0.12 秒。落ちた時刻に CPU を使っていたのはほかのセッションで、試験の子はほとんど CPU を使わず待っていた。試験どうしが同じファイルや一時の場所を取り合った跡は無かった。
- 直し方: Electron の ABI（better-sqlite3）も Electron の API も要らない子は、素の node（`TASKEN_NODE_EXEC_PATH`）で起こす。調べた 23 ファイルは全部要らなかった。時間の上限は延ばしていない。
- 再発防止: `tests/helpers/childProcessNode.mjs` の `nodeExecPath` を使う。`tests/test-child-process-node.test.mjs` が、`// electron-abi: <理由>` の印の無い `process.execPath` を `ファイル:行` で名指しして落とす。
- 直した後の3回目で、`agent-session-hook-collector.test.mjs` の「an abandoned lock owner is recovered before the next hook event」が `OBSERVATION_LOCK_TIMEOUT`（10.2 秒）で落ちた。原因: 排他はフォルダー（中に owner.json）で、解放はフォルダーの名前を変えて行う。Windows では書いたばかりの owner.json を誰か（ウイルス対策など）が開いている間、名前の変更が EPERM で断られる（同じ形を一時の場所で再現すると、PC が重い時に 40 回中 11〜18 回）。解放はそこで諦めて例外を握りつぶすので、排他は生きている持ち主（同じプロセス）のまま残り、次の記録は PID でも期限（35 秒）でも回収できず、待ちの上限（10 秒）で落ちる。本番でも、同じプロセスで記録を続ける時に起きる形。直し方: 解放の名前の変更を、EPERM・EACCES・EBUSY の間は最大 3 秒まで短く待ってやり直す（`renameWhenUnlocked`）。再発防止: `fs.rename` を2回だけ EPERM にする試験を足した（直す前は同じ 10 秒の timeout で落ち、直した後は通る）。
- 別に一度だけ: 修正前の3回目で `finish-ia.test.mjs` のファイルのプロセスが、試験を一つも報告せずに 0.5 秒で exit 1 になった。出力は無く、単独では5回とも通った。原因は不明（Electron の子が始まる前に終わった形）。記録だけ。
- 追記（同じ日、#738 の `npm run ci`）: `mcp-runtime.test.mjs` の「配布版のbridgeは…」が、後片付けの `rmSync` で `ENOTEMPTY` になった（このとき同じ PC で Android の build とエミュレータを動かしていた）。MCP の子プロセスを閉じた直後に、子がまだ使っているフォルダーを消していた。子を閉じた直後に消している 5 か所の `rmSync` に `maxRetries: 10, retryDelay: 100` を付け、放されるまでやり直す形にした。

## 2026-11-14 題名を span で包んだら、Today の題名が 11px・補足の色になった（#738）

- しようとしたこと: 完了の線のために、Task の題名を `StruckTitle`（`span.pen-strike-host` > `span.pen-strike-text`）で包んだ。
- 起きたこと: Today の題名が、完了かどうかに関係なく 14px → 11px、文字色が補足の色になった。host に `overflow: hidden` も付き、線の抜きが切れた。試験・typecheck は通り、撮った絵でも見落とした（レビューで見つかった）。
- 原因: 既存の `.today-task-title span`（補足の行のための子孫セレクタ）が、題名の中に足した span にも当たり、詳細度で勝った。
- 直し方: `.today-task-title span:where(:not(.pen-strike-host, .pen-strike-text))` に絞った（`:where` で詳細度は元のまま）。
- 再発防止: セレクタの上のコメントに書いた。既存の要素の中に span や div を足したら、絵を見るだけでなく `getComputedStyle` で font-size と color を足す前の要素（親）と比べる。
- 同じレビューで: 一覧に残している行の丸を押すと完了を取り消せ、繰り返しの Task では次の回が残ったまま元が未完了に戻って二件になった。残している間は丸を押せなくし、`tests/pen-strike.test.mjs` で確かめる。

## 2026-11-14 `npm run ci` の最後の Electron smoke が `markdownImageRendered:false` で落ちた

- しようとしたこと: #733（入口ごとの計測）の merge 前に `npm run ci` を流す。同じ時に別のエージェントがコードを読んでいて、PC は重かった。
- 起きたこと: 試験は全部通った（2319 pass・0 fail）。最後の `smoke:desktop:focused` だけが `"markdownImageRendered":false` → `Electron smoke failed before restart check` で exit 1 になった。
- 原因: 推測。smoke はプレビューの画像の読み込みを最大2秒しか待たない（`src/main/index.ts` の `smokePreviewImage`）。重い時にはその間に読み終わらない。変更は添付の protocol と画面に触れていない。
- 直し方: 同じ build で `npm run smoke:desktop:focused` を流し直したら、2回とも通った（exit 0）。
- 再発防止: 記録だけ。一度の失敗なので、待ち時間は延ばしていない。また起きたら、2秒の待ちを読み込みの完了まで待つ形に変える。
- 追記（同じ日、#741 の後追いの `npm run ci`、CPU 100%）: また `markdownImageRendered:false` で落ちた。その前の版の準備の `npm run ci` では、付箋の窓の `sticky memo smoke load timeout`（`did-finish-load` を 10 秒待つ）で2回続けて落ちた。どちらも同じ build で smoke だけ流し直すと通った。固定の秒数の待ちが重さに弱い形なので、読み込みの完了を待つ形に変える直しを #748 に分けた（今回は延ばしていない）。
- 同じ日の次の `npm run ci`: 試験の段で `architecture-audit-profiles.test.mjs` と `ci-runner.test.mjs` の11件が `spawnSync ... electron.exe ETIMEDOUT` で落ち、後の段は走らなかった。ほかのセッションの作業で PC が重かった。2つのファイルだけ流し直すと 15/15 で通り、後の段（監査3つ・build・smoke 2つ）を `run-ci.mjs` と同じ順に手で流すと全部通った。記録だけ（試験の中の子プロセスの待ち時間は延ばしていない）。→ 原因が分かり、#735 で直した（上の記録）。

## 2026-11-12 ドロワーに制御した入力欄を足したら、フォームの最初の1文字が消えた

- しようとしたこと: #727 で Task のドロワーに「場所」の欄を足す。名前などを useState で制御した。
- 起きたこと: 実際の画面（Playwright）で、フォームの最初の入力だけが元の値に戻された（"abc" と打つと "bc"）。型検査・単体試験は通っていた。
- 原因: ドロワーはフォームの最初の入力で同期的に描き直す。制御した欄は、React の onChange が読む前に元の値へ戻される。他の欄は defaultValue（制御しない）なので起きない。
- 直し方: 入力欄は defaultValue のままにし、表示用の値だけ onInput で写す。「外す」は部品の key を変えて作り直す。
- 再発防止: PlaceReminderFields.tsx の冒頭のコメントに書いた。ドロワーに欄を足したら、実画面で最初の1文字を打って確かめる。

## 2026-11-12 MCP の説明文を伸ばして discovery budgets の試験が落ちた

- しようとしたこと: #727 で create_task・change_task の説明文に place_reminder の注意を足した。
- 起きたこと: tests/mcp-lightweight.test.mjs が「tasken.create_task: 210」（説明は 200 字以内）で落ちた。同時に新しい試験・部品が architecture の互換基準に無いと architecture-audit が落ちた。
- 直し方: 説明を縮め、基準の consumers に足した。注意の本文は入力欄の describe に置く。
- 再発防止: 記録だけ（試験が落ちた文で直せる）。説明文を足すときは、長い注意は欄の describe に置く。

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
- 追記（2026-11-14）: 10 秒でも落ちた。待ちの長さではなく、解放の名前の変更が一時的な EPERM で失敗して排他が残るのが原因だった（2026-11-14 の #735 の記録）。解放をやり直す形にした。

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
- 追記（2026-11-14）: #735 の確かめの `npm run ci`（CPU 97%）でまた同じ EBUSY が出た。試験が作った exe はこの一時フォルダーを作業場所にして 1 秒寝るので、重い時は固定の 1.1 秒では終わり切らない。後片付けの `rm` に `maxRetries: 10, retryDelay: 100` を付け、放されるまでやり直す形にした。
- 追記（同じ日、v0.1.89 の `npm run ci`、CPU 100%）: 同じ試験が今度は `ENOENT: received.txt` で落ちた。起動の台本は子が 0.5 秒生きていれば返る作り（対話の CLI は開いたまま）で、試験はその直後に子の書く結果を読んでいた。重い時は子がまだ書いていない。全部の行が書かれるまで（最大 15 秒）待ってから読む形にした。

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

## 2026-11-12 GitHub の Windows の CI で、パッケージ版の起動確認がアクセス違反で一度落ちた

- しようとしたこと: #728（Muse の道具と、NAS の作成で受ける欄）の PR の CI。
- 起きたこと: 試験は全部通り、最後の「Packaged Desktop Proposal verification」が `exit 3221225477`（0xC0000005、アクセス違反）で落ちた。落ちた所だけ流し直すと通った。
- 原因: 不明。変更は Python の道具と Core の作成の欄だけで、パッケージ版の起動には関わらない。Electron の起動時の不安定と見ている。
- 直し方: 流し直した。
- 再発防止: 記録だけ。もう一度起きたら、起動確認の側で落ちた時のログ（Electron の crash dump）を残すようにする。

## 2026-11-12 Android の試験で、権限の取り消しがプロセスごと落とし、実画面の撮影物が消えた

- しようとしたこと: #727 の場所のリマインダーの androidTest で、通知の権限が無い状態を `uiAutomation.revokeRuntimePermission(POST_NOTIFICATIONS)` で作る。画面の確認用の撮影物を `connectedDebugAndroidTest` の中で撮って取り出す。
- 起きたこと: 権限を取り消すとアプリのプロセスが終了し、`Instrumentation run failed due to Process crashed` で以降の試験が走らない。撮影物は、走り終わるとアプリごとアンインストールされ、`getExternalFilesDir` ごと消えて `adb pull` できない。位置の許可の画面が前に出ると、操作する試験が「No compose hierarchies found」で落ちる。
- 原因: Android は実行時の権限を取り消すとそのアプリのプロセスを殺す。Gradle の connected 系は終了時に両 APK を消す。
- 直し方: 権限が無い状態は関数の引数（`canPost`・`readinessOverride`）で作り、許可の画面が出ないよう操作する試験では先に許可しておく。撮影物は `assembleDebug*` の APK を `adb install` し、`am instrument -e class ...#screenshots` で走らせて取り出す。画面の形は `wm size` / `wm density` / `cmd uimode night` / `font_scale` をエミュレータ側で変えて撮る。
- 再発防止: 試験のコメントに書いた。`ANDROID_SERIAL=emulator-5554` を付けないと、無線 adb でつながった本人の実機にも connected 系が入るので、必ず付ける。

## 2026-11-12 Play Services を足したら、リリースのビルドだけが lint で落ちた（PR の CI の署名の確認で発覚）

- しようとしたこと: #727 で `play-services-location` を足し、`testDebugUnitTest`・`compileDebugAndroidTestKotlin`・`assembleDebug` を手元で通して PR（#730）を出した。
- 起きたこと: CI の `verify-release-signing` の「署名なしのリリースは止まる」確認が落ちた。`assembleRelease` は止まったが、理由が署名ではなく `lintVitalRelease` の `InvalidFragmentVersionForActivityResult`（`WidgetVoiceCaptureActivity.kt:29`、既存のコード）だった。
- 原因: Play Services が `androidx.fragment` 1.1.0 を連れてきて、`registerForActivityResult` が要求する 1.3.0 を下回った。リリースの lint は debug のビルドでは走らない。
- 直し方: `androidx.fragment:fragment` の新しい版を明示した。
- 再発防止: 依存を足したときは、手元でも `./gradlew assembleRelease` を流し、「Release signing is not configured」で止まる所まで進むことを確かめる（lint と R8 を通ったことになる）。CI の `verify-release-signing` が同じことを確かめている。
