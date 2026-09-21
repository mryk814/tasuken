# MCP・NAS・ChatGPT連携の体験改善計画

状態: 計画案。実装・本番配置は未実施。

## 目的

**AIとの会話や作業の収穫を、気軽にTaskenへ残せるようにする。**

- AIが投入先や分類に迷わず、許可された範囲で発見・文章・実行案を送れる。
- 投稿が増えても、人の採用作業や対応待ち件数を不用意に増やさない。
- PC停止中でもNASが受け取り、Desktop再開後に失われず・重複せず届く。
- AIと人が「受信」「同期」「表示」「正式採用」を区別できる。

## 現状と前提

### 確認済みの実装

- `tasken.propose_feed_post` は投稿を即時表示する読み物Proposal。対応待ち件数を増やさない。添付記事の正式Note化は別途採用する。
- `tasken.propose_note` / `tasken.propose_task` は人の採用まで正式Entityを作成しない。
- Feedの説明と、MCP全体instructions・共通成功文の「Previewして採用」が一致していない。
- 再送にはidempotency keyが使えるが、省略時は新しいキーになる。`recent_post_ids` は現在のhandlerで重複排除に使われない。
- MCP応答の `queued / duplicate` は受付結果であり、採否やDesktopへの配送確認ではない。Proposalの採否照会toolはない。
- リポジトリのNAS構成は `TASKEN_MCP_READ_ONLY=1`。Headless Core自身のwrite gateは未実装。
- NASとDesktopは別のローカルSQLiteを持ち、共有フォルダで差分を交換する。ライブSQLiteを共有しない。
- 未採用のNote画像は同期されず、Headlessには画像Proposalのstage機能がない。

### 実環境について

- 利用者から「ChatGPTから接続できるようになった」と報告済み。これを現在の利用状況として扱う。
- 過去の「ChatGPT接続保留」の観測記録を現在の障害として扱わない。
- 接続先node、稼働imageの版、公開tools、現在の同期・復帰状態は今回未確認。コードの状態と配置済み機能を同一視しない。

## 設計方針

### 送る内容と置き場

| 内容                         | 既存の入口                    | 人に求めること           |
| ---------------------------- | ----------------------------- | ------------------------ |
| 気づき・参考情報・短い学び   | `propose_feed_post`           | 読む。採用を強制しない   |
| 残しておきたいまとまった文章 | `propose_note` / Feed添付記事 | 正式Noteにする場合に採用 |
| 次にやること                 | `propose_task`                | 確認して採用             |
| 既存Taskの成果や質問         | 既存の報告・質問経路          | 既存の確認・回答操作     |

新しい汎用Inbox、独立した投稿DB、万能capture toolは最初から追加しない。既存の入口で実際に不足する場合だけ再検討する。

### 常駐の役割

- **NAS:** 同期済みContextの提供、許可された投稿・提案の耐久受付。
- **外部AI:** 対話、調査、作業、成果の送信。
- **Desktop:** 閲覧、編集、正式採用。

受付の常駐とAI実行の常駐は分離する。NASへの推論runtime、自動巡回、CLI自動起動は本計画に含めない。「AIに聞く」だけでAIが自動起動するとは案内しない。

### 許可と安全境界

- read-onlyを既定として維持し、明示的に有効化した接続にだけ投稿・提案受付を許す。
- AIの自発投稿は利用者が許可した対象・用途の範囲内。会話全文の自動転載、秘密情報の送信、無関係な話題の収集は行わない。
- 正式Entityの変更・採用・Task完了を外部AIへ開放しない。既存のAI Ready Task開始例外も、NASの投稿権限とは分ける。
- MCPでtoolを隠すだけでなく、Core側でも拒否する。
- NAS停止時もDesktop・Androidのローカル利用を維持する。NAS replicaをバックアップの代替としない。

## Phase 0 — 現在地と往復経路を固定する

状態: ローカル調査は完了（2026-09-21）。実環境（NAS・ChatGPT）の確認は未実施。

### 調査結果（ローカル）

`workspaceEntityTypes` は `ai_proposal` を含み、Proposalの増減は変更差分として同期へ入る。受信側の `insertImported` は差分を再公開しないため、replicaが受信した内容がそのまま往復で増えることはない。

