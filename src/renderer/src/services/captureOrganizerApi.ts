export const captureOrganizerApi = {
  openTaskCapture: () => window.api.openTaskCapture(),
  openSaved: (captureId: string, version: number) =>
    window.api.captureOrganizer.openSaved(captureId, version),
  getSettings: () => window.api.captureOrganizer.getSettings(),
  saveSettings: (input: Parameters<typeof window.api.captureOrganizer.saveSettings>[0]) =>
    window.api.captureOrganizer.saveSettings(input),
  testConnection: (input: Parameters<typeof window.api.captureOrganizer.testConnection>[0]) =>
    window.api.captureOrganizer.testConnection(input),
  clearSettings: () => window.api.captureOrganizer.clearSettings(),
  chatGptState: () => window.api.captureOrganizer.chatGptState(),
  chatGptConnect: () => window.api.captureOrganizer.chatGptConnect(),
  chatGptCancel: () => window.api.captureOrganizer.chatGptCancel(),
  chatGptDisconnect: () => window.api.captureOrganizer.chatGptDisconnect(),
  chatGptModels: () => window.api.captureOrganizer.chatGptModels(),
};
