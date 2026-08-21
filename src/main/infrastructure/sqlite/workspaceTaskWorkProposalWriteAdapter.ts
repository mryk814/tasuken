import type {
  TaskWorkProposalRecord,
  TaskWorkProposalTransaction,
  TaskWorkProposalWritePort,
} from "../../core/ports/taskWorkProposalWritePort.ts";

interface CanonicalProposalPersistence {
  runTransaction<T>(callback: (repository: {
    get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
    save(type: string, entity: Record<string, unknown>, options?: unknown): Record<string, unknown>;
  }) => T): T;
}

function asProposal(value: Record<string, unknown> | null): TaskWorkProposalRecord | null {
  return value as TaskWorkProposalRecord | null;
}

export class WorkspaceTaskWorkProposalWriteAdapter implements TaskWorkProposalWritePort {
  constructor(private readonly persistence: CanonicalProposalPersistence) {}

  runTransaction<T>(callback: (transaction: TaskWorkProposalTransaction) => T): T {
    return this.persistence.runTransaction((repository) => callback({
      get: (id) => asProposal(repository.get("ai_proposal", id, true)),
      save: (proposal) => asProposal(repository.save("ai_proposal", { ...proposal }, { source: "mcp" }))!,
    }));
  }
}
