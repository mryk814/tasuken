# AI作業ログの明示取込（#629）

Debriefで日・週の観測区間を並べ、ClientとRepositoryで絞り込む。区間を選ぶと依頼、最後の回答、構造化された残件、元Session IDを確認できる。狭幅では日表示と詳細dialog、Android Todayでは縦の一覧と詳細sheetを使う。

開始から終了・最終観測までの壁時計区間を表示する。実働時間、消費時間、生産性として合計しない。取込履歴は`observation.mode = history`を持ち、現在進行中の活動には変換しない。終了を確認できないexportは`unknown`、中断した回答は`interrupted`になる。残件を回答本文から推測して作らない。

## 取込と保存

1. Debriefの取込から、本人が選んだ2MB以下のJSONを読む。
2. 版、時刻、native IDを検証し、依頼と回答の本文だけをpreviewする。関連Repositoryを任意に選ぶ。
3. 「確認へ進む」で既存Coreへ`capture` Proposalを送る。原文ファイルは保存しない。
4. 既存のProposalDetailで本人が採用・拒否する。採用時だけSessionとprovenance Referenceを作る。

既存のSession/Activity/Proposalを正本とする。別DB、raw log棚、添付コピー、外部送信を追加していない。parserはallowlistで本文を拾い、既存`safeReceiptText`で秘密情報の既知表記、hidden reasoningの明示ブロック、URL認証・query、ローカルパスを伏せる。自由文の任意の秘密を自動検出できるとは保証しないため、採用前の本文確認を残す。

## 版付きadapter contract

共通envelopeは次の形。`client_version`は選択したclientの版を記録するための値で、未知のnative形式を許可するスイッチではない。fixtureの版名はsyntheticである。

```json
{
  "schema": "tasken-ai-work-log/1",
  "adapter": "codex-hooks/1",
  "client_version": "synthetic-preview",
  "source_session": "synthetic-native-thread",
  "started_at": "2026-10-03T09:00:00+09:00",
  "observed_until": "2026-10-03T10:00:00+09:00",
  "coverage": "partial",
  "payload": []
}
```

`source_session`はopaque IDで、ファイルの場所を入れない。`started_at`は再開世代の開始時刻。時刻付きの選択範囲を`observed_until`で閉じる。request/responseは各200件、native/hook配列は2000件まで。再開をまたぐhook配列、SessionEnd以後の発言、同じnative event ID/seqの内容衝突、未知のadapter版を拒否する。

