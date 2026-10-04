# Tasken v0.1.75

PR #638のFeed「対応待ち」のAgent Session記録の一括採用を配布する。行で選択し、表示中の記録の全選択・選択解除・選択件数・処理進捗を使える。未選択や新着の記録、他種別の提案、Task完了は一括採用に含めない。部分失敗時は失敗した項目の選択と理由を残し、再試行できる。

取り込み・出所・終了不明の扱い、プレビューとApplyAiProposalのversion検証・冪等性を維持する。データschema、権限、認証設定、NASの機能変更はない。PC版rendererの変更が中心で、Android APKは同じ通常リリースのversionName 0.1.75 / versionCode 67として作成する。

対象機能commitは `d500014a15c136335efb4ce7f2f482cb75f2e5cb`、main統合は `ccf3585bbb82a0258b8c27d968375c4633b13abd`。機能PRのWindows/Android CI、ローカル2,055成功・1スキップ、1760/390pxの合成データによる実画面・操作の証跡は、version以外の実装が変わらない限り再利用する。

`docs/release.md`の通常手順でversion PRの品質ゲート、mainへの統合、annotated tag、新しいWindows release workflow、恒久署名Android APKとchecksumを確認する。v0.1.74のtagと公開済み配布物は維持する。

この作業はマージ・公開まで。PC/Fold/NASの追加インストール、サービス停止、実データの採用は行わない。現在の導入版はv0.1.74であり、v0.1.75公開と実機導入完了を区別する。
