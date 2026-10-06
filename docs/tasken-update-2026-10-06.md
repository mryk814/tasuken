# Tasken v0.1.76

## 変更

- FeedのホームへAIの判断と未整理メモを集約し、Memoを付箋の画面として整理する。
- Notes一覧へのMarkdownファイルdropで新しいNoteを取り込む。字下げコードを含む本文は、未編集の切替や編集後の保存で意味を保持する。
- AI作業ログを自動採用し、会話名・稼働時間・依頼の抜粋で確認できる。ChatGPT契約で入力を整理する経路を追加し、利用上限時の従量APIへの自動切替は行わない。
- 時刻を過ぎたリマインダーをToday・ToDoとサイドバーで表示する。繰り返しTaskに今日の印を持ち越さない。
- Todayの継続・手入れをTaskと同じ行で表示し、Androidからも記録できる。連番と保存transactionを揃える。
- 元チャット候補のResource/旧Link重複を解消する。AI Importは一意のThemeコードを解決し、不明・曖昧コードの採用を拒否する。

## 配布と更新の条件

WindowsはNSIS installerとportable、AndroidはversionName `0.1.76`・versionCode `68`の恒久署名APKを、SHA-256とともに同じGitHub Releaseへ公開する。タグと版番号を一致させ、main上の固定commitから生成する。

既存のWindows/Android品質ゲートとWindows `release:check`を通す。Androidの新APKは公開済み0.1.75と導入済み正式版の署名・lineage互換を確認してから、データ保持の通常更新を行う。

更新は既存プロファイル・同期先・保存先・権限を保持する。Windowsは既存入力の保存とバックアップ、Androidは同じpackageへの`install -r`を使い、削除やデータ消去を行わない。NASは稼働版を確認してCore/同期/MCPの更新が必要な場合に限り、既存mountと設定を保ち、検証済みsnapshot後に固定imageへ更新する。

実アカウントのChatGPT認証・推論の受け入れは別境界で、既存データを使う検証のための外部AI送信をこの更新に含めない。
