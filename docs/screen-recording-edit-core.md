# Screen recording edit core

Issue #374 のうち、画面録画を開始する前の矩形座標と、録画後の非破壊trimを安全に接続するpure contractを定義する。
Electronのsource列挙・grant、MediaRecorder、compact dock、file生成、Artifact保存、Windows packaged実動はこの文書のcoreを利用する側であり、このphaseだけでは完成扱いにしない。

## 座標とdisplay binding

- 選択座標の正本はvirtual desktop上のDIPとする。逆方向のdragはleft/top/right/bottomへ正規化する。
- 矩形は64×64 DIP以上かつ、1つのdisplay bounds内に完全に収まる場合だけ受理する。displayを跨ぐ矩形や重複displayで所属先が曖昧な矩形はclampせず失敗する。
- display bindingはboundedな`displayId`、画面構成全体の`topologyRevision`、`boundsDip`、`scaleFactor`、実capture frameの`frameSizePx`、回転角を持つ。古いtopologyと、DIP×scaleFactorから説明できないframe sizeは受理しない。
- DIPからpixelへの変換はleft/topをfloor、right/bottomをceilする。選んだ内容を欠かさない外向き丸めであり、125%・150% scalingと負のmonitor座標を契約testで固定する。
- 回転displayの矩形変換は、実capture frameとの向きをpackaged版で証明できるまでfail closedとする。full display録画は矩形変換を通らない。
- `full_display`、`window`、`region`はdiscriminated unionとして別の意味を保つ。OSのraw source IDはこの契約へ含めない。
- #373のsource listを作るMain adapterは、list全体の`listSnapshotRevision`を作り、各one-shot `sourceToken`へ予測不能な`sourceRevision`を発行する。screenでは同時点の`topologyRevision`も束ねる。`createGrantedSourceRevisionBinding`は、この5項目を1つのexact current bindingとして固定し、windowにtopologyを付けることやscreenからtopologyを欠落させることを拒否する。
- `sourceRevision`はRendererが計算・指定するauthorityではない。Mainがlist snapshotと内部source identityから発行し、one-shot grantをarm/consumeする間だけ同じ`sourceToken`と組で保持する。#373統合adapterはlist更新、grant失効・再arm、display topology変更のいずれでも新しいrevisionを発行する。

## 開始前preflight

Rendererのstart requestは期待する`area`、`audioMode`、`includePointer`だけを持つ。areaはMainから受け取ったopaqueな`sourceToken` / `sourceRevision`と、screenの場合だけ`topologyRevision`、regionの場合だけDIP矩形をechoする。capability、pixel crop、display binding、除外proof、現在sourceはrequestへ入れず、余分なfieldを拒否する。

Mainはrequestとは別に、現在のone-shot source binding、再計算したcapture area、capability、除外proofをpreflight引数として渡す。token / source revision / topology revision / region DIPの全てが現在値と一致した場合だけstart planを作る。除外proof自身にもsource revisionとtopology revisionを持たせ、別の選択・画面構成で得た古いproofの再利用を拒否する。開始planは`off | microphone | system`とpointer有無を明示し、microphone / system audio / region crop / pointer captureの現在capabilityで利用できない組合せを拒否する。

範囲選択overlayは`hidden`、compact control dockはcaptureから`excluded`であることをMain側adapterが証明してからplanを作る。
proofがない場合は録画を始めない。pure coreはOS除外の事実を作らず、統合側が提示した事実を検証する。

## 非破壊trim

- trim planは元Video Artifactの`artifactId`、`artifactVersion`、`contentHash`、duration、dimensionsへ固定する。開始・終了はinteger millisecondで、`0 <= start < end <= duration`を満たす。
- resetは同じsource revisionの`0..duration`を返す。原本fileやArtifact metadataは変更しない。
- preview後に元Artifactのversion、hash、duration、dimensionsのいずれかが変わった場合はstale planとして失敗し、利用者に範囲確認を求める。
- exportのRenderer requestはoperation ID、出力先Artifact ID、trim planだけを持つ。`currentSource`はrequestに含められず、MainがRepositoryから再取得して`createMainOwnedCurrentVideoSource`でbrandした別引数だけを現在値として受ける。
- exportはtrimが適用されたplanだけを受け、別UUIDのmanaged Video Artifactと`derived_from`関係を作る計画を返す。元Artifact IDへの上書きと、trimなしの複製は拒否する。
- operation IDを計画へ含める。実file生成とApplication Command transactionは統合側で同じoperationを冪等に実行する。

## bounded metadataと安全な失敗

表示IDは128文字、display数は32、画面座標・dimensions・durationは実用上の上限とsafe integerへ制限する。Artifact versionは1〜1,000,000に制限する。
hashは`sha256:<64 lowercase hex>`、Artifact/operation IDはUUIDだけを受ける。path、media bytes、OS source ID、任意の追加fieldは受けない。

失敗は`ScreenRecordingEditError`のstable codeと、入力値を含まない利用者向けmessageで返す。座標・display ID・Artifact IDを例外文へ埋め込まない。

## Issue #374 受入基準との対応

| 受入基準 | このcoreの証拠 | 統合側に残る証拠 |
|---|---|---|
| 全画面/window/矩形を区別 | 3種のcapture area union | source chooserと実録画 |
| 64×64、bounds、multi-monitor、125%/150% | table-driven contract test | Windows実monitorでpackaged smoke |
| 選択枠/dockを映像へ混入させない | exclusion proofのないstartを拒否 | Electron window exclusionと録画映像確認 |
| Mic/System/Off、pointer | bounded start settings | device/OS permissionと実音声 |
| preview/seek、trim/reset | source-bound trim/reset plan | playerとcompact UI |
| 原本を変えず別Artifactへexport | source overwrite拒否とderived export plan | encoder/file/DB transaction/reopen |
| full/typecheck/build/audit/packaged | pure tests/typecheck/build/audit | packaged journey全体 |
