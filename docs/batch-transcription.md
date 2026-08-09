# Batch transcription

Issue #372 Phase 1の文字起こしは、Audio Artifactの原音とraw transcriptを別の正本として扱う。
provider非依存コアからMain、SQLite、typed IPC、Audio Artifact詳細までを縦断接続し、録音保存は#371のMedia Capture正本を再利用する。

## 非交渉条件

1. RendererはArtifact ID、operation ID、確認tokenだけを返す。path、bytes、credentialをprovider要求として指定しない。
2. Mainは実行直前にArtifactのavailability、MIME、size、content hashを再解決する。Preview時から変化した原音は送信しない。
3. cloud処理は`external_ai`公開許可と、対象・provider・model・容量・形式・送信有無を示すPreviewへの明示確認を必須にする。
4. feature bindingは明示したprovider/modelだけを解決する。capability不足や利用不可時に別providerへfallbackしない。
5. raw transcript revisionはArtifact正本と同じ`sha256:<64hex>`の原音hash、provider/model、language、processing mode、時刻、status/errorを保持する。原音と過去revisionを上書きしない。
6. raw transcriptは永続化前に2,000,000文字以内へ制限する。上限超過したprovider responseを一部切り詰めて成功扱いにしない。

## Provider capability

`transcript_batch` provider bindingのprocessing modeは`cloud | local`だけで、`batch_transcription`を必要とする。local処理は追加で`local_processing`を要求する。
provider profileは`max_file_size`と`supported_mime_types`を宣言し、Mainはproviderを呼ぶ前に正本Artifactと照合する。
production adapterはAI Settingsのdefault provider/modelというexact pairだけを読む。実装済みmatrixは`openai-native`と`gpt-4o-transcribe | gpt-4o-mini-transcribe | whisper-1`の組合せだけで、`gpt-4o-transcribe-diarize`は固有response/optionsのadapter回帰がないため未対応とする。
OpenAI profileの現行file transcription形式はflac / mp3 / mp4 / mpeg / mpga / m4a / ogg / wav / webmを個別MIMEへ正規化して宣言する。
model IDや形式はprovider profileのcapabilityであり、Tasken全体の固定値や別modelへのfallbackにはしない。
feature bindingはprovider profile ID / model profile ID / processing modeの完全一致だけを解決する。選択先が利用できなくても、候補配列の先頭やdefault providerへ暗黙に切り替えない。

事前拒否は、sourceのmissing / changed / unsafe、provider無効、model利用不可、capability不足、資格情報未設定、MIME非対応、容量超過、cloud公開範囲外を区別する。

## Confirmation token

Mainが発行する短命HMAC tokenは、次のPreview fingerprintへ束縛する。

- Artifact ID、content hash、MIME、file size
- provider profile ID、model profile ID、canonical model ID
- processing mode、visibility、cloud送信有無

token検証後もMainが同じ正本を再解決する。tokenはoperation IDとnonceにも束縛し、Main-ownedのatomic claim storeが同じclaimを一度だけprovider送信へ進める。provider失敗を含む同じclaimの再送は既存結果へ収束し、利用者が再試行するときは同じrevisionに新しい確認tokenを発行する。tokenはprovider credentialではなく、Main-ownedの用途限定secretで署名する。

## Revisionと再試行

revisionの状態は`queued → processing → completed | failed | cancelled`とし、processing / completed / failedは`started_at`を必須にする。
failed / cancelledは同じrevision ID・attempt keyのままprocessingへretryできる。
同じoperation IDと同じ原音/provider/model/language/modeは既存revisionを再利用し、二重作成しない。
別operation IDによる再実行は新revisionをappendし、完了済みraw transcriptを変更しない。

revision provenanceのprocessing modeは`cloud | local | external`を保存する。`external`は外部transcript importの来歴だけに使い、provider adapterの実行modeにはしない。
`TranscriptionRevision`はArtifact/Captureのdata JSON内にappendするowned value objectであり、単独Entityではない。共通Entity列はowner側が保持する。
provider由来の任意error code/messageは永続化・表示・logへ通さず、allowlist済みcodeと安全な案内へ正規化する。

## 実行環境の境界

`src/shared/batchTranscription.mjs`はRendererでもbundleできるpure normalization / preflight / revision契約とし、Node built-inへ依存しない。
HMAC token、SHA-256 Preview fingerprint、確認済みprovider invocationは`src/main/services/batchTranscriptionConfirmation.mjs`だけが所有する。
productionは`transcription_operations`をSQLite schema v4でatomic claimし、同じoperationの同時実行とprocess再起動後のretryを二重送信へ進めない。raw audioは検証済みfile descriptorから25 MiB上限内で一度だけ読み、Main内のprovider callへ渡した後に破棄する。

## Issue #372 受入対応

| 受入条件 | 実装と検証 |
|---|---|
| Audio Artifact詳細からPreview | `BatchTranscriptionPanel`を既存Audio Content Viewerへcompact統合。loading / empty / error / historyを持つ |
| 対象・形式・容量・provider・model・cloud表示 | Main-built Previewを表示し、Phase 1の実行言語は日本語として明示する |
| Rendererへpath/bytesを出さない | IPC requestはArtifact ID中心、responseは公開metadata/revisionだけ。Mainが`resolveArtifactMedia`でFDを再取得する |
| 事前拒否 | availability/hash/MIME/size/visibility、exact binding、lifecycle、credentialをHMAC発行前と実行直前に照合する |
| 明示確認後だけprovider call | `確認して実行`で短命HMAC tokenを返した場合だけSQLite claimとadapter callへ進む |
| raw revisionとprovenance | Artifact/Captureの`transcription_revisions`へ原音hash/provider/model/language/mode/time/status/errorをappendする |
| retry/rerun/cancel | failed/cancelled retryは同じrevision、完了後の再実行は新revision。cancelはAbortSignalとSQLite終端を揃える |
| safe error | provider raw error/path/credentialは永続化・response・logへ出さずallowlist codeへ正規化する |
| fake provider SQLite E2E | confirmation→verified FD→provider→raw append、変更拒否、二重run、retry、cancelをfocused testで通す |

live provider smokeは利用者が明示した資格情報と送信許可がある環境だけで行う。資格情報のないCI/package検証はfake providerを使い、live成功とは扱わない。
