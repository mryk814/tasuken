# Media Capture

Issue #367 では、既存音声を Inbox の Voice Capture と managed Artifact へ取り込む。
Issue #371 では、Inboxからmicrophoneを明示録音し、bounded chunkをMain-owned sessionへ順次保存して同じVoice Capture確定経路へ接続する。
Issue #368 の Video Phase 0 では、既存動画を managed / linked Video Artifact として Task / Note / Capture / 実行中Focusから取り込む。
画面録画・rectangle選択・trim/chapter/clip export・文字起こし・AI要約・codec変換はこの段階に含めない。

## 正本と確定順序

音声の所有関係は Artifact の `source_type=capture_entry` と `source_id` が正本である。
動画も各importが1つのprimary ownerを持ち、Taskは`task`、Noteと実行中Focusは`note`、Captureは`capture_entry`を保存する。Focusは`document_role=focus_session`かつ`session_state=active`のNote IDを渡す。
owner関係はContext Graphへ`derived_from`として投影し、同じ関係をReferenceへ重複保存しない。
確定順序は `temporary原音 → durable session manifest → managed原音 → CommitAudioCapture transaction → renderer通知` とする。
動画のmanaged確定順序も `temporary動画 → durable session manifest → managed動画 → CommitVideoArtifact transaction → renderer通知` とし、linkedは選択時のstaged previewを正本にせず、commit・recovery・再生のたびに元fileのidentityとbytesを再検証する。
DB失敗時は原音とmanifestを保持し、次回起動で同じcommand receiptを再実行する。
prepare後・commit前に終了したsessionは自動確定せず、Inboxの「保存待ち音声」でpreview・保存・破棄を選べる。
microphone録音は`recording / recording_paused`を同じmanifestへ保存し、stop時にchunkを検証・結合して`prepared`へ移す。app終了・device切断・Renderer障害で未停止のsessionは自動commitせず、「保存待ち音声」から復旧または破棄する。
動画も選択直後には確定せず、各owner詳細の「保存待ち動画」でmetadataを確認してから「添付する」または「破棄」を選ぶ。

## Renderer境界

Rendererへ渡す識別子はsession IDまたはArtifact IDだけとする。
OS path、media bytes、linked identity、receipt内のmanaged pathはworkspace load、entity list/get、Snapshot preview/apply、command response、変更通知へ含めない。
再生は `tasken-media://session/{id}` または `tasken-media://artifact/{id}` を使い、Mainが現在の正本を再解決する。
Mainはfile descriptorを一度だけopenし、同じdescriptorでidentity・size・SHA-256を検証してRange streamへ渡す。同じinode・size・mtime・ctime・content hashのRange再要求は検証cacheを使い、file versionが変わった場合だけ再hashする。

availability は `available | missing | changed | unsafe_source | unsupported_codec` のいずれかである。
symlink/junction、hash不一致、検証後のpath差替えでは未検証bytesを配信しない。

録音中のRendererはMediaRecorderの各BlobをMainが返す`maxChunkBytes`以下へ分割し、sequence付きArrayBufferとして逐次IPC送信する。未送信Blobは8 chunk相当のbyte上限を超えてqueueせず、録音済み部分のstop・復旧へ移る。開始処理はpromise gateで一度だけ実行し、Main session作成後にMediaRecorderの生成・開始が失敗した場合はそのsessionを破棄する。Mainは1 chunk 1 MiB、1 session 512 MiB、active duration 4時間、16,000 chunkを上限とし、sequence重複・欠落・size/duration/manifest超過をfile書込み前に拒否する。stop前のfinal Blob append時刻をdurableなactive duration cutoffとし、Renderer crash / reload後の無通信時間は録音時間へ加算しない。全録音Blob、absolute path、raw audioをRenderer state・response・通知・ログへ保持しない。選択中のdevice IDはRenderer内だけに留め、Mainへ送らない。

## #352 / #368 との共有境界

session manifest、recovery root、availability、ID-based protocol、Range配信、Renderer projectionはmedia共通基盤である。
`CommitAudioCapture`と`CommitVideoArtifact`、各media形式、Voice Capture / Video Artifact表示はmedia kind固有である。
将来の画面録画も同じ共通基盤を再利用し、音声sessionやUIへvideo条件分岐を追加しない。

## #367 Acceptance 対応表

