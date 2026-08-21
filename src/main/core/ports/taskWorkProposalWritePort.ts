export interface TaskWorkProposalRecord {
  id: string;
  source: "mcp";
  source_app: string;
  payload_type: "task_work";
  payload: Record<string, unknown>;
  request: Record<string, unknown>;
  status: "pending";
  received_at: string;
  version?: number;
}

export interface TaskWorkProposalTransaction {
  get(id: string): TaskWorkProposalRecord | null;
  save(proposal: TaskWorkProposalRecord): TaskWorkProposalRecord;
}

/** Owns the atomic canonical ai_proposal write boundary. */
export interface TaskWorkProposalWritePort {
  runTransaction<T>(callback: (transaction: TaskWorkProposalTransaction) => T): T;
}
