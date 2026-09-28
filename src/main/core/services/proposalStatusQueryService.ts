import {
  listProposalsRequestSchema,
  listProposalsResponseSchema,
  proposalStatusRequestSchema,
  proposalStatusResponseSchema,
  type ListProposalsRequest,
  type ListProposalsResponse,
  type ProposalStatusRequest,
  type ProposalStatusResponse,
} from "../../../shared/contracts/task/public.ts";
import type {
  ProposalStatusCreatedEntity,
  ProposalStatusReadPort,
} from "../ports/proposalStatusReadPort.ts";

const ADOPTED_STATUSES = new Set(["accepted", "partially_accepted"]);
const DEFAULT_LIST_LIMIT = 20;

/**
 * 受領したProposalの現在地を返す。
 *
 * 未採用のProposalに対してEntityを返さない。`request.target`は編集Proposalの
 * 送信時点で保存されているため、採否を確認せずに返すと「採用済み」と誤解させる。
 */
export class ProposalStatusQueryService {
  constructor(private readonly port: ProposalStatusReadPort) {}

  /**
   * 送信元の識別で絞ったProposalの一覧。payload本文は返さず、詳細は受領IDで個別に読む。
   * 絞り込みは任意で、指定しない場合はこのnodeが持つ全Proposalを新しい順に返す。
   */
  list(input: ListProposalsRequest): ListProposalsResponse {
    const request = listProposalsRequestSchema.parse(input);
    const limit = request.limit ?? DEFAULT_LIST_LIMIT;
    const matched = this.port
      .listProposals()
      .filter(
        (proposal) => !request.source_session || proposal.source_session === request.source_session,
      )
      .filter((proposal) => !request.source_app || proposal.source_app === request.source_app)
      .filter((proposal) => !request.caller || proposal.caller === request.caller)
      .filter((proposal) => !request.status || proposal.status === request.status);
    const proposals = matched.slice(0, limit).map((proposal) => ({
      proposal_id: proposal.id,
      status: proposal.status,
      awaiting_review: proposal.status === "pending",
      payload_type: proposal.payload_type,
      tool: proposal.tool,
      source_app: proposal.source_app,
      caller: proposal.caller,
      source_session: proposal.source_session,
      received_at: proposal.received_at,
      task_id: proposal.task_id,
    }));
    return listProposalsResponseSchema.parse({
      schema: "tasken-proposal-list/v1",
      proposals,
      result_meta: {
        returned_count: proposals.length,
        matched_count: matched.length,
        truncated: matched.length > proposals.length,
      },
      view: {
        canonical_node: "this_node",
        delivery_confirmed: false,
        note: "この一覧はこのnodeが受け取ったProposalだけです。別の端末へ送ったProposalと、そちらでの採否は含みません。",
      },
      next_tools: [
        {
          tool: "tasken.get_proposal_status",
          description: "受領IDから採否と、採用で生まれたEntityを確認する。",
        },
      ],
      read_only: true,
    });
  }

  execute(input: ProposalStatusRequest): ProposalStatusResponse {
    const request = proposalStatusRequestSchema.parse(input);
    const snapshot = this.port.readProposalStatus(request.proposal_id);
    const proposal = snapshot.proposal;
    const status = proposal ? proposal.status : null;
    const adopted = Boolean(status && ADOPTED_STATUSES.has(status));
    const targetEntity = adopted ? snapshot.targetEntity : null;
    const createdEntities: ProposalStatusCreatedEntity[] = !adopted
      ? []
      : targetEntity
        ? [targetEntity]
        : snapshot.createdEntities;

    return proposalStatusResponseSchema.parse({
      schema: "tasken-proposal-status/v1",
      proposal_id: request.proposal_id,
      found: Boolean(proposal),
      status,
      awaiting_review: status === "pending",
      payload_type: proposal ? proposal.payload_type : null,
      source_app: proposal ? proposal.source_app : null,
      received_at: proposal ? proposal.received_at : null,
      created_entities: createdEntities,
      resolved_by: targetEntity
        ? "proposal_target"
        : createdEntities.length
          ? "created_backlink"
          : "none",
      view: {
        canonical_node: "this_node",
        workspace_id: snapshot.node.workspaceId,
        device_id: snapshot.node.deviceId,
        delivery_confirmed: false,
        note: "この応答はこのnodeが持つ正本の状態です。他の端末への配送と、そちらでの採否は確認していません。",
      },
      sync: {
        enabled: snapshot.sync.enabled,
        last_synced_at: snapshot.sync.lastSyncedAt,
        last_sync_failed: snapshot.sync.failed,
        pending_local_changes: snapshot.sync.pendingLocalChanges,
        note: "このnodeが最後に同期処理へ成功した時刻です。相手端末がまだ公開していない変更は観測できないため、差分が無いことは最新を意味しません。",
      },
    });
  }
}
