# 公開記録の振り返り評価

この評価は、架空の記録を日別公開処理へ渡し、期間別索引から出典まで辿れるかを確認する。
ローカル評価の成功と、OneDriveへの到達、M365 Copilotの検索、回答の根拠確認は別々に記録する。
live確認の結果は[結果テンプレート](publication-context-live-result-template.md)へ記入する。

## 隔離した評価を生成する

repository rootで次を実行する。
出力先を省略すると、新しい一時ディレクトリを作る。

```powershell
rtk node scripts/evaluate-publication-context.mjs
```

保存先を指定するときは、親が存在する未作成のディレクトリを指定する。
既存ディレクトリは空であっても拒否する。

```powershell
rtk node scripts/evaluate-publication-context.mjs --output output/publication-evaluation-548-run1
```

runnerはsynthetic fixtureだけを使い、通常のTasken起動やWorkspace Importは行わない。
fixtureを本番Workspaceへimportしない。
評価をやり直すときは、新しい出力先を使う。

日付はAsia/Tokyoの2026年9月8日を基準に固定している。
初期snapshotは同日01:00 UTC、訂正後は02:00 UTCである。
実行した日やクラウドで確認した日時は、この架空の生成日時と分けて記録する。

生成物は次の用途に分かれる。

| 生成物                    | 用途                                                                 |
| ------------------------- | -------------------------------------------------------------------- |
| `current/Tasken Context/` | 訂正と公開取消しを反映した最終公開物。live確認でコピーする唯一の範囲 |
| `questions.md`            | 固定4問、更新後に期待する出典、言ってよい事実、禁止する推測          |
| `verification.json`       | 初期と訂正後の出典、ローカル検証結果、未実施のlive検証欄             |
| `queue-state.json`        | キュー再起動確認用の内部状態。クラウドへ送らない                     |
| `partial-case/`           | 501件中500件の部分取得と明示許可の確認用。クラウドへ送らない         |

初期snapshotはrunner内部で検証し、同じ公開先へ訂正後を反映する。
初期のMarkdown一式は保存しないため、初期状態とのクラウド差分を検証したとは扱わない。
訂正後の全文末尾、9月4日実施で9月8日入力の遅延記録、非公開化した本文の撤去、リンク、出典revision、キューの再起動継続をローカルで確認する。

## 固定4問を使う

質問の全文と期待結果は生成された`questions.md`を使う。
「今日」「今週」「この一年」へ置き換えると評価範囲が変わるため、日付を維持する。

| ID                 | 質問の対象                   | 確認する区別                                                         |
| ------------------ | ---------------------------- | -------------------------------------------------------------------- |
| `day-work`         | 2026年9月6日に何をしたか     | 予定、未整理入力、未確認のAI報告を本人の実績にしない                 |
| `week-uncertainty` | 9月7日から13日の材料A        | 仮説を確定した原因にしない。未来の未公開日を不活動にしない           |
| `month-history`    | 2026年8月の材料AのTask       | 当時の所属と現在の材料B所属を区別し、再送を重複計上しない            |
| `year-evidence`    | 2025年9月9日から2026年9月8日 | 出典のある実績と未公開範囲を区別し、未送信やクラウド索引を推測しない |

## OneDriveとM365 Copilotで確認する

仕事アカウントでの確認はrelease後にユーザーが行う。
個人OneDriveの既存同期証跡は[日別公開の文書](daily-context-publication.md)に記録済みだが、このfixtureや仕事アカウント、M365 Copilotの成功証拠には流用しない。

1. `verification.json`のローカル成功を確認し、commit、実行日時、出力先を結果テンプレートへ記録する。
2. ユーザーが選んだ評価専用のOneDrive保存先へ、`current/Tasken Context/`だけをフォルダー構造ごとコピーする。出力root全体、`partial-case/`、`queue-state.json`、期待解答を含む`questions.md`をコピーしない。
3. OneDriveのWeb表示でREADMEから日別とSourcesへ辿り、訂正後の生成日時、出典revision、本文末尾を確認する。ローカルの同期アイコンだけではクラウド到達を成功にしない。
4. M365 Copilotで評価フォルダーの公開物を検索する。使用したアカウント種別、質問日時、見つかったファイルとリンクを記録する。
5. 新しい会話で`questions.md`の質問本文だけを一問ずつ送り、回答と引用リンクを保存する。期待する事実や出典一覧はプロンプトに混ぜない。
6. 引用先を開き、型、ID、revision、記録当時の所属、未確定の表現が回答を支えているか照合する。出典にない完了、原因、時間、網羅性の断定は失敗として記録する。

判定は`passed`、`failed`、`not_run`を層ごとに付ける。
クラウド到達が成功しても検索は未実施のままにでき、検索成功から回答の正しさを推定しない。
アクセスできない場合や検索で見つからない場合は、観測した状態と日時を残す。
未実施のlive確認をローカル成功で埋めない。

関連テスト:

```powershell
rtk node scripts/run-electron-node.mjs --test tests/publication-context-evaluation.test.mjs
```
