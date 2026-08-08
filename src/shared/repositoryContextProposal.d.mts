export interface RepositoryContextProposalCandidate {
  entry: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  duplicate?: Record<string, unknown>;
  action: "create" | "merge" | "ignore";
  issues: string[];
}

export function buildRepositoryContextProposalCandidate(
  input: Record<string, unknown>,
  contexts?: Record<string, unknown>[],
): RepositoryContextProposalCandidate;

export function buildRepositoryContextProposalOperations(
  candidates: RepositoryContextProposalCandidate[],
  contexts: Record<string, unknown>[],
  idFactory?: () => string,
): Array<{ action: "save"; type: "repository_context"; entity: Record<string, unknown>; options: { source: string } }>;
