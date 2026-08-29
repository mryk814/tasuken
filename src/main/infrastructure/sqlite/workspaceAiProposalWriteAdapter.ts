import type {
  AiProposalRecord,
  AiProposalTransaction,
  AiProposalWritePort,
} from "../../core/public.ts";

interface CanonicalProposalPersistence {
  runTransaction<T>(
    callback: (repository: {
      get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
      save(
        type: string,
        entity: Record<string, unknown>,
        options?: unknown,
      ): Record<string, unknown>;
    }) => T,
  ): T;
}

function asProposal(value: Record<string, unknown> | null): AiProposalRecord | null {
  return value as AiProposalRecord | null;
}

export class WorkspaceAiProposalWriteAdapter implements AiProposalWritePort {
  constructor(
    private readonly persistence: CanonicalProposalPersistence,
    private readonly onCommitted?: (proposals: AiProposalRecord[]) => void,
  ) {}

  runTransaction<T>(callback: (transaction: AiProposalTransaction) => T): T {
    const committed: AiProposalRecord[] = [];
    const result = this.persistence.runTransaction((repository) =>
      callback({
        get: (id) => asProposal(repository.get("ai_proposal", id, true)),
        getEntity: (type, id) => repository.get(type, id, false),
        save: (proposal) => {
          const saved = asProposal(
            repository.save("ai_proposal", { ...proposal }, { source: "mcp" }),
          )!;
          committed.push(saved);
          return saved;
        },
      }),
    );
    if (committed.length && this.onCommitted) {
      try {
        this.onCommitted(committed);
      } catch {
        // Canonical write is already committed; a closed renderer must not roll it back.
      }
    }
    return result;
  }
}
