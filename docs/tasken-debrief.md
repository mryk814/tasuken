# Tasken Debrief

## Product decision

Tasken Debriefは、AIとの作業を自動で日報化する機能ではない。
AIへ委任した仕事を証拠とともに見直し、利用者自身の判断として回収し、次に戻る条件へ接続する振り返りである。

AIはEvidenceの整理と、その日に必要な問いの選択までを担う。
利用者の判断、内省、Next returnをAIが代筆しない。

## Concrete referent map

| Source                                 | Purpose                                          | Concrete referent                                                     | Role                   | Order or relation                        | Label               |
| -------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | ---------------------- | ---------------------------------------- | ------------------- |
| coding clientのnative log              | 必要時に一次情報へ戻る                           | clientが所有するconversation / session log                            | raw source             | Taskenはsafe locatorだけを持つ           | source session      |
| lifecycle hook events                  | 後で全ログを走査せず一日の仕事を選べるようにする | start、全user prompt、response checkpoint、endの端末内観測            | local observation      | source session IDで束ねる                | session observation |
| 一つの完結sessionの観測記録            | 証拠を見ながら振り返る                           | metadata、request timeline、response checkpoints、relations、evidence | review media           | observationから生成し、Debriefへ入力する | Session Packet      |
| Session Packetから組み立てた当日の事実 | 利用者の記憶を補助する                           | AI生成または規則生成の作業recap                                       | derived projection     | 利用者が確認・訂正する                   | Evidence recap      |
| 利用者が書いた判断と内省               | AIへ委任した仕事を自分の判断へ戻す               | decision、adaptive answer、evidence correction                        | canonical human record | Debrief完了時に保存する                  | Human reflection    |
| 次に作業へ戻る入口                     | 振り返りを再開可能な行動へ変える                 | triggerとfirst action                                                 | canonical plan         | 次回のToday / Themeで提示する            | Next return         |

## Non-negotiable compatibility conditions

1. raw transcript、hidden reasoning、tool call列、absolute local path、credentialをTaskenのcanonical entity、MCP response、Snapshot、public projectionへ保存・公開しない。
2. AgentSession、WorkReceipt、ChangeEvent、external referenceの既存identityとrelationを壊さない。
3. AIが生成したEvidence recapと利用者が書いたHuman reflectionを、表示上もデータ上も混ぜない。
4. AI報告だけでTaskを完了せず、Debrief完了もTask状態を暗黙に変更しない。
5. Debriefを作らない日や軽作業だけの日も、Session Packet収集と通常のToday操作を妨げない。
6. 既存Note / Snapshot / Import / Exportは旧データを読み続け、追加データはversionedかつ往復可能にする。

## Collection timing

### During a session

hookは意味を推論せず、短時間で次を追記する。

- session start / endとclient metadata
- 全user promptの時刻とsanitized text
- 各response checkpointの時刻とsanitized terminal response
- repositoryを解決するためのlocal-only cwd
- source sessionのopaque ID

同じeventの再送はevent identityで重複排除する。
並行hook processは一つのSession Packetへ観測時刻順にmergeする。

### At session end

terminal observationでPacketをfinalizeする。
終了時にagent自身から構造化outcomeが届く場合はAI報告として保持するが、観測事実へ昇格させない。
Tasken自身がLLM APIを呼んでHuman reflectionを生成しない。

### At Debrief time

最初に当日分のSession Packetだけを読む。
Packetで不足または矛盾があるsessionに限ってsource sessionを追加参照する。
全native logを毎回走査しない。

外部AIからはread-only MCP tool `tasken.get_debrief_context`を使う。
これは現在のrepositoryに関連するcanonical Session Packetと直近のTasken Debriefだけをboundedに返す。
同じrepositoryに関連するTheme CharterのpurposeとTheme Stateのcurrent directionも、Evidenceを目的へ接続するための補助Contextとして返す。
raw transcript、hidden reasoning、tool call列、private pathは返さず、`My decision`と`Next return`をAIが代筆してはならないことも応答契約に含める。
Tasken UIのDaily Debriefは、未採用のtrusted hook Packetも保存時の一つの確認境界で回収できるため、全workspaceを振り返る正式導線はこちらとする。

## Evidence strength

Evidence itemは必ず次のいずれかを持つ。