`tests/tasken-headless-core.test.mjs` の「Headless replicaが受けたProposalはDesktopへ届き、採否はreplicaへ戻る」で次を確認した。

- replicaのCoreへ届いた投稿は、replicaのSQLiteに `pending` として保存される。
- replicaが公開した差分をDesktop役が取り込み、本文を含む同じProposalを `pending` で保持する。
- Desktop役が採用へ変えた状態は、新しい差分としてreplicaへ戻る。
- どちらの端末でも競合は発生せず、replicaは受信内容を再公開しない（`pending=0`）。

つまり**Proposalの配送に新しいtransport・tool・schemaは要らない。** 残りは権限付与と、同じ`idempotency_key`を複数端末へ送った場合の扱いである。

### 分かった制約

- MCP bridgeの `TASKEN_MCP_READ_ONLY=1` を外すと、Headless Coreはreplicaからの書き込みをそのまま受理する。Core側のgateは無い。
- 同じ `idempotency_key` をDesktopとNASの両方へ送ると、同じProposal IDが両nodeで別revisionとして生まれ、競合になりうる。1つの要求は1つのnodeへ送る運用が必要。
- 端末ごとの `deviceSequence` は1から連番である必要がある。NAS役の公開は1件目から連番になる。

### 作業

1. ローカルコードから、投稿・採用・共有フォルダ同期・冪等性記録・Feed表示の経路を整理する。
2. Proposalと採否の同期、端末間の重複、削除・復元・競合について、既存テストで保証される範囲と不足を分ける。
3. 実環境確認時は、ChatGPTが接続するnode、配置版、read/write capabilities、同期状態を読み取りで確認する。
4. 新しい観測は `deploy/synology/DEPLOYED.md` へ追記する。過去の観測は改変しない。

### 完了条件

- 「接続できる」「読める」「投稿を受け付ける」「Desktopへ届く」の現在地が別々に分かる。
- ProposalをNASからDesktopへ届け、採否を戻すために必要な変更が特定されている。
- 実環境を確認できない場合も、ローカル調査とPhase 1は進められる。現在の稼働成功は宣言しない。

## Phase 1 — AIが迷わず送れる説明と応答にする

状態: 実装済み（2026-09-21）。NAS・実環境の変更は含まない。

### 作業

1. MCP全体instructions、tool説明、共通成功文を整合させる。
   - Feed: 読み物として表示される。正式Note化とは区別。
   - Note / Task: 採用待ち。
   - duplicate: 新規作成ではなく、既存の受領IDを返す。
2. ChatGPT向けの最小利用例を外部AI連携ガイドへ追加する。
   - 気づき→Feed、文章→Note、実行案→Task。
   - Themeが不明でも任意項目の入力を強制しない。
   - 雑感の投稿にAI Ready探索やTask作成を前提としない。
3. 利用者が選べる投稿方針を依頼文として用意する。
   - 有用な発見・比較・未解決の問いを短く残す。
   - 毎ターンの要約、同じ話の再投稿、Task報告の丸写しはしない。
   - 出典、利用者の発言、AIの推測を区別する。
   - 会話URLは取得可能な場合のみ添える。推測で生成しない。
4. 同一要求の再送は同じkey・内容を使うと明記する。`recent_post_ids` に自動重複排除の保証を持たせない。

### 完了条件

- Feed送信成功に対し、AIが「採用しないと読めない」と案内しない。
- Feed単独投稿が対応待ち件数を増やさないことを関連テストで確認する。
- 新規toolsやschemaを増やさず、既存toolsで短い会話例が成立する。

## Phase 2 — NASに限定的なテキスト受付を設ける

Phase 0の同期調査結果を設計ゲートとする。read-only設定の単純解除では実施しない。

状態: ローカル実装済み（2026-09-21）。実Synologyへの配置は未実施。

実装内容: Headless Coreに `--write-mode`（`read-only` 既定 / `proposals`）を追加。既定は書き込みcapabilityを公開せず、`proposals` ではテキストのFeed投稿・Note案・Task案だけを受け付け、Core自身が種類単位で拒否する（`WRITE_NOT_ALLOWED`、HTTP 403）。Desktopは変更しない。`scripts/mcp-doctor.mjs` は `read-only`・`proposals` 配備を正常として診断する。NAS側のcompose・`.env.example` にも `TASKEN_CORE_WRITE_MODE` とtunnel側の `TASKEN_MCP_READ_ONLY` 既定を反映した。

