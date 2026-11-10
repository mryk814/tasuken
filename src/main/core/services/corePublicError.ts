/**
 * Coreの限定の入口が、AIへそのまま返す失敗。HTTPの状態とAI向けのcodeを持つ。
 * 次に何をすればよいかは`taskenCorePublicError`がcodeから案内する（shared/contracts/core/errors.mjs）。
 * hostは名前で見分ける（bundleの境界をまたいでもinstanceofに頼らないため）。
 */
export class CorePublicError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CorePublicError";
  }
}

/** 本人が設定で直接の書き込みを許していない。読み取りと提案は今までどおり使える。 */
export function directWriteDisabled(): CorePublicError {
  return new CorePublicError(
    "DIRECT_WRITE_DISABLED",
    "ローカルのAIによる直接の書き込みは、設定で無効になっています。",
    403,
  );
}
