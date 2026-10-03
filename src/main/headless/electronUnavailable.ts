/** Headless canonical persistence reuses WorkspaceService; Desktop APIs stay unavailable. */
const unavailable = () => {
  throw new Error("Desktop APIはheadless Coreで利用できません。");
};
export const app = new Proxy({}, { get: unavailable });
export const clipboard = new Proxy({}, { get: unavailable });
export const dialog = new Proxy({}, { get: unavailable });
export const nativeImage = new Proxy({}, { get: unavailable });
export const shell = new Proxy({}, { get: unavailable });
export const BrowserWindow = unavailable;