### 作業

1. 読み取り専用／投稿・提案受付の能力を明示する。既存Desktop動作との互換を維持する。
2. MCPとCoreの両境界で権限を強制する。
   - 初期対象: テキストFeed投稿、Note作成案、Task作成案。
   - Task直接開始、既存Entity編集、画像・Artifact、採用操作などは今回の受付対象外。
   - Feed返信・Task報告の受付拡大は、初期往復成立後に既存契約を確認して別段階で判断する。
3. 既存のProposal保存・同期を再利用する。Phase 0の実測で配送は成立しているため、新しいtransport・tool・schemaを追加しない。
4. durable commitの後だけ受信成功を返す。応答喪失後の再送、再起動後の冪等性を保証する。
5. 接続ごとの権限が必要な場合、自己申告の `caller` を認証・認可に使わない。
6. 同じ `idempotency_key` を複数nodeへ送らない運用を明記し、二重作成時は競合として安全に止まることを確認する。

### 完了条件

隔離したDesktop役・NAS役の一時DBと同期フォルダで、以下が成立する。

- Desktop役停止中の投稿・提案受付。
- NAS役再起動後も本文、受領ID、再送判定が保持される。
- Desktop役再開後、一度だけ表示される。
- read-only接続と不許可commandはCore側でも拒否される。
- 採用前に正式Task・Noteが作られない。採用の失敗時には全体がrollbackする。
- 競合、同期中断、削除・復元で既存データを壊さない。

## Phase 3 — 受領・採否・鮮度を確認できるようにする

状態: 作業1・2を実装済み（2026-09-21）。作業3（受領ID応答への同期鮮度、2026-09-21実装済み）と作業4（Settings MCP Bridgeの書き込み範囲表示、2026-09-21実装済み）。実Synologyへの配置は未実施。

### 下調べで分かった制約

1. **Proposalから採用後のEntityへのbacklinkは、Note・Taskには保存されていない。** `artifact`だけが`source_type: "ai_proposal"` / `source_id: <proposal id>`を持つ。canonical NoteのMarkdown公開経路にはmarker（`tasken-note-ai-command-marker/v1`）があるが、通常のNote採用は対象外。したがって「採用後にどのEntityができたか」を今の永続データからは一意に辿れない。
   - 対応案A: 状態照会toolを追加し、`status`と`awaiting_review`だけを返す。Entity locatorは返さない（`created_entities: []`と理由を明示）。schema追加なしで今日実装できる。
   - 対応案B: 採用時に`proposal_id`のbacklinkをEntityへ保存する。Plan自身の条件「永続的に対応を確認できる場合だけ返す」を満たせるが、保存契約の追加と移行の判断が要る。
2. **Coreは自分のnode identityを持っていない。** `workspaceId` / `deviceId`は`WorkspaceDatabase`にあるが、Coreのread portは`list`しか公開していない。どのnodeが答えたかを返すには、portにidentityを足す必要がある。
3. **read-only toolの追加は周辺の数値を動かす。** 公開tool数（46）とcapability数（31）を前提にした既存テスト・文書があるため、追加時はそれらを同時に更新する。

### 作業

1. 受領IDからProposalの状態を読むread-only toolを追加する。
   - 既存statusと対応させ、未取得・拒否・quarantineも曖昧にしない。
   - 採用後のEntity locatorは、永続的に対応を確認できる場合だけ返す（上の制約1の決定に従う）。
   - Feed表示と正式Note採用を別の意味として返す。
2. 受領結果と同期状態は別軸にする。証拠なく「Desktopに届いた」と返さない。
3. Contextに、情報源nodeと観測可能な同期鮮度を添える。
   - 最後のpoll成功時刻と、最後に適用した差分の時刻を混同しない。
   - 差分がないことを「最新」と断定しない。送信元の未公開変更は観測不能とする。