| Issue原文 | 実装・証拠 |
|---|---|
| 対応audio fileをpickerまたは既存file導線から選べる | Inboxのsecondary actionからMain-owned pickerを開く。generic Artifact import/link/Proposalはaudio拡張子・MIMEを拒否し専用導線へ集約する |
| MIMEをoctet-streamへ潰さずaudio media contractとして保存する | extensionとRIFF/Ogg/EBML/MP3/ISO-BMFF signatureを同じsource FDで照合し、`audio/*` MIMEとcontainerをmanifest/Artifactへ保存する |
| 原音bytesを変更せずmanaged Artifactへ保存しcontent hashを保持する | sourceを`O_NOFOLLOW`で1回openし、同じFDからexclusive staged fileへcopy/hashする。SQLite縦断testとtiny PCM WAV smokeでbytes/hashを照合する |
| CommitAudioCaptureでCapture / Artifact / Relation / Event / Receiptを同じ正規境界へ確定する | Application Command transactionでCapture/Artifact/Event/Receiptを確定する。Relationは重複Referenceではなく`artifact.source_type=capture_entry/source_id`からContext Graphへowner edgeを1本投影する |
| DBだけ成功してfileが無いArtifactを作らない | staged→managed fileのhash/identity確定後だけDB commandを実行し、finalized recoveryでもfile/rootを再検証する |
| file成功/DB失敗時に原音を失わず再起動後にrecoverできる | durable manifestのfinalizing/finalizedを起動時に再生し、preparedは利用者判断、DB失敗finalizedは同じcommandを再試行する |
| 同じcommand retryでEntity/file/Eventを重複しない | manifestのcommand IDとreceipt idempotencyを再利用し、実SQLite reopen testでCapture/Artifact/Eventとowner edge各1件を確認する |
| Inboxでduration / size / statusをcompactに確認できる | 未整理・整理済みの同じVoice Capture helperでduration/size/transcription/availabilityを表示する |
| Content Viewerで対応形式を再生できる | `tasken-media://artifact/{id}`のaudio controlsでloading/error/success metadataを表示する |
| 再起動後も同じCaptureから同じArtifactを再生できる | ID markerによるTheme folder再発見、SQLite owner backlink、同一userDataを使う2-process Electron smokeで再取得・Range・playableを確認する |
| local_only既定、path/bytes/secretをlog/Renderer broadcastへ出さない | workspace/bootstrap/list/get/save/remove/restore、receipt/event、sender/other/satellite通知をdeep safe projectionし、protocol/IPC errorもsafe messageへ丸める |
| focused/full/typecheck/build/consistency/diff-checkが通る | 最終gateで各commandを実行し結果をIssue/PRへ記録する |
| Windows Electron smokeでimport→再生境界を確認する | smoke-only Main setupで決定論的tiny PCM WAVをprepareし、公開APIでlist/metadata/commit、Main `net.fetch`でRange、Electron再起動後にget/playableを確認する。production debug IPCは追加しない |

## #368 Acceptance 対応表

| Issue原文 | 実装・証拠 |
|---|---|
| 対応拡張子をvideo MIMEへstrict分類する | `.mp4` / `.m4v` / `.mov` / `.webm`をextensionとISO-BMFF / EBML signatureの組合せで分類し、曖昧なoctet-streamやgeneric Artifact導線を拒否する。`tests/video-artifact-contract.test.mjs`で正常・拡張子偽装・signature不一致を固定する |
| media_kind / duration_ms / width_px / height_px / file_size / content_hashを検証・保存する | `media_kind=video`とbounded safe integer metadataをMain/domain両境界で検証する。NaN / Infinity / 2^53 / 0px / 過大dimensionsを拒否し、SQLite reopen後も同じ値とSHA-256を確認する |
| managed / linked動画をTask / Note / Capture / Focusへ添付できる | `tests/media-capture-sqlite.test.mjs`でmanaged/linked × 4 ownerの8組を実SQLiteへ保存・reopenし、Artifact/Event各8、owner edge/backlink各1、Reference 0を確認する |
| 再起動後も元EntityとVideo Artifactを往復できる | owner別SQLite reopenとpackaged smokeで元Taskの存在、Artifactの`source_type/source_id`、Taskからのbacklinkを再取得する。Capture→Task移管でもmedia storage identityを保持する |
| Rendererへraw bytesやabsolute pathを渡さず、Artifact IDからrange再生する | `tasken-media://artifact/{uuid}`のexact 1 segmentだけを許可する。projection testでworkspace/entity/receipt/notification/Snapshotからpathとlinked identityを除去し、protocol testでuserinfo/query/fragment/余分segment/encoded slash/非UUIDをresolver前404・read 0にする |
| Content Viewerでplay / pause / seek / volumeが使える | native video controlsとID-only sourceを使う。packaged smokeでmetadata/canplay/seek、`volume=0.25`の保持、Range応答を確認する |
| decoder不可は空画面にせず理由と外部openを示す | ID-only inspectでmissing/changed/unsafe/unsupported codec/decoder errorを分ける。unsupported codecと検証済みdecoder errorだけ外部openを出し、Main-private snapshotを同一FDから作って開く。拒否・例外はdanger toastへ返す |
| linked missing / 非通常file / symlink / path差替えを安全な状態として扱う | prepare時にrealpath/dev/inoをmanifestへ固定し、commit/recovery/resolveで同一identityとsize/hashを要求する。missing/changed/unsafeを理由付き表示し、staged fallbackは行わない。same-bytes別inode、symlink、swapの回帰でDB/write/read 0を確認する |
| managed importのfile/DB片成功をrecoveryし、retryで重複しない | staged fileを`O_NOFOLLOW`で1回openし、同じFDからhash→exclusive final FDへcopy/fsync/hashしてからcommandを実行する。managed/linked双方のDB失敗retryを実SQLiteで再起動し、Artifact/Event/owner edgeが各1件のままになることを確認する |
| loading / empty / error / success状態を確認できる | Artifact sectionは初回list中だけ操作disabled＋`aria-busy`、0件は説明panelを常設しないcompact empty、list失敗は再試行、prepared/attachedはsuccessとして表示する。`tests/video-content-viewer.test.mjs`で状態遷移を固定する |
| focused/full/typecheck/build/consistency/diff-checkが通る | Video/Media/Snapshot focused 73件、full 931件、TypeScript typecheck、production buildを最終差分で実行する。consistency/diff-checkは最終Git gateで実行し、結果をIssue/PRへ記録する |
| Windows packaged Electronでimport→再生を確認する | `electron-builder --dir`で生成した`release/win-unpacked/Tasken.exe`を使い、`app.isPackaged=true`を必須化したsmokeを実行する。同一userDataの再起動前後でvideo metadata/canplay/seek/volume/Range、Task↔Artifact、audio回帰を確認し、fixture raw bytes/pathをproduction IPCへ公開しない |

