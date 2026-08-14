# Quality gates

コードと自動検証の正本はWSLに置き、対話的UIはWSLg、Windows固有操作はcommit済みSHAの専用Windows runtime cloneで確認する。
Windows配布物の作成とpackaged smokeはGitHub Actionsへ分担する。
WSLでは `npm run ci` を通し、タグをpushしたときは `Windows release` workflowの成功を配布条件とする。
環境の役割と起動方法は [`development-environment.md`](./development-environment.md) を正本とする。

## 正本は npm run ci

`scripts/run-ci.mjs` が唯一のゲート定義で、次の順に実行する。

```text
Electron ABI rebuild
  → typecheck
  → unit/contract
  → behavior/data-safety
  → full-test
  → strict consistency audit / script inventory audit
  → build
  → focused Electron smoke
```

途中で失敗したらそこで止まる。分割実行したいときは同じ順で個別のnpm scriptを叩く。

testは`ELECTRON_RUN_AS_NODE=1 electron --test`で実行する。better-sqlite3のようなnative moduleは1つの`.node`に1つのABIしか持てず、素のNodeとElectronでは`NODE_MODULE_VERSION`が異なるため、両方から実行するとrebuildの往復が必要になる。実行環境をElectron側へ一本化してこれを解消している。Node ABI向けのrebuild scriptは持たない。

full-testは全tests/*.test.mjsをnpm test経由で実行する。globはNodeのtest runnerが解決するため、新しいtest fileは自動的に含まれ、手動partitionから漏れない。

## リリース

`npm run release:check`はWindows x64 host専用で、version検証 → `npm run ci` → Windows ABI rebuildを含むpackage → 配布物検証 → packaged Electron smoke → packaged MCP smokeを通す。
GitHub ActionsのWindows runnerがこのコマンドを実行し、`release/`にNSIS installerとportableを作る。workflowは配布物とSHA-256 checksumをGitHub Releaseへ登録する。

## Audits

audit:consistencyはJSON schema v1のerror / report-only findingを出力する。merge gateは`--strict --format=json`で実行し、production treeのsummaryは`total=0 / errors=0 / reportOnly=0`でなければならない。production allowlistは空である。
監査は構造を検出する。Application Command外writeはTaskのgeneric persistence bypassだけを対象にし、Command Service・Repository transaction・非Task保存は正当な境界として扱う。IPCはshared contract外のliteral sender/handler、Themeはcanonical direct persistenceへのlegacy `theme_id`混入、CSSは未宣言global tokenだけを検出する。TS/TSXのquoted style key・`setProperty`とCSS template内のscoped declarationはtoken契約として収集し、runtime slotの既定値をglobal CSSへ追加しない。
audit:scriptsはpackage/workflow/manual reachability、目的、workspace schema version、stale候補を出力する。Windows workflowでrelease scriptの到達性も追跡する。
監査ツールはaudit-tools.test.mjsでfixture violationをstrict errorへ昇格し、runtime/style-templateのtoken解決と真に未定義のtokenを区別する。production strict audit自体もunit-contractから実行し、検出器が実treeを見逃していないことを確認する。

Application Command parityは#336の正本を使う。Main/Today/Quick Capture/InboxのTask作成・更新・完了・削除・Capture変換はnamed commandを通り、generic Task IPC persistenceは拒否する。behavior gateではToday selector、expectedVersion、duplicate command replay、out-of-order/stale event、Inbox atomic conversionを確認する。

Electron smokeはrun IDを生成し、`--user-data-dir`と`--smoke-result-path`を明示的に別TEMPへ渡す。main側で固定TEMPを削除しないため、並列実行時のDB/result競合を起こさない。`180000ms` timeoutとpreviousStage/trace diagnostics、visible lazy Mermaid pathは維持する。
Windowsのnative clipboardはOS全体で共有されるため、smoke全体は直列化せず、本文copy通知・text write・画像write→paste→read-backを連続した最小clipboard phaseへ集約し、そこだけPID・開始時刻付きatomic lockで保護する。期限切れの死プロセスlockは回収し、待機timeoutでは失敗してrunRoot diagnosticsを残す。lockの直列化・回収はelectron-smoke-runner.test.mjsで実動検証する。

## #333 behavior contract

note-draft-identity.test.mjsはNote A → Report B → Prompt Cの切替、scope/Theme/search fallback、Edit/Preview/Raw、detached window、canonical Markdownを、owner付きsnapshotとpersisted/canonical stateの遷移として検証する。
source guardは配線確認に限定し、状態混入の証明には使わない。
