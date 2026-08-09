# Batch transcription

Issue #372 Phase 1の文字起こしは、Audio Artifactの原音とraw transcriptを別の正本として扱う。
この文書はprovider非依存コアの契約を固定し、録音UI・media session・IPC・SQLite接続は#371統合後の縦断作業へ残す。

## 非交渉条件

1. RendererはArtifact IDと確認tokenだけを返す。path、bytes、credentialをprovider要求として指定しない。
2. Mainは実行直前にArtifactのavailability、MIME、size、content hashを再解決する。Preview時から変化した原音は送信しない。
3. cloud処理は`external_ai`公開許可と、対象・provider・model・容量・形式・送信有無を示すPreviewへの明示確認を必須にする。
4. feature bindingは明示したprovider/modelだけを解決する。capability不足や利用不可時に別providerへfallbackしない。
5. raw transcript revisionはArtifact正本と同じ`sha256:<64hex>`の原音hash、provider/model、language、processing mode、時刻、status/errorを保持する。原音と過去revisionを上書きしない。
6. raw transcriptは永続化前に2,000,000文字以内へ制限する。上限超過したprovider responseを一部切り詰めて成功扱いにしない。

## Provider capability

`transcript_batch` provider bindingのprocessing modeは`cloud | local`だけで、`batch_transcription`を必要とする。local処理は追加で`local_processing`を要求する。
provider profileは`max_file_size`と`supported_mime_types`を宣言し、Mainはproviderを呼ぶ前に正本Artifactと照合する。
初期OpenAI profile候補は`gpt-4o-transcribe`を明示選択するが、coreへdefault modelを埋め込まない。
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

## 次の接続点

#371統合後にMain serviceが次を接続する。

1. Artifact IDからID-only media resolverで検証済みfile descriptorを取得する。
2. AI provider settingsのprofile/modelを`TranscriptBatchBinding`へ投影する。
3. Previewとconfirmation tokenをIPCへ公開し、明示確認後だけadapterを呼ぶ。pure test用in-memory claim storeはproductionでは使わず、operation ID / nonceをSQLite transactionでreserve・完了するdurable storeへ接続する。
4. transcription revisionをowner EntityのSQLite JSONへappendし、Capture / Artifactから履歴を取得できるようにする。
5. fake providerでSQLite E2E、資格情報が明示された環境だけlive smoke、Windows packaged境界testを実行する。
