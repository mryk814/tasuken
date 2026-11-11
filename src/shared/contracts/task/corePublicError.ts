/**
 * Coreの限定の入口が、AIへそのまま返す失敗。HTTPの状態とAI向けのcodeを持つ。
 * 次に何をすればよいかは`taskenCorePublicError`がcodeから案内する（shared/contracts/core/errors.mjs）。
 * Core（main.core）とMainのapplication（main.application）の両方が投げるので、共有の契約に置く。
 * hostは名前で見分ける（bundleの境界をまたいでもinstanceofに頼らないため）。
 * MCP bridgeはNodeの型の取り除きで読むので、引数のプロパティ宣言は使わない。
 */
export class CorePublicError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CorePublicError";
    this.code = code;
    this.status = status;
    this.details = details;
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
