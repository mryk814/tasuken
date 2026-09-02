# GitHub Issueの現在地

> 更新日: 2026-09-02 JST  
> 対象: `mryk814/tasuken`  
> 実装基準: `main@02ce220c` / `v0.1.47`

## 現在の基準点

- [v0.1.47](https://github.com/mryk814/tasuken/releases/tag/v0.1.47)を公開済み。
- AndroidのToday / ToDo / Quick Add / Task編集導線とToday widgetを初回改善済み。
- AI ReadyはAI作業を許可する単純な印とし、AIがMCPで明示的に引き受けると作業開始になる。Today / ToDoには作業中表示が出る。
- Open Pull Requestは0件。`main`と`origin/main`は同期済み。
- mainへ統合済みのworktree 18件、ローカルbranch 30本、remote branch 46本を整理した。未コミット5 worktreeとmain未包含38 branch tipは削除せず保留した。

## 現在の判断

Open Issueは5件になった。

現在の主目標は、v0.1.47を実際に使い、Android版のToday / ToDo / Quick Add / Task編集に残る具体的な詰まりを見つけて小さく直すことである。

この目標は[#518](https://github.com/mryk814/tasuken/issues/518)で扱う。

既存の大きなAndroid Epic、受入Issue、Architecture Epicは閉じた。
今後の細かな不具合や改善は、利用場面と完了条件が分かる小さなIssueへ切り出す。

## 現在のOpen Issue

| Issue                                                 | 扱い    | 残す理由                                                                              | 次の判断                                                                 |
| ----------------------------------------------------- | ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [#518](https://github.com/mryk814/tasuken/issues/518) | **Now** | 初回改善はv0.1.47へ入ったが、Android実利用での確認が残る                              | 実機で使い、迷った操作や余分なタップを具体例ごとに小さく直す             |
| [#273](https://github.com/mryk814/tasuken/issues/273) | Backlog | Google Calendar接続は未完であり、実装対象が明確                                       | #518後に優先順位を再判断する                                             |
| [#453](https://github.com/mryk814/tasuken/issues/453) | Backlog | local usage logは、使った機能を残すか削るかの判断に役立つ                             | 実装する場合はTask / Today / Captureの最小eventから始める                |
| [#454](https://github.com/mryk814/tasuken/issues/454) | Later   | 日常利用が進んだ後に、Later / Habit / Maintenance等の必要性を判断するための方向性メモ | 新しい概念を一括実装せず、具体的に欲しくなった1件だけを別Issueへ切り出す |
| [#427](https://github.com/mryk814/tasuken/issues/427) | Later   | Desktop非依存sync relayは将来候補だが、現時点では実害が明確でない                     | Desktop依存が日常利用を反復して妨げた場合だけ再開する                    |

## #518で次に扱う範囲

対象画面は次の4面に限定する。

- Today
- ToDo
- Quick Add
- Task詳細

v0.1.47の実利用で次の事実を記録する。

1. よく使う操作の画面遷移とタップ数。
2. Desktop版と異なる用語、Task状態、情報のまとめ方。
3. 主要操作が見つけにくい箇所。
4. Taskenらしい色、文字、余白、状態表現から外れている箇所。
5. Galaxy S23相当サイズとFold emulatorでの混雑、clip、片手操作の問題。

記録後、日常頻度と効果が高い問題を3点まで選び、同じIssueで次の改善を行う。

新しいEntity、Gateway変更、sync再設計、全体Architecture移行は#518へ混ぜない。

## 今回閉じたIssue

| Issue                                                 | close reason | 判断                                                                                |
| ----------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| [#477](https://github.com/mryk814/tasuken/issues/477) | completed    | Android daily-driver候補を現時点で受け入れた。残る細かな確認は個別Issueへ移す       |
| [#398](https://github.com/mryk814/tasuken/issues/398) | completed    | Gateway、Tailscale Serve、pairing、scope等の基礎実装は成立した                      |
| [#402](https://github.com/mryk814/tasuken/issues/402) | completed    | AndroidのAI Inbox、Receipt、Proposal review等の主要経路は成立した                   |
| [#397](https://github.com/mryk814/tasuken/issues/397) | completed    | Android Companionの基礎は成立した。今後のUI改善は#518へ移した                       |
| [#291](https://github.com/mryk814/tasuken/issues/291) | completed    | Document save command、atomic file更新、binding、recoveryの現行実装を一区切りとした |
| [#405](https://github.com/mryk814/tasuken/issues/405) | not planned  | 全featureのcapability API移行は範囲が広い。必要なfeatureだけ個別に扱う              |
| [#406](https://github.com/mryk814/tasuken/issues/406) | not planned  | Workspace全体の横断移行は利用者の完了条件が分かりにくい                             |
| [#407](https://github.com/mryk814/tasuken/issues/407) | not planned  | shared、contract、型ドリフトを一つに扱うには範囲が広すぎる                          |
| [#403](https://github.com/mryk814/tasuken/issues/403) | not planned  | modular monolith全体のEpicは、現在の利用者課題から実行順を判断しにくい              |

## Issueを増やす基準

今後は次の条件を満たすIssueだけを作る。

- 利用者が何をしようとして困るのかを一文で説明できる。
- 対象画面、操作、データの範囲が分かる。
- 完了を実画面または保存結果で判断できる。
- 将来のためだけの横断整理を目的にしない。
- 完了済み機能の細かな違和感は、元Epicを開き続けず個別Issueへ切り出す。

## 未検証境界

v0.1.47のWindows配布物とpackaged smokeはGitHub Actionsで確認済みである。
Android qualityは通過済みだが、v0.1.47のAndroid実機、Fold emulator、live Gatewayは未確認である。
