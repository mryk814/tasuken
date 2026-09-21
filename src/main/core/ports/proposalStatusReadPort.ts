/**
 * 受領したProposalの現在地を読む境界。
 *
 * 採否は人が行うため、AIは再送せずにここで状態を確認する。
 * この境界は書き込みをせず、正本の読み取りだけを行う。
 */

export type ProposalStatusValue =
  "pending" | "accepted" | "rejected" | "partially_accepted" | "quarantined";

export interface ProposalStatusProposalRecord {
  id: string;
  /** 未知の状態は`null`。既知の値へ読み替えて確定状態を偽らない。 */
  status: ProposalStatusValue | null;
  payload_type: string;
  source_app: string;
  received_at: string;
  request: Record<string, unknown>;
}

export interface ProposalStatusCreatedEntity {
  type: string;
  id: string;
  title: string | null;
}

export interface ProposalStatusSyncState {
  enabled: boolean;
  /** 最後に同期処理が成功した時刻。未同期・未有効はnull。 */
  lastSyncedAt: string | null;
  /** 直近の同期が失敗しているか。error本文は返さない。 */
  failed: boolean;
  /** このnodeがまだ公開していない差分の数。同期が無効なnodeは0。 */
  pendingLocalChanges: number;
}

export interface ProposalStatusSnapshot {
  node: { workspaceId: string; deviceId: string };
  /** このnodeが観測できる同期の状態。相手端末の受信状態は含まない。 */
  sync: ProposalStatusSyncState;
  proposal: ProposalStatusProposalRecord | null;
  /** 編集Proposalの`request.target`が指すEntity。採用済みのときだけ解決する。 */
  targetEntity: ProposalStatusCreatedEntity | null;
  /** 採用時のbacklinkから見つかった、このProposalが作ったEntity。 */
  createdEntities: ProposalStatusCreatedEntity[];
}

export interface ProposalStatusReadPort {
  readProposalStatus(proposalId: string): ProposalStatusSnapshot;
}
