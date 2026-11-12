import type {
  KnowledgeReadEntityType,
  KnowledgeReadPort,
  KnowledgeReadRecord,
} from "../../core/public.ts";

export interface KnowledgeWorkspacePersistence {
  list(type: KnowledgeReadEntityType, includeDeleted?: boolean): KnowledgeReadRecord[];
}

export class WorkspaceKnowledgeReadAdapter implements KnowledgeReadPort {
  constructor(private readonly persistence: KnowledgeWorkspacePersistence) {}

  list(type: KnowledgeReadEntityType, includeArchived: boolean) {
    return this.persistence.list(type, includeArchived);
  }
}
