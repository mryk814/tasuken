import { DEFAULT_AI_VISIBILITY, normalizeAiVisibility } from "../../../shared/aiMetadata.mjs";
import type {
  KnowledgeReadEntityType,
  KnowledgeReadPort,
  KnowledgeReadRecord,
} from "../../core/public.ts";

export interface KnowledgeWorkspacePersistence {
  list(type: KnowledgeReadEntityType, includeDeleted?: boolean): KnowledgeReadRecord[];
  readPreference(key: "aiVisibilityDefault"): unknown;
}

export class WorkspaceKnowledgeReadAdapter implements KnowledgeReadPort {
  constructor(private readonly persistence: KnowledgeWorkspacePersistence) {}

  list(type: KnowledgeReadEntityType, includeArchived: boolean) {
    return this.persistence.list(type, includeArchived);
  }

  workspaceAiVisibilityDefault() {
    return normalizeAiVisibility(this.persistence.readPreference("aiVisibilityDefault"))
      || [...DEFAULT_AI_VISIBILITY];
  }
}
