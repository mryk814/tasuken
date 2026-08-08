# Quality gates

Issue #337の初期実装では、PRとmain pushにWindowsの固定checkを実行する。
release.ymlのtag-based package workflowは独立して維持する。

## Stable checks

typecheck、unit-contract、behavior-data-safety、full-test、consistency-audit、build-windows、electron-smokeをrequired check候補とする。
各jobはnpm.cmd ci後、必要なNode ABI rebuildを行う。
Electron smokeだけはbuild後にElectron ABI rebuildを行い、生成済みbuildを起動する。

ローカルではnpm.cmd run ciがNode ABI rebuild → typecheck → unit/contract → behavior/data-safety → full-test → consistency/script inventory → build → Electron ABI rebuild → focused smokeの順で同じ経路を再現する。
full-testは全tests/*.test.mjsをnpm test経由で実行する。新しいtest fileはこのglobへ自動的に含まれるため、手動partitionから漏れない。

## Audits

audit:consistencyはJSON schema v1のerror / report-only findingを出力する。
false positiveの大きい既存境界は、ファイル・理由付きallowlistでreport-onlyにする。
audit:scriptsはpackage/workflow/manual reachability、目的、workspace schema version、stale候補を出力する。
監査ツールはaudit-tools.test.mjsでfixture violationをstrict errorへ昇格し、理由付きallowlistはreport-onlyのまま保つことを検証する。

Application Command外writeは現在report-onlyで、#336 merge後にaudit:consistency --strictへ切り替える。main/Today/Quick Capture/Inbox command parity、Today selector parity、expectedVersion・duplicate・out-of-order eventも#336 merge後に追加する。

## #333 behavior contract

note-draft-identity.test.mjsはNote A → Report B → Prompt Cの切替、scope/Theme/search fallback、Edit/Preview/Raw、detached window、canonical Markdownを、owner付きsnapshotとpersisted/canonical stateの遷移として検証する。
source guardは配線確認に限定し、状態混入の証明には使わない。
