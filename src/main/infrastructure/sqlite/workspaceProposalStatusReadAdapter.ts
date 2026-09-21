import type {
  ProposalStatusCreatedEntity,
  ProposalStatusProposalRecord,
  ProposalStatusReadPort,
  ProposalStatusSnapshot,
  ProposalStatusSyncState,
  ProposalStatusValue,
} from "../../core/public.ts";

export interface ProposalStatusWorkspacePersistence {
  readonly workspaceId: string;
  readonly deviceId: string;
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Record<string, unknown>[];
  getPreference(key: string): unknown;
  syncPendingCount(): number;
}

/**
 * 採用でProposalから生まれたEntityを持ちうる種別。
 * `artifact`は既存規約の`source_type`/`source_id`、それ以外は`accepted_from_proposal_id`で辿る。
 */
const ADOPTED_ENTITY_TYPES = [
  "note",
  "task",
  "artifact",
  "sketch",
  "knowledge_node",
  "repository_context",
] as const;

const PROPOSAL_STATUSES = new Set<ProposalStatusValue>([
  "pending",
  "accepted",
  "rejected",
  "partially_accepted",
  "quarantined",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createdEntity(
  type: string,
  entity: Record<string, unknown> | null,
): ProposalStatusCreatedEntity | null {
  if (!entity || entity.deleted_at) return null;
  const id = text(entity.id);
  if (!id) return null;
  return { type, id, title: text(entity.title) || null };
}

/** `source_type`/`source_id`の既存規約、または新しいbacklinkで、このProposalが作ったEntityを探す。 */
function referencesProposal(entity: Record<string, unknown>, proposalId: string): boolean {
  if (text(entity.accepted_from_proposal_id) === proposalId) return true;
  return text(entity.source_type) === "ai_proposal" && text(entity.source_id) === proposalId;
}

export class WorkspaceProposalStatusReadAdapter implements ProposalStatusReadPort {
  constructor(private readonly persistence: ProposalStatusWorkspacePersistence) {}

  readProposalStatus(proposalId: string): ProposalStatusSnapshot {
    const node = {
      workspaceId: String(this.persistence.workspaceId || ""),
      deviceId: String(this.persistence.deviceId || ""),
    };
    const sync = this.readSyncState();
    const record = this.persistence.get("ai_proposal", proposalId, true);
    if (!record || record.deleted_at) {
      return { node, sync, proposal: null, targetEntity: null, createdEntities: [] };
    }
    const request = isRecord(record.request) ? record.request : {};
    const target = isRecord(request.target) ? request.target : null;
    const targetType = target ? text(target.type) : "";
    const targetId = target ? text(target.id) : "";
    const rawStatus = text(record.status);
    return {
      node,
      sync,
      proposal: {
        id: text(record.id),
        // 未知の値はnullのまま返し、既知の状態へ読み替えない。
        status: PROPOSAL_STATUSES.has(rawStatus as ProposalStatusValue)
          ? (rawStatus as ProposalStatusValue)
          : null,
        payload_type: text(record.payload_type),
        source_app: text(record.source_app),
        received_at: text(record.received_at),
        request,
      } satisfies ProposalStatusProposalRecord,
      targetEntity:
        targetType && targetId
          ? createdEntity(targetType, this.persistence.get(targetType, targetId, true))
          : null,
      createdEntities: this.findCreatedEntities(proposalId),
    };
  }

  /**
   * このnodeが観測できる同期の状態だけを返す。
   * 同期errorの本文はローカルパスを含みうるため、成否の真偽値へ畳む。
   * 相手端末がまだ公開していない変更は観測できないので、「最新」とは表現しない。
   */
  private readSyncState(): ProposalStatusSyncState {
    const enabled = this.persistence.getPreference("sharedSyncEnabled") === true;
    const lastSyncedAt = text(this.persistence.getPreference("sharedSyncLastAt"));
    const lastError = text(this.persistence.getPreference("sharedSyncLastError"));
    return {
      enabled,
      lastSyncedAt: lastSyncedAt || null,
      failed: Boolean(lastError),
      // 同期が無効なnodeは差分を公開しないため、未公開件数は0として扱う。
      pendingLocalChanges: enabled
        ? Math.max(0, Number(this.persistence.syncPendingCount()) || 0)
        : 0,
    };
  }

  private findCreatedEntities(proposalId: string): ProposalStatusCreatedEntity[] {
    const found: ProposalStatusCreatedEntity[] = [];
    for (const type of ADOPTED_ENTITY_TYPES) {
      for (const entity of this.persistence.list(type, true)) {
        if (!referencesProposal(entity, proposalId)) continue;
        const created = createdEntity(type, entity);
        if (created) found.push(created);
      }
    }
    return found;
  }
}