- `observed`: hook event、canonical ChangeEvent、commit等から直接観測した事実
- `agent_reported`: agentのterminal response / structured outcomeによる報告
- `inferred`: TaskenまたはDebrief生成AIによる推定

推定を事実らしい文章へ混ぜない。
利用者が訂正した内容はHuman reflection側へ保存し、元Evidenceを黙って書き換えない。

## Daily Debrief

所要時間2〜4分は研究上の保証値ではなく、継続性を評価するためのプロダクト仮説とする。

1. `AIから届いた結果`: 当日の結果と残作業を最初から表示する。振り返りフォームを開かなくても確認でき、blocked / remaining workを先に置く。詳細には元の指示・結果・記録された確認内容を残す。
2. `判断と次の一手を残す`: 判断を残したいときだけフォームを開く。毎日の入力を結果確認の前提にしない。
3. `自分の判断`: 採用・修正・保留した判断を一文以上書く。
4. `次の一手`: 次に戻るtriggerとfirst actionを書く。再開しない判断も許可する。
5. `訂正・補足を残す（任意）`: Evidenceの訂正と、強いsignalがある場合の適応質問はここで扱う。
6. `判断を保存する`: Human reflectionをReport Noteとして保存する。未確定のtrusted hook Packetも取り込む場合は、保存前に件数と意味を明示する。Taskは完了しない。

開始・終了だけ、または指示のみで応答が残っていない終了済みhook記録は削除せず、内容のある結果から分けて詳細に置く。
通常の構造化AgentSessionは、request / response checkpointがないだけでは空記録と扱わない。
Activityの全時系列は二次導線「時系列の記録を見る」で参照できる。

`My decision`では、立派な結論を要求しない。
「自分では決めていない」「AI案を採用したが理解は追いついていない」「判断を保留した」も有効な回答である。

適応質問の例:

| Packet signal                  | Question                                         |
| ------------------------------ | ------------------------------------------------ |
| AIへ広く委任した               | 自分が説明できない部分はどこ？                   |
| 方針変更が複数回あった         | 最後の判断を変えた観測事実は何だった？           |
| 未検証の完了報告がある         | 何を確認できれば、自分の判断として完了と言える？ |
| blocked / remaining workがある | 最初の障害と、代替策は何か？                     |
| 強いsignalがない               | 質問を出さない                                   |

Next returnは「明日」に限定しない。

```text
trigger: 次にTaskenのagent-session作業へ戻ったとき
first_action: 実機確認チェックリストを開き、Inbox即時反映を一回再現する
```

## Weekly Debrief

Dailyを長文化せず、複数日にまたがるpatternは週次で扱う。
所要時間10分前後をプロダクト仮説とする。

- 同じ種類の判断を何度繰り返したか
- 「次にやる」と書いたまま開始できなかったものは何か
- AI recapを頻繁に訂正した領域はどこか
- 未検証のまま残り続けたものは何か
- AIへ任せる境界を来週どう変えるか

Weeklyの回答もHuman reflectionであり、AIに代筆させない。

## Persistence

Debriefは既存の`Note`（`note_type=report`）として日付・種別ごとに一枚保存する。
Markdownは人が読める投影であり、`properties_json.tasken_debrief`を構造化正本とする。

```text
tasken_debrief {
  schema_version: 1
  kind: daily | weekly
  period_start
  period_end
  source_session_ids[]
  evidence_corrections[]
  decision
  adaptive_question?
  adaptive_answer?
  next_return {
    trigger
    first_action
    resume_state: planned | not_planned
  }
  completed_at
  duration_seconds?
}
```

Evidence recap本文はAgentSession / Packetから再生成できる派生情報である。
Human reflectionとNext returnは再生成できないため、保存とSnapshot / Export往復性の対象にする。

## Completion and evaluation

Dailyの完了条件:

- Evidenceを表示できる、または「対象sessionなし」を明示できる
- `My decision`が入力されている
- `Next return`が入力されている、または再開しない判断がある
- 保存後に同じ日付のDebriefを再表示・編集できる
- source Sessionへ辿れる

機能の価値は文章量で測らない。

- 対象日の完了率と週ごとの低下
- 完了までの操作時間
- AI recapを利用者が訂正した率
- Next returnから最初の行動を開始できた率
- 未検証項目の解消と同じ手戻りの再発

利用状況が悪い場合、内省自体を否定する前に、問いの数、提示タイミング、recapの長さ、入力負担を疑う。
