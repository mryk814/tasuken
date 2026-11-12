import { randomUUID } from "node:crypto";

import { AiTaskChangeService } from "../core/public.ts";
import type { ApplicationCommandService } from "../services/applicationCommandService.ts";
import { TaskCapabilityService, type WorkspaceTaskPersistence } from "../modules/task/public.ts";
import { TASK_CONTRACT_SCHEMA_VERSION } from "../../shared/contracts/task/public.ts";
import type { CommandReceipt } from "../../shared/applicationCommand.ts";
import type { Entity } from "../../shared/types/workspace.ts";

type Persistence = WorkspaceTaskPersistence & {
  readonly workspaceId: string;
  listChangeEventsByCommandId(commandId: string): Entity[];
  changeEventCommandIdsWithPrefix(prefix: string): Set<string>;
  listChangeEventsForEntity(recordType: string, entityId: string): Entity[];
  hasSyncConflict(entityType: string, entityId: string): boolean;
};

/**
 * AIの直接変更（#703）を、Desktopと同じTask serviceとApplication Commandへ繋ぐ。
 * Desktopと、配備で明示したNAS replica（#688）が使う。
 * `isEnabled`はDesktopでは本人の設定（NASは配備で許した時点で常に真）、`onCommitted`は画面の更新。
 */
export function createAiTaskChangeService(
  persistence: Persistence,
  commands: ApplicationCommandService,
  isEnabled: () => boolean,
  onCommitted?: (receipt: CommandReceipt) => void,
): AiTaskChangeService {
  const execute = (annotation: Record<string, unknown>) => (envelope: unknown) => {
    const receipt = commands.executeAiTaskChange(envelope, annotation);
    onCommitted?.(receipt);
    return receipt;
  };
  const reader = new TaskCapabilityService(persistence, () => {
    throw new Error("読み取り専用です。");
  });
  return new AiTaskChangeService(
    persistence,
    {
      executeTaskCommand: (command, annotation) =>
        new TaskCapabilityService(persistence, execute(annotation)).executeCommand(command, {
          immutableRequest: true,
        }),
      restoreTask: (input, annotation) => {
        execute(annotation)({
          commandId: input.commandId,
          name: "RestoreTask",
          actor: input.actor,
          source: input.source,
          issuedAt: input.issuedAt,
          payload: { taskId: input.taskId },
          expectedVersions: [{ type: "task", id: input.taskId, version: input.expectedVersion }],
        });
      },
      readTask: (taskId) => {
        const result = reader.executeQuery({
          schemaVersion: TASK_CONTRACT_SCHEMA_VERSION,
          query_id: randomUUID(),
          name: "GetTask",
          parameters: { task_id: taskId, include_deleted: true },
        });
        return result.ok && result.value.name === "GetTask" ? result.value.task : null;
      },
    },
    { isEnabled },
  );
}
