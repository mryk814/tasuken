export function withWorkspaceRefresh<TInput, TOutput>(
  service: { execute(input: TInput): TOutput },
  notifyWorkspaceChanged: () => void,
): { execute(input: TInput): TOutput } {
  return {
    execute(input) {
      const result = service.execute(input);
      notifyWorkspaceChanged();
      return result;
    },
  };
}
