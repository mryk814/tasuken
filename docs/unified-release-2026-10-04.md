# Tasken v0.1.74 統合リリース

## 対象と境界

2026-10-04 の owner 指示により Tasken の PR #631–#636 を統合し、main の確認後に通常の GitHub Release を準備・公開する。PC / Android の実データは合成検証に使わない。追加の owner 指示により Tasken NAS のバックアップ・一時停止・同時更新も許可されている。他のNASアプリ、credentials、権限、networkは変更しない。

remote main は `78f91df96341ef372065b65cca767751a872e0e2`。統合候補は `codex/tasken-unified-release-20261004`。既存 checkout / worktree / stash / version draft5 / #546 は保持する。2026-10-04 の確認時点で元の Claude checkout は clean、最新公開版は v0.1.73、v0.1.74 の tag / Release は存在しない。

## 固定した入力

| PR   | head SHA                                 | 内容                                   |
| ---- | ---------------------------------------- | -------------------------------------- |
| #633 | 7d2abf7423ad68bcaf1a29626fa0fba1ade32015 | Activity と hooks 不要の保存先ログ同期 |
| #632 | f898291d7b68acbec398315bf8f444ef59c1d629 | Android の4タブと記録画面              |
| #634 | 06183419f478b6cf8c2b4bb29dc46b81c8510e9c | Android Feed読取、Room 27→28           |
| #635 | 13d9ceae92271934491a67142b53ea9f2a09ba10 | Feed反応・返信、Room 28→29             |
| #636 | a92960ff896677a00247843bde9d8b5c83accc2c | Feedの密度調整                         |
| #631 | 1a176f6aba811176501af5d0265bce8ffd8a169e | v0.1.74版番号と配布情報                |

統合前と公開前に remote head を再照合し、未収録の変更があれば取り込んで関連検証をやり直す。#636 は #632→#634→#635 を含むことを ancestry で確認する。

## 検証方針

#633 の2043 pass / 0 fail / 1 skip、Windows package / packaged MCP、Android CI、合成ログの実Electron1760px / 390px操作は成功済み。統合では Feed gateway / author射影、Coreとcollectorの同時初期化・終了、版とmanifestの一致を重点的に確認し、最終候補の通常CIを通す。

Room 27→28→29 は合成データまたは検証用DBコピーで確認する。PC gateway と隔離 Android emulator で取得・反応・返信・オフライン再送の往復を確認し、private log を読まない。履歴同期のcollectorは一時userDataと合成保存先だけを使う。

## 配布・復元の条件

#635 でFeed read modelが増えるため、旧APKは新DesktopからのFeed更新に失敗して保存済み投稿を表示し続ける。PCとAndroidを同一統合コミットから用意し、片側だけ先に常用環境へ入れない。Android Roomが29へ上がった後の旧APKへのダウングレードはDB移行を巻き戻せないため、更新前のコピーとAPKを保持する。

NAS更新に必要な対象service・image・volume・writer停止・backup・復元操作を確認し、PC / Android と同じ統合版で準備する。未保存入力と端末identityをoperator handoffで確認する。passwordが必要ならnative terminalでownerに操作を渡し、秘密を会話へ出さない。

## 統合候補の検証結果

タグ作成前の既存 Activity Release smoke は、廃止された「TaskenのActivity」折りたたみを探して失敗した。検証先を現在の主画面 `#daily-activity` に合わせ、確定終了を示す時刻ラベルも期待値へ加えた。画面再読み込み後は Today の操作入口が再表示されるまで待つ。隔離実Electronの development 実行で、9件の時刻・出典・Theme色、5本の期間アンカーと7本の点アンカー、08–19時の初期範囲、詳細・Task編集・日跨ぎの入力保持・横幅の既存検証が成功した。画像は `output/playwright/activity-packaged-smoke/activity-development.png`。packaged app の検証は最終Releaseのゲートで実施する。

初回統合候補 `3595b2fcb6458891c5a91ac49dfe2fc79d1938a9` でWindows quality（package / packaged MCPを含む）、Android quality、Android release signingの検証jobが成功した。恒久署名APKの生成・Release公開をこのCIの成功だけで完了扱いにはしない。

統合境界のNode63テスト、typecheck、build、Android JVM testとdebug app/test APKの生成が成功。新しい空のAPI35 emulatorでRoom移行・Feed操作・offline幅の38テスト、UI tourの3テストが成功した。統合buildの保存先collectorは実Electronの1760px / 390pxで登録・同期・採用・同一Session更新・停止・再起動・欠損表示を確認した。画像は `output/playwright/agent-log-sync/`、Androidは `output/android-ui/` に保存して目視した。

実HTTPのPC Gateway/Core/SQLiteと専用Android emulatorでFeed取得、反応、offline返信、PC再起動、応答消失時の同一commandId再送、書込み口なしでの保留と再開が成功した。AndroidのHTTP層がPOSTを自動再送する場合も、返信は重複しない。再現コマンドは次のとおり。実機や通常pairingを使わず、runnerが生成した合成tokenと一時DBだけを使う。

```powershell
rtk node scripts/run-electron-node.mjs tests/helpers/run-android-offline-journey.mjs emulator-5580 MobileFeedGatewayTest --feed
```

NAS SSHの接続とx86_64は確認した。Docker metadataの読み取りはsudo password待ちで未実施。サービス停止・本番データ変更はまだない。接続実機SC-51DにはTasken packageがなく、更新対象のFoldはoperator handoffで確認する。Release artifact、最終main/tag SHA、backupと配備結果は実行receiptで照合する。