| Adapter               | 確認した入力と保持する内容                                                                                 | 境界                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-hooks/1`       | 時刻を付けて選択した公式hook payload配列。`UserPromptSubmit.prompt`と`Stop.last_assistant_message`         | 内部session storeを読まない。`Stop`はturnの回答で、完了は明示SessionEndで判断する                                                              |
| `claude-hooks/1`      | 同じ選択配列のpromptと最終assistant本文                                                                    | stream-jsonをこのadapterで混ぜない。transcriptのパスを開かない                                                                                 |
| `copilot-cli-hooks/1` | CLI camelCase/epochと互換PascalCase/ISOの時刻付きprompt                                                    | `agentStop`のtranscriptPathから本文を読まない。SDK/VS Code独自形式は別adapterが必要                                                            |
| `opencode-export/1`   | V1の`{info, messages:[{info,parts}]}`からuser/assistantの非synthetic・非ignored text part                  | V2 exportは未対応。updated/assistant完了からsession終了を推測しない                                                                            |
| `deepseek-native/1`   | format version 4のheaderと選択events。native seq/timeを持つhuman `user/message`と`assistant/message`のtext | `turn/end`はsession終了ではない。reasoning、stream、tool、injected/system、添付を拾わない。native surface全体の再構築やZIPの自動展開は行わない |

この縦スライスは、確認済みの形式を共通envelopeに包んだ選択済みJSONを扱う。個人の過去履歴を走査するconverterや常時hook導入は含まない。`fixtures/agent-work-logs/`に5件のsynthetic例を置いた。

公式根拠（2026-10-03確認）: [Codex Hooks](https://learn.chatgpt.com/docs/hooks)、[Claude Code Hooks](https://code.claude.com/docs/en/hooks)、[Copilot Hooks](https://docs.github.com/en/copilot/reference/hooks-reference)、[OpenCode export実装](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/export.ts)、[DeepSeek Session型](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts)、[DeepSeek永続化](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md)。native形式の変更時はadapter版を増やし、fixtureと契約検証を追加する。

## 同一会話の再開とreplay

従来capture IDは`source_app + source_session`だけから導出され、採用済み会話を再開したcollectorの新しい送信keyと衝突した。capture IDに正規化した開始時刻を加え、再開世代を分ける。元session IDは保持する。

既存idempotency keyの再送は、保存済みProposalに記録したSession IDを返す。旧方式で採用済みの同じ開始区間には新IDで重複を作らず、競合として返す。`start`/`finish`の従来IDは変えない。同じkeyに異なる内容を送ると`IDEMPOTENCY_CONFLICT`、採用済み世代へ別keyで書き換えると`SESSION_CONFLICT`になる。

表示の重複除去もCanonical Session IDを使う。元IDが同じ再開世代や別clientを畳まない。日付にまたがるSessionは各日の範囲に現れ、Core日付queryも同じ重なりを扱う。

## Androidと既存作業との接点

既存`GET /v1/today`に`includeAgentSessions=true`を明示したときだけ、採用済みSessionの詳細を最大20件追加する。`mobile:read`と既存`mobile:context-read`の両scopeを要求する。フラグなしの応答形は保持し、古い厳密JSON consumerへ新fieldを送らない。本文は既存Coreのvisibility projectionを通す。SessionをAndroid DBへ複製せず、取得失敗はTodayタスクを残して再読込を示す。

PCの暦とCoreの日付選択はPCのlocal timezone、Androidの時刻表示は端末のlocal timezoneに従う。端末とPCの日付境界が違う環境での統一timezone設定は追加していない。

ボード/AI作成/#628印には触れていない。合流時の接点は`ResearchDeskApi`/Preload/IPC、Mobile Today contract、`ApplicationCommandService`、Core composition、Debriefである。専用branchでの確認が必要。CI定義は変更していない。architectureのaggregate API利用4件は#629の期限付きdebtとして記録し、main windowの新capabilityのみ契約inventoryへ加えた。

## 検証と隔離試用

`tests/agent-work-log-core-e2e.test.mjs`は実SQLite/Core HTTP/collector/採用を使い、初回・重複・再送・同ID再開・未終了・中断・順不同・再起動・旧ID競合を検証する。`tests/agent-work-log-import.test.mjs`は5adapter、redaction、unknown版、native衝突を検証する。Mobile golden fixtureはTypeScriptとKotlinで共有する。

```powershell
rtk npm run typecheck
rtk npm run build
rtk node scripts/run-electron-node.mjs --test tests/agent-work-log-import.test.mjs tests/agent-work-log-core-e2e.test.mjs tests/agent-session-contract.test.mjs tests/agent-session-hook-collector.test.mjs tests/agent-session-projection.test.mjs tests/tasken-debrief.test.mjs
rtk node scripts/agent-work-log-electron-smoke.mjs
```

Electron smokeは使い捨てuserDataで実ファイル選択・preview・採用・filter・390px dialog・Enter/Escapeのfocus復帰・reduced motion・不正ファイル・再起動を検証し、`output/playwright/agent-work-logs/`へfixture画面を保存する。Androidは`AgentSessionTimelineUiTest`でTodayからの詳細と取得失敗の再読込を検証する。実機確認は含めない。

通常profileを使わず試すには、新しく作った専用userDataを`TASKEN_USER_DATA_DIR`と`TASKEN_DEV_USER_DATA_DIR`に指定し、そのworktreeのElectronを起動する。閉じるだけで通常版へ戻る。この変更はDB schema migrationを追加しておらず、採用を取り消すためにDBを書き換える復旧scriptも作らない。