## #371 Acceptance 対応表

| Issue原文 | 実装・証拠 |
|---|---|
| Inbox / Quick Captureから明示的に録音開始できる | Inbox secondary actionの「マイクで録音」から権限確認→入力device選択→「録音を開始」の明示操作で開始する。開始中はbuttonを無効化して二重sessionを作らず、MediaRecorder開始失敗時は作成済みMain sessionを破棄する |
| permission拒否、device無し、device切断を理由と直し方付きで表示する | DOMException名を固定した利用者向け文言へ投影し、track ended / MediaRecorder errorでも録音済みchunkをstop・復旧対象化してマイクを解放する |
| indicator、経過時間、pause/resume、停止、破棄をkeyboardでも操作できる | 色だけに頼らない「録音中」表示、tabular時刻、native button/selectをcompact panelへ置く |
| 全録音を単一巨大Blobに保持しない | 1秒timeslice BlobをさらにMain提示上限以下へsliceし、直列IPC完了後に参照を解放する |
| chunk重複・欠落・順序違反・上限超過をfile前に拒否する | exact typed IPCとMain manifestの`recordingNextSequence`、1 MiB/chunk・512 MiB/session・4時間上限で検証する |
| stop後に既存CommitAudioCaptureへatomic/idempotent確定する | O_NOFOLLOWで各chunkを1回openし、同FDからassembled WebM/hashを作成後、#367のmanaged publishとCommitAudioCaptureをそのまま使う。`capture_method=microphone`だけを区別する |
| cancelで正式Entityを作らず、失敗時はtemporary audioを保持する | recording/preparedだけを安全に破棄できる。append/stop/DB失敗はsession manifestと原音を残す |
| app終了・再起動後に復旧または破棄できる | app flushとroute cleanupでstopを試み、未停止のdurable sessionは`recording_interrupted`として保存待ち音声に表示する。同一Main processのRenderer crashでも最後のdurable chunk時刻をduration cutoffにしてdowntimeを除外する |
| path/raw audioをresponse/logへ出さない | start/progress/stopはsession ID・MIME・size・durationだけを返し、device IDはRenderer内だけ、OS pathはMain manifestだけに保持する |
| Quality / Windows packaged実証 | focused/full/typecheck/build/audit/diff-checkと、packaged版のsynthetic microphone stream→stop→再生→同一userData再起動を最終gateで実行する |

## 復旧状態

- `prepared`: preview・保存・破棄を利用者が選ぶ。missing/changedでもstrict manifestでpreparedを証明できる場合だけ破棄できる。
- `recording` / `recording_paused`: Main-owned chunk session。通常stopで`prepared`へ進み、再起動後は自動commitせず復旧または破棄を選ぶ。
- `finalizing` / `finalized`: managed rootが戻れば同一起動中も明示再試行できる。DB適用有無が曖昧なため破棄しない。
- `manifest_invalid`: path非露出の診断行として表示するが、stateを証明できないため自動確定・破棄をしない。
- `committed`:一覧へ出さず、Artifact IDから通常の再生経路へ解決する。
