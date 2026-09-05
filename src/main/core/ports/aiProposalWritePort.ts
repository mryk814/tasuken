export interface AiProposalRecord {
  id: string;
  source: "mcp";
  source_app: string;
  payload_type: string;
  payload: Record<string, unknown>;
  request: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected" | "partially_accepted" | "quarantined";
  received_at: string;
  version?: number;
  deleted_at?: string | null;
}

export interface AiProposalTransaction {
  get(id: string): AiProposalRecord | null;
  getEntity(type: string, id: string): Record<string, unknown> | null;
  save(proposal: AiProposalRecord): AiProposalRecord;
}

/** Owns the atomic canonical ai_proposal write boundary. */
export interface AiProposalWritePort {
  runTransaction<T>(callback: (transaction: AiProposalTransaction) => T): T;
}
