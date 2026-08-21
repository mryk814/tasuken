function desktopApi() {
  return window.api;
}

export const mobileGatewayApi = {
  diagnostics() {
    return desktopApi().mobileGateway.diagnostics();
  },
  issuePairing() {
    return desktopApi().mobileGateway.issuePairing();
  },
  cancelPairing() {
    return desktopApi().mobileGateway.cancelPairing();
  },
  revokeDevice(deviceId: string) {
    return desktopApi().mobileGateway.revokeDevice(deviceId);
  },
};
