export function withWorkspaceRefresh<TInput, TOutput>(
  service: { execute(input: TInput): TOutput },
  notifyWorkspaceChanged: () => void,
): { execute(input: TInput): TOutput };
