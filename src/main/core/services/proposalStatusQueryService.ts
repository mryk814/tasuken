import {
  proposalStatusRequestSchema,
  proposalStatusResponseSchema,
  type ProposalStatusRequest,
  type ProposalStatusResponse,
} from "../../../shared/contracts/task/public.ts";
import type {
  ProposalStatusCreatedEntity,
  ProposalStatusReadPort,
} from "../ports/proposalStatusReadPort.ts";

const ADOPTED_STATUSES = new Set(["accepted", "partially_accepted"]);

/**
 * 受領したProposalの現在地を返す。
 *
 * 未採用のProposalに対してEntityを返さない。`request.target`は編集Proposalの
 * 送信時点で保存されているため、採否を確認せずに返すと「採用済み」と誤解させる。
 */
export class ProposalStatusQueryService {
  constructor(private readonly port: ProposalStatusReadPort) {}

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
    });
  }
}
