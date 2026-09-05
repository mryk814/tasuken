export const captureOrganizerApi = {
  getSettings: () => window.api.captureOrganizer.getSettings(),
  saveSettings: (input: Parameters<typeof window.api.captureOrganizer.saveSettings>[0]) =>
    window.api.captureOrganizer.saveSettings(input),
  testConnection: (input: Parameters<typeof window.api.captureOrganizer.testConnection>[0]) =>
    window.api.captureOrganizer.testConnection(input),
  clearSettings: () => window.api.captureOrganizer.clearSettings(),
};
