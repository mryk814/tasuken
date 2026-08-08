/**
 * Notes routeは切替時にunmountされるため、終了flushの待機対象をrouteの寿命から分離する。
 * 各renderer window内のMain use caseから同じregistryを共有し、fire-and-forgetを残さない。
 */
const pendingNoteDraftSaves = new Set<Promise<boolean>>();

export function trackPendingNoteDraftSave(promise: Promise<unknown>): void {
  let tracked: Promise<boolean>;
  tracked = promise.then(
    () => {
      pendingNoteDraftSaves.delete(tracked);
      return true;
    },
    () => {
      pendingNoteDraftSaves.delete(tracked);
      return false;
    },
  );
  pendingNoteDraftSaves.add(tracked);
}

export async function flushPendingNoteDraftSaves(): Promise<boolean> {
  let ok = true;
  while (pendingNoteDraftSaves.size) {
    const results = await Promise.all([...pendingNoteDraftSaves]);
    if (results.some((result) => !result)) ok = false;
  }
  return ok;
}
