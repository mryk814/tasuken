# Taskボード統合候補の検証記録

検証日: 2026-10-03。Windows / Node.js 24.4.1 / npm 11.4.2 / Electron 37.10.3。
公開baseは `a98f9955fb88140ac4b944ac9dfbdada3acb18b9`。

## 成功済みの機能検証

公開用に選択した91ソース・設定・テストファイルは、検証済み候補 `3d3e30d9a5db68723a46da8e1c96d1bea494df00` と改行を除いて一致する。残る `tests/ci-runner.test.mjs` の1ファイルはcommit hookによるPrettier整形だけで、元の内容を同じPrettierで整形した結果と一致する。公開向けに書き直した3文書と本記録は実行動作を変えない。
未公開のNAS運用記録・更新用スクリプト14ファイルを取り込まず、公開baseから一つの変更として構成する。

| 検証                           | 結果                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 全CI `npm run ci`              | 成功、273.407秒。lint / typecheck / strict consistency / architecture gate / script inventory / build / Desktop smoke / live MCP smokeを通過 |
| 全Node tests                   | 258ファイル、2010件中2009 pass、0 fail、1 skip（既存のpackage成果物依存チェック）                                                            |
| 統合ボード実画面監査           | 16項目成功、47.664秒。既存Taskの一覧／ボード、依頼→質問→返答→修正依頼→報告採用→明示完了、競合時の入力保持、繰返し、2端末同期、再起動         |
| PC表示と入力                   | 1400 / 820 / 420幅、空列、keyboard状態変更、由来説明のfocus／Escape、未確認点、動きを減らす設定を確認                                        |
| AI作成の実画面smoke            | 成功。Task / Noteの既存create-only経路、由来表示・既読操作を確認                                                                             |
| Android unit                   | 197 pass、0 fail / error / skip                                                                                                              |
| Android native instrumentation | 一時phone emulator 4件、Fold emulator 2件成功。由来なし／あり、未確認、関連Note、説明、狭幅を確認                                            |

AI作成の未確認、報告の要対応、Taskの正式完了は別の状態。報告採用はTaskを完了せず、採用後の「Taskを完了」が既存の明示完了commandを実行する。

## 公開用checkoutで追加した最小確認

元の成功結果と同じソース・依存・Windows環境を照合し、全CIとnative instrumentationは繰り返していない。これは新しい公開commit SHAそのものに対する全CI実行を意味しない。

- lockfileから独立した `npm ci` が成功（46.353秒）。lockfileの依存解決は公開baseと同じで、version表記だけが変わる。
- Androidの `testDebugUnitTest assembleDebug assembleDebugAndroidTest` が成功（53.123秒、unit 197 pass）。SDK/JDKとwrapperによる生成を確認。実機installは行っていない。
- PCの `npm run build` が成功（30.754秒）。新しいcheckoutから起動し、appPathと一時userDataの一致、可視window、ボード／課題会話、AI由来アイコンを確認してpreviewだけを終了した。架空fixtureを再利用し、実画面のスクリーンショットを目視確認した。
- commit hookで整形されたCIランナーのテストだけを再確認し、10件成功（5.514秒）。実装や全品質ゲートの構成は変更していない。

再現手順は [task-board-ci-integration.md](task-board-ci-integration.md)。同じ結果を引継ぎごとに再生成せず、変更・統合・環境差に応じて必要な確認を選ぶ。

## 公開・検証の境界

ソースとlockfile、手順、架空fixtureを保存する。ユーザーDB、profile、実ログ、画像、秘密情報、依存ディレクトリ、build成果物はcommitしない。
新branchへの通常pushは既存workflowの起動条件に該当しないため、GitHub Actionsの自動CIは実行されない。PR、main更新、tag作成、workflow dispatch、release、通常Desktop／NAS更新は実施しない。
開始専用capabilityと#629のログ可視化は未統合。接点と統合時の確認事項は再現手順に記録する。
