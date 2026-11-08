import contract from "../../../../contracts/sync/ai-item-packets.json" with { type: "json" };

/**
 * AI 作成の Task・Note の同期差分の形の印（contracts/sync/ai-item-packets.json の flags）。
 * 印の正本は JSON のまま置き、ここは実行時の判定が読む口だけにする。
 * tests/ai-item-creation.test.mjs が「最後の印 ＝ この版の replica が出す形」を保証するので、
 * 最後の shape_sha256 が、この版の Desktop が取り込める形になる。
 */
export const aiItemPacketFlags = Object.freeze(
  contract.flags.map((flag) => Object.freeze({ ...flag })),
);

export const currentSyncShape = aiItemPacketFlags.at(-1).shape_sha256;
