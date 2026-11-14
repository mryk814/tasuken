import { TASK_IPC_CHANNELS, type TaskIpcChannel } from "../contracts/task/transport.ts";

/**
 * Temporary compatibility surface for aggregate IPC consumers.
 *
 * Removal condition (#407/#406): remove this alias and the aggregate
 * `IPC.task*` / `ResearchDeskApi.task` surface after Main, Preload, and Renderer
 * consumers use the Task transport contract directly and the
 * consumer inventory reaches zero.
 */
export const LEGACY_TASK_IPC_CHANNELS = TASK_IPC_CHANNELS;

export type { TaskIpcChannel };
