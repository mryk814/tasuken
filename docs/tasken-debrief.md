# Tasken Debrief

## Product decision

Tasken Debriefは、その日の記録を読み返し、日報をAIへ依頼してNotesで続ける導線である。

Taskenが日報本文を自動保存したり、人の回答を補ったりはしない。

日報の入口はClaude Codeなどに表示するMCP prompt「Tasken日報」（`daily-report`）である。
引数なしで実行し、実行環境のローカル当日を対象にする。

画面の「日報の依頼文をコピー」は、選択した日付をMCP接続済みのAIへ渡す補助導線である。

## Concrete referent map

| 実在する対象                 | 目的                                       | Taskenでの扱い               | 保存先                       |
| ---------------------------- | ------------------------------------------ | ---------------------------- | ---------------------------- |
| 当日のActivity               | その日に起きた操作を時系列で確認する       | 最上部のread-only projection | `ChangeEvent` / Activity     |
| 完結または進行中のAI session | 依頼、結果、残作業を確認する               | 固定サイズのAI作業カード     | `AgentSession` と関連record  |
| AIが作る日報草稿             | 事実をまとめ、当日の内容に沿う問いを添える | pending Proposal             | `AI Proposal`                |
| 人間が採用した日報           | Notesで読み、回答を追記する                | Report Note                  | `Note`（`note_type=report`） |
| 人間がNotesで書き足す回答    | 草稿の問いに自分の言葉で答える             | Markdown本文の編集           | 同じReport Note              |

## Non-negotiable compatibility conditions

1. raw transcript、hidden reasoning、tool call列、absolute local path、credentialをcanonical entity、MCP response、Snapshot、public projectionへ保存・公開しない。
2. AgentSession、WorkReceipt、ChangeEvent、external referenceのidentityとrelationを壊さない。
3. Activityの観測事実、AIの草稿、人間がNotesで追記した回答を混ぜない。
4. 日報の生成や採用だけでTaskを完了させず、TaskやReferenceを新規作成しない。
5. 日報を作らない日も、Session Packet収集とTodayの通常操作を妨げない。
6. 既存の`properties_json.tasken_debrief`を持つNoteは読み続けるが、新しい日報はこの旧フォームを作らない。

## 一日の流れ

1. Debriefを開くと、選択日のActivity時系列を最初に表示する。
2. その下にAI作業カードを並べ、blockedまたは残作業があるカードを先に置く。
3. カードはhoverまたはkeyboard focusで、Intent、Outcome、残り、記録された確認をpreviewする。
4. 利用者は「Tasken日報」をAI clientで実行するか、補助のコピー操作で同じ依頼文を渡す。
5. AIは`tasken.get_debrief_context`へ対象日を渡し、boundedな当日ActivityとAIへ公開可能なSessionを読む。日報ではRepositoryで絞らない。
6. AIは事実に基づく草稿と、その日の内容に応じた問いを作り、`tasken.propose_note`でReportをpending Proposalとして送る。
7. 利用者はAI Inboxで本文を確認して採用する。
8. 採用後のReport NoteをDebriefまたはNotesから開き、Markdownの回答欄を人が編集して保存する。

## 日報草稿の内容

草稿は、その日の作業、成果、未解決事項を根拠に沿ってまとめる。
冒頭で何が進んだ日かを短く述べ、ThemeやTaskごとに関連作業をまとめる。
同じ作業の再送・複数Sessionを重複計上せず、内容のない開始終了記録は本文に並べない。
AI以外の作業も含め、観測された事実とAIの報告、推測を区別する。

判断は記録にある場合だけ扱い、理由や他の選択肢を補作しない。
Sessionの終了やTaskの更新を完了の証拠とせず、未検証の結果や残る確認を明記する。
取得上限や公開範囲によって一部だけなら、その範囲を短く示す。

問いは固定の「自分の判断」や「次の一手」にしない。

たとえば未検証の結果が残る日には確認条件を、方針が変わった日には判断を変えた事実を問う。

問いは原則一つ、異なる有用な観点がある場合だけ二つまでとする。
強い根拠がなければ、架空の場面や感情を前提にした問いを作らない。

問いの直後には人が後から書く回答欄を空欄で置く。

AIは回答、判断、完了を推測で埋めない。
既存日報に人間が追記した回答は上書きしない。

この内容方針は[nippoの日報テンプレート](https://github.com/mryk814/nippo/blob/main/docs/templates/nippo-template.md)と[振り返りテンプレート](https://github.com/mryk814/nippo/blob/main/docs/templates/reflection-template.md)を参考にする。
Taskenでは生ログを再収集せず、統計や用語レビューを必須項目にせず、一つのReport Note内に事実と空欄の回答欄を置く。

## MCPと保存の境界

TaskのAI作業は、Taskの開始記録・受信したTask Work Proposal・採用済みWork Receiptからも表示する。
Agent Sessionがない作業も対象にし、Task IDと作業開始時刻で同じ作業をまとめる。
`work_started_at`（受信時にも保持）から`reported_at`までをAI作業期間とし、日をまたぐ場合は両日のActivityとDebriefへ表示する。
Proposalの受信時刻・人の採用時刻・Taskの正式完了時刻は別の事実として保持し、作業期間へ代入しない。
採用前は「採用待ち」と明示し、採用後も同じ作業期間と表示IDを維持する。
旧Receiptで終了・継続を確定できない場合は、元の記録を保持し、無期限の作業中として期間表示しない。
`get_debrief_context`の`task_work`は既存のAI公開範囲と本文のサニタイズを通し、作業ごとの報告を返す。

AI Inboxでは同じTaskの報告を時系列にまとめる。
完了報告の「採用してTaskを完了」は、選択した報告を正式保存してTaskを完了し、プレビューに表示した同じproducer・session・Task versionの過去報告を一緒に履歴化する。
過去報告の本文は消さず、採用した完了報告のIDを残す。
集約対象のversionも採用時に確認し、途中で変わっていれば全体を適用せず再確認する。
通常のAI依頼では完了報告を一度だけ送り、途中報告は長期作業で必要な場合に限る。

`daily-report`はローカル当日を指定してread-onlyの`tasken.get_debrief_context(date)`を使う。
別の日は画面の依頼文、または`get_debrief_context`の`date`で指定する。
日報の書き方はMCP側の一つの`writing_guidance`をPromptとContextで共有し、どちらの入口でも取得時に渡す。

このContextはboundedな当日ActivityとAIへ公開可能なSessionを返し、private pathやraw transcriptを含めない。

保存依頼は`tasken.propose_note`へ`note_type: "report"`と`report_date: "YYYY-MM-DD"`を渡す。

成功時に返るのはNote IDではなくpendingのProposal IDである。

AI Inboxで人が採用した時だけReport Noteが作成され、`properties_json.daily_report = { date: report_date }`が保存される。

Themeを指定しない日報は既存の「個人業務」Themeに保存される。

Report NoteのMarkdownは既存のcanonical Note保存経路で同期される。

## 既存資料の扱い

旧`tasken_debrief`資料と、そのdaily / weeklyのreaderは既存Noteを開くために残す。

新しいDebriefは固定フォームやWeeklyフォームを表示・保存しない。

日報の価値は入力欄を埋めた件数ではなく、後から作業の事実と自分の回答を読み直せることにある。
