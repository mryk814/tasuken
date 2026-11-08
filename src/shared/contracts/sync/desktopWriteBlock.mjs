/**
 * replica が書き込みを断るかの判定。
 *
 * replica は main に入って 5 分で新しい版になるが、Desktop は本人が上げるまで古いまま。
 * replica が新しい形の差分を書いても、古い Desktop は取り込めず、その端末の同期が止まる。
 * そこで、取り込めない Desktop がいる間は、replica の書き込みを入口で断る。
 *
 * @param {{ flags: ReadonlyArray<{ shape_sha256: string, desktop_first?: boolean }>,
 *           desktops: ReadonlyArray<{ syncShape?: string }> }} input
 *   desktops は replica が数えている Desktop の status（直近 14 日以内、または未追いつき）。
 * @returns {null | "desktop_behind"} null は書いてよい。
 */
export function desktopWriteBlock({ flags, desktops }) {
  const desktopFirstFrom = (index) =>
    flags.slice(index).some((flag) => flag.desktop_first === true);
  // 数える Desktop が無い（syncShape を出さない前の版だけ、など）。その版はこの仕組みより後に
  // 足される形を取り込めないので、desktop_first の印が一つでもあれば断る。
  if (desktops.length === 0) return desktopFirstFrom(0) ? "desktop_behind" : null;
  for (const desktop of desktops) {
    const index = flags.findIndex((flag) => flag.shape_sha256 === desktop.syncShape);
    // 見つからないのは Desktop の方が新しい（または branch の build）。問題にしない。
    if (index < 0) continue;
    // その Desktop が取り込める形より後ろに、Desktop を先に上げる必要がある印があるか。
    if (desktopFirstFrom(index + 1)) return "desktop_behind";
  }
  return null;
}
