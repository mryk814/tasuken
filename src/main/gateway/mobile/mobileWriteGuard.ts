import type { MobileGatewayCorePort } from "./mobileGatewayAdapter.ts";

/**
 * 端末からの書き込みを、Coreの口へ渡す前に断れるようにする（NASのheadless nodeだけが使う）。
 *
 * NASは「Desktopの変更を共有フォルダから取り込む側」でもあり、取り込みが追いついていない間に
 * 既存のEntityを書き換えると、Desktopとの間でEntityまるごとの二択の競合になる。
 * 断るときは`refuseMobileWriteForNow()`（`MobileGatewayCoreUnavailableError`を投げる）を呼ぶ。Gatewayはこれを503（retryable）で返し、
 * Androidはoutboxに残して自動で再送する（409は却下になるので使わない）。
 */
export interface MobileWriteIntent {
  /** `create`は新しいEntityを足すだけの書き込み。`modify`は既存のEntityを書き換える。 */
  kind: "create" | "modify";
  /** `modify`の対象。分からない種類（反応の切り替えなど）は空で、鮮度の判定だけを受ける。 */
  targets: readonly { type: string; id: string }[];
}

export type MobileWriteGuard = (intent: MobileWriteIntent) => void;

const create: MobileWriteIntent = { kind: "create", targets: [] };

function modify(...targets: { type: string; id: string }[]): MobileWriteIntent {
  return { kind: "modify", targets };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function guardMobileWrites(
  core: MobileGatewayCorePort,
  guard: MobileWriteGuard,
): MobileGatewayCorePort {
  const guarded: MobileGatewayCorePort = {
    ...core,
    executeTaskCommand: (input) => {
      const command = record(input);
      const name = text(command.name);
      guard(
        name === "CreateTask"
          ? create
          : modify({ type: "task", id: text(record(command.payload).task_id) }),
      );
      return core.executeTaskCommand(input);
    },
    executeCaptureCommand: (input) => {
      guard(
        input.name === "CreateCapture"
          ? create
          : modify({ type: "capture_entry", id: text(record(input.payload).captureId) }),
      );
      return core.executeCaptureCommand(input);
    },
    decideTaskWorkProposal: (input) => {
      guard(
        modify({ type: "ai_proposal", id: input.proposalId }, { type: "task", id: input.taskId }),
      );
      return core.decideTaskWorkProposal(input);
    },
  };
  const { executeWorkLogCommand, executeFeedAction, executeRoutineAction } = core;
  if (executeWorkLogCommand) {
    guarded.executeWorkLogCommand = (input) => {
      const command = input.command;
      guard(
        command.name === "RecordWorkLog"
          ? create
          : command.name === "AdoptWorkLogOrganization"
            ? modify({ type: "note", id: command.sourceId })
            : modify({ type: "note", id: command.noteId }),
      );
      return executeWorkLogCommand(input);
    };
  }
  if (executeFeedAction) {
    guarded.executeFeedAction = (input) => {
      // 反応は既存の反応を切り替えうるが、対象のIDは書き込み口の内側で決まる。返信は新しい記録。
      guard(input.action.name === "PostFeedReply" ? create : modify());
      return executeFeedAction(input);
    };
  }
  if (executeRoutineAction) {
    guarded.executeRoutineAction = (input) => {
      // 記録を足すだけに見えるが、続けることの本体（habit）も丸ごと上書きする
      // （mobileRoutinePort）。既存Entityの書き換えとして、本体を対象にする。
      guard(modify({ type: "habit", id: input.action.habitId }));
      return executeRoutineAction(input);
    };
  }
  return guarded;
}