4. 接続状態の表示は既存Settingsへ集約する。必要な情報だけを見せる。
   - AIから参照可能か、投稿可能か、同期状況、復旧操作。
   - 実際の確認ができない状態は「未確認」と示す。

### 完了条件

- AIが再投稿せずに受領・採否を確認できる。
- 採否が別nodeへ未同期の場合、古い状態を現在の確定状態と偽らない。
- NASで受信済み／Desktop反映未確認／正式採用待ちを区別できる。
- UI変更時はdesign-guideに従い、隔離userDataで表示・focus・スクロール・失敗状態を確認する。

### 着手前に決めること

- 制約1の対応案A（locatorを返さない）か案B（`proposal_id`のbacklinkを保存する）か。案Bは保存契約の変更になる。
- **決定（2026-09-21）: 案B。** 採用したEntityからProposalへbacklinkを保存し、状態照会で「どのEntityになったか」を返す。

### backlinkの設計（決定）

1. 保存する形は`artifact`の既存規約に合わせ、Entityへ`source_type: "ai_proposal"`・`source_id: <proposal id>`を付ける。新しい意味語彙を増やさない。
2. **新規作成のときだけ付ける。** 既存値は上書きしない。編集Proposalは対象IDを`proposal.request.target`へ既に保存しているため、backlinkで上書きすると「どのProposalが作ったか」を失う。
3. 状態照会のEntity解決は次の順で行う。
   - `proposal.request.target`があればそれを返す（編集・更新Proposal）。
   - 無ければ`source_type: "ai_proposal"`・`source_id: <proposal id>`を持つEntityを返す（新規作成Proposal）。
   - どちらも無い場合はlocatorを返さず、理由を示す。
4. **Proposal削除で作成済みEntityを消さない。** 採用済みの結果は利用者のデータであり、`artifact`のようなcascade対象にしない。削除されたProposalを指すbacklinkは、参照先が無いものとして扱う。
5. 対象は`proposals`モードで受け付ける`feed_post`（添付Note草稿）・`note_create`・`task`を先行させ、`artifact`は既存規約のまま扱う。
6. 保存契約の追加なので`docs/engineering-contracts.md`のAI連携節と、Note・Taskの採用経路のテストを同時に更新する。

### 実装位置の調査結果（2026-09-21）

- **付与は`applicationCommandService.applyAiProposal`の1箇所で足りる。** candidate loopが既に`const before = this.repository.get(type, id, true)`で新規作成と更新を分けているため、`before`が無いときだけ付与すればNote・Task・Sketch・Knowledgeを一律に扱える。経路ごとの個別実装は不要。→ この方式で実装した。
- **Task提案の採用はrenderer経由。** `payload_type: "items"`は`AiProposalAcceptanceService`ではなく`AiProposalPanel.tsx`が`parseAiImportPayload`で候補を作り`ApplyAiProposal`を送る。経路ごとに付与する設計にするとrenderer変更と画面検証が必要になるため、上記のMain 1箇所方式を採った。
- **`source_type`/`source_id`はActivityへ波及する。** `src/shared/activityEvent.mjs`の`sourceRefsFromEntity`が両フィールドを`source_refs`として拾うため、Note・Taskの変更イベントに`ai_proposal`参照が増える。既存のActivity表示を変えないため、**専用フィールド`accepted_from_proposal_id`を使う**ことにした。`artifact`の既存規約（`source_type`/`source_id`）はそのまま残し、状態照会は両方を辿る。
- `note`・`task`には`source_type`/`source_id`の検証が無く`requiredFields`にも含まれないため、保存自体は追加のschema変更なしで通る。

### 実装結果（2026-09-21）

