# Transcription history

TaskenはAudio Artifactから新規の文字起こしを実行しない。LLM／音声APIのprovider設定、Cloud送信Preview、実行、再試行、cancelはIssue #501で撤去した。

## 維持する互換境界

1. Audio ArtifactとCapture Entryの原音・再生・保存経路は維持する。
2. 既存の`transcription_revisions`はread-only履歴として表示する。
3. revision内の原音hash、provider/model、language、processing mode、時刻、status/errorは過去成果物のprovenanceとして保持する。
4. 旧`queued`／`processing` revisionはschema v6 migrationで`failed/provider_failure`へ終端化し、原音を削除しない。
5. 旧実行管理table `transcription_operations`はmigrationで削除する。

新しい文字起こしが必要な場合は外部ツールで実行し、成果物をTaskenへ取り込む別契約を先に設計する。未定義の自動Import経路は作らない。
