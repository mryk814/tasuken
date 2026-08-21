import type {
  AiProposalRecord,
  AiProposalTransaction,
  AiProposalWritePort,
} from "../../core/public.ts";

interface CanonicalProposalPersistence {
  runTransaction<T>(callback: (repository: {
    get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
    save(type: string, entity: Record<string, unknown>, options?: unknown): Record<string, unknown>;
  }) => T): T;
}

function asProposal(value: Record<string, unknown> | null): AiProposalRecord | null {
  return value as AiProposalRecord | null;
}

export class WorkspaceAiProposalWriteAdapter implements AiProposalWritePort {
  constructor(private readonly persistence: CanonicalProposalPersistence) {}

  runTransaction<T>(callback: (transaction: AiProposalTransaction) => T): T {
    return this.persistence.runTransaction((repository) => callback({
      get: (id) => asProposal(repository.get("ai_proposal", id, true)),
      save: (proposal) => asProposal(repository.save("ai_proposal", { ...proposal }, { source: "mcp" }))!,
    }));
  }
}
