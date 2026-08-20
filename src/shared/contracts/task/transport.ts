/**
 * Task transport channel names are part of the Task feature contract.
 *
 * The aggregate IPC registry may expose these values temporarily through the
 * compatibility alias, but it must not own the channel literals.
 */
export const TASK_IPC_CHANNELS = Object.freeze({
  command: "task:command",
  query: "task:query",
  changed: "task:changed",
} as const);

export type TaskIpcChannel = typeof TASK_IPC_CHANNELS[keyof typeof TASK_IPC_CHANNELS];