- 書き込み: `applyAiProposal`が新規作成のcandidateだけへ`accepted_from_proposal_id`を付ける。既存Entityの更新では上書きしない。
- 読み出し: `tasken.get_proposal_status`（read-only、Core capability `proposal_status`）を追加。`pending`/`awaiting_review`、採用で生まれたEntity、`resolved_by`（`proposal_target`/`created_backlink`/`none`）、接続中nodeの`workspace_id`・`device_id`を返す。
- 同期鮮度: 応答の`sync`に`enabled`・`last_synced_at`・`last_sync_failed`・`pending_local_changes`を返す。error本文はローカルパスを含みうるため真偽値へ畳む。同期無効のnodeは件数0とする。「差分が無いことは最新を意味しない」旨を`note`に明記。
- Settings: MCP Bridgeパネルに「AIの書き込み」行を追加し、Coreのcapabilityから導出した書き込み範囲（full / proposals / read-only / partial / 未確認）を表示。判定は`src/shared/contracts/core/capabilityProfiles.mjs`の共有契約で、`doctor:mcp`と同じ結果を返す。
- 編集Proposalは`request.target`から、新規作成ProposalはbacklinkからEntityを解決する。未採用・却下ではEntityを返さない。既知でないstatusは`null`のまま返す。
- `delivery_confirmed`は常に`false`とし、他端末への配送を証拠なく断定しない。
- 検証: `tests/mcp-feed-post.test.mjs`の「受領IDからProposalの採否と作成Entityを確認でき、再送を促さない」と、`tests/application-command.test.mjs`のbacklink assertion、隔離userDataの実ElectronでのSettings表示確認（`artifacts/settings-write-profile/`にスクリーンショット）。全suiteで回帰なしを確認する。

## Phase 4 — 実環境で最初の一往復を確認する

具体的な対象・送信内容・送信先・操作の承認後に実施する。計画作成やローカル実装の承認を、本番配置・投稿・停止の承認として流用しない。

### 事前条件

- 関連するローカルテストが成功している。
- 配置版、バックアップ、復旧手順、更新対象サービスが特定されている。
- 本番停止・NAS再起動を伴う確認は個別に実施タイミングを合意する。

### 実測するjourney

1. PCのTaskenを閉じ、ChatGPTから許可済みのテスト用Feed投稿を送る。
2. 受領IDを取得し、再送して重複しないことを確認する。
3. transport再接続・NAS再起動を経ても受領結果と投稿が保持される。
4. Desktopを開き、投稿が一度だけ見える。対応待ち件数は増えない。
5. NoteまたはTask案を送り、Desktopでプレビューして採用する。
6. 採否が同期され、ChatGPT側から結果を確認できる。
7. NASを利用できない状態でもDesktopのローカル利用が続く。

### 完了条件

配置版・観測日時・実クライアント・各journeyの結果を記録する。コンテナhealthだけで全体成功とせず、未確認の境界を残す。

## 検証と作業単位

- 文書のみ: 差分、参照先、記述と実装の整合確認。起動・package不要。
- Phase 1: MCP説明・Proposal応答・Feed attentionの関連テスト。TypeScript変更時はtypecheck。
- Phase 2–3: 実stdio MCP、Headless、Core権限、共有フォルダ同期を一時DBで通すテスト。保存→停止→再起動→再取得まで含める。
- 関連する既存入口: `tests/mcp-live-proposal-sync.test.mjs`、`tests/mcp-readonly.test.mjs`、`tests/tasken-headless-core.test.mjs`、`tests/ai-collaboration-e2e.test.mjs`。不足する限定権限・二node往復はテストを追加する。
- ビルド経路に影響する変更はbuild、Renderer変更は隔離実画面確認を追加する。merge前は `AGENTS.md` の品質ゲートに従う。
- 原則1フェーズを1つのレビュー可能な変更単位にする。Phase 2は権限境界と配送保証を分割しても、両方の完了前に本番writeを有効化しない。

## 非ゴール

- 新しいサーバー／DB／外部公開経路の導入。
- ChatGPT側での自動実行・定期実行・tool使用を保証すること。
- 正式データの自動採用、AIによるTask完了。
- 画像ProposalのNAS受付、既存データの全面write解禁。
- 投稿数を増やすこと自体の最適化、毎回の確認ダイアログ追加。
- 本計画作成に伴うIssue公開、コミット、実環境変更。

## 参照

- [AI往復の契約](ai-collaboration-e2e.md)
- [外部AI連携](external-ai-integration.md)
- [Feedの契約](feed-surface.md)
- [AI協働の契約](agent-collaboration.md)
- [保存・AI連携の境界](engineering-contracts.md)
- [Headless Core](headless-core.md)
- [Synology運用](synology-headless-node.md)
- [実機の観測記録](../deploy/synology/DEPLOYED.md)
