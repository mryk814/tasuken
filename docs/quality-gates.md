# Quality gates

Issue #337の初期実装では、PRとmain pushにWindowsの固定checkを実行する。
release.ymlのtag-based package workflowは独立して維持する。

## Stable checks

typecheck、unit-contract、behavior-data-safety、full-test、consistency-audit、build-windows、electron-smokeをrequired check候補とする。
各jobはnpm.cmd ci後、必要なNode ABI rebuildを行う。
Electron smokeだけはbuild後にElectron ABI rebuildを行い、生成済みbuildを起動する。

ローカルではnpm.cmd run ciがNode ABI rebuild → typecheck → unit/contract → behavior/data-safety → full-test → strict consistency/script inventory → build → Electron ABI rebuild → focused smokeの順で同じ経路を再現する。
full-testは全tests/*.test.mjsをnpm test経由で実行する。新しいtest fileはこのglobへ自動的に含まれるため、手動partitionから漏れない。

## Audits

audit:consistencyはJSON schema v1のerror / report-only findingを出力する。merge gateは`--strict --format=json`で実行し、production treeのsummaryは`total=0 / errors=0 / reportOnly=0`でなければならない。production allowlistは空である。
監査は構造を検出する。Application Command外writeはTaskのgeneric persistence bypassだけを対象にし、Command Service・Repository transaction・非Task保存は正当な境界として扱う。IPCはshared contract外のliteral sender/handler、Themeはcanonical direct persistenceへのlegacy `theme_id`混入、CSSは未宣言global tokenだけを検出する。TS/TSXのquoted style key・`setProperty`とCSS template内のscoped declarationはtoken契約として収集し、runtime slotの既定値をglobal CSSへ追加しない。
audit:scriptsはpackage/workflow/manual reachability、目的、workspace schema version、stale候補を出力する。
監査ツールはaudit-tools.test.mjsでfixture violationをstrict errorへ昇格し、runtime/style-templateのtoken解決と真に未定義のtokenを区別する。production strict audit自体もunit-contractから実行し、検出器が実treeを見逃していないことを確認する。

Application Command parityは#336の正本を使う。Main/Today/Quick Capture/InboxのTask作成・更新・完了・削除・Capture変換はnamed commandを通り、generic Task IPC persistenceは拒否する。behavior gateではToday selector、expectedVersion、duplicate command replay、out-of-order/stale event、Inbox atomic conversionを確認する。

Electron smokeはrun IDを生成し、`--user-data-dir`と`--smoke-result-path`を明示的に別TEMPへ渡す。main側で固定TEMPを削除しないため、並列実行時のDB/result競合を起こさない。`180000ms` timeoutとpreviousStage/trace diagnostics、visible lazy Mermaid pathは維持する。

## #333 behavior contract

note-draft-identity.test.mjsはNote A → Report B → Prompt Cの切替、scope/Theme/search fallback、Edit/Preview/Raw、detached window、canonical Markdownを、owner付きsnapshotとpersisted/canonical stateの遷移として検証する。
source guardは配線確認に限定し、状態混入の証明には使わない。
