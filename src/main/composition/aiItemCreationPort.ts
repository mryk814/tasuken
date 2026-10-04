import type { ApplicationCommandService } from "../services/applicationCommandService.ts";
import type { AiItemCreationPort } from "../core/public.ts";
import type {
  CanonicalNoteCommitCompanion,
  DocumentSaveRequest,
} from "../../shared/types/workspace.ts";

interface CanonicalNoteWriter {
  recoverCanonicalMarkdownReceipts(): void;
  saveCanonicalNote(
    request: DocumentSaveRequest,
    companion?: CanonicalNoteCommitCompanion,
  ): Record<string, unknown>;
}

export function createAiItemCreationPort(
  commands: ApplicationCommandService,
  workspace: CanonicalNoteWriter,
  onCommitted?: () => void,
): AiItemCreationPort {
  return {
    executeTask(command, event) {
      const receipt = commands.executeAiTaskCreation(command, event);
      onCommitted?.();
      return receipt;
    },
    recoverNotes() {
      workspace.recoverCanonicalMarkdownReceipts();
    },
    saveNote(note, companion) {
      const saved = workspace.saveCanonicalNote(
        {
          entity: note,
          snapshot: {
            owner: { recordType: "note", entityId: note.id },
            body: String(note.body_markdown || ""),
            expectedRevision: 0,
          },
          options: { source: "ai", reason: "ai_item_created" },
        },
        companion,
      );
      onCommitted?.();
      return saved;
    },
  };
}
