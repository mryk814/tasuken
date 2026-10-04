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

検証結果、最終SHA、実artifact、具体的配布手順は実行結果に合わせてこの文書を更新する。
