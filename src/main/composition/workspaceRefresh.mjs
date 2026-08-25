export function withWorkspaceRefresh(service, notifyWorkspaceChanged) {
  return {
    execute(input) {
      const result = service.execute(input);
      notifyWorkspaceChanged();
      return result;
    },
  };
}
