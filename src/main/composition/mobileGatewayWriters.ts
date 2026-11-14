import type { FeedWriterPort } from "./mobileFeedActionPort.ts";
import type { RoutineWriterPort } from "./mobileRoutinePort.ts";
import type { WorkLogWriterPort } from "./mobileWorkLogPort.ts";

/**
 * Mobile Gatewayが通常のCoreの口を通らずに書く3つの口（WorkLog・Feedの反応と返信・続けること）。
 * DesktopもNASのheadless nodeも同じ保存（WorkspaceService / repository）を使う。
 * 違うのは保存後の通知だけで、Desktopは画面の更新を`notify`で差し込み、headlessは何も渡さない。
 */

/** WorkspaceServiceの、WorkLogを書く3つのメソッド（実体はDesktopもheadlessも同じWorkspaceService）。 */
interface WorkLogWorkspace {
  adoptWorkLogOrganization: NonNullable<WorkLogWriterPort["adoptOrganization"]>;
  recordWorkLog: WorkLogWriterPort["record"];
  changeWorkLogLifecycle: WorkLogWriterPort["changeLifecycle"];
}

type SavedChange = { type: string; entity: Record<string, unknown> };

interface FeedRepository {
  save(
    type: "feed_reaction" | "feed_reply",
    entity: Record<string, unknown>,
    options: { source: "mobile" },
  ): Record<string, unknown>;
  remove(type: "feed_reaction" | "feed_reply", id: string): Record<string, unknown> | null;
}

interface RoutineRepository {
  saveMany(
    operations: {
      action: "save";
      type: "habit" | "habit_entry";
      entity: Record<string, unknown>;
      options: { source: "mobile" };
    }[],
  ): Record<string, unknown>[];
}

export function createMobileWorkLogWriter(
  workspace: WorkLogWorkspace,
  notify: () => void = () => {},
): WorkLogWriterPort {
  return {
    adoptOrganization: (command, actor) => {
      workspace.adoptWorkLogOrganization(command, actor);
      notify();
    },
    record: (command, actor) => {
      const receipt = workspace.recordWorkLog(command, actor);
      notify();
      return receipt;
    },
    changeLifecycle: (command, actor) => {
      const receipt = workspace.changeWorkLogLifecycle(command, actor);
      notify();
      return receipt;
    },
  };
}

/** Androidからの反応・返信。Desktopの画面と同じEntity保存（feed_reaction / feed_reply）を使う。 */
export function createMobileFeedWriter(
  repository: FeedRepository,
  notify: (change?: SavedChange) => void = () => {},
): FeedWriterPort {
  return {
    save: (type, entity) => {
      const saved = repository.save(type, entity, { source: "mobile" });
      notify({ type, entity: saved });
      return saved;
    },
    remove: (type, id) => {
      const removed = repository.remove(type, id);
      notify(removed ? { type, entity: removed } : undefined);
      return removed;
    },
  };
}

/** Androidからの続けることの記録（#454）。Desktopの記録と同じEntity保存を使う。 */
export function createMobileRoutineWriter(
  repository: RoutineRepository,
  notify: (change: SavedChange) => void = () => {},
): RoutineWriterPort {
  return {
    saveMany: (operations) => {
      const saved = repository.saveMany(
        operations.map(({ type, entity }) => ({
          action: "save" as const,
          type,
          entity,
          options: { source: "mobile" as const },
        })),
      );
      saved.forEach((entity, index) => notify({ type: operations[index].type, entity }));
      return saved;
    },
  };
}
