/**
 * Notes本文の所有者契約。
 *
 * Entity identityと本文は、保存・表示・Editor参照のどの経路でも同じ
 * ownerを通して扱う。ownerなしの「現在のEditor本文」は存在しない。
 */

export type NoteDraftRecordType = "note" | "resource";

export type NoteDraftOwner = {
  recordType: NoteDraftRecordType;
  entityId: string;
};

export type NoteDraftSnapshot = {
  owner: NoteDraftOwner;
  body: string;
  dirty: boolean;
};

export type NoteDraftEditorSession = {
  ownerKey: string;
  getMarkdown: () => string;
};

export function noteDraftOwner(recordType: NoteDraftRecordType, entityId: string): NoteDraftOwner {
  return { recordType, entityId };
}

export function noteDraftOwnerKey(owner: NoteDraftOwner): string {
  return `${owner.recordType}:${owner.entityId}`;
}

export function sameNoteDraftOwner(left: NoteDraftOwner | null | undefined, right: NoteDraftOwner | null | undefined): boolean {
  return Boolean(left && right && left.recordType === right.recordType && left.entityId === right.entityId);
}

export function makeNoteDraftSnapshot(
  owner: NoteDraftOwner,
  body: string,
  savedBody: string,
): NoteDraftSnapshot {
  return {
    owner,
    body,
    dirty: body !== savedBody,
  };
}

/**
 * 現在のEditor本文を使えるのは、Editor sessionと保存対象ownerが一致するときだけ。
 * 不一致時はsnapshot、さらにそれも不一致なら保存済み本文へ戻す。
 */
export function readNoteDraftBody({
  owner,
  snapshot,
  editor,
  savedBody,
}: {
  owner: NoteDraftOwner;
  snapshot?: NoteDraftSnapshot | null;
  editor?: NoteDraftEditorSession | null;
  savedBody: string;
}): string {
  const ownerKey = noteDraftOwnerKey(owner);
  if (editor?.ownerKey === ownerKey) return editor.getMarkdown();
  if (snapshot && sameNoteDraftOwner(snapshot.owner, owner)) return snapshot.body;
  return savedBody;
}

export function renderNoteDraftBody(
  owner: NoteDraftOwner | null,
  snapshot: NoteDraftSnapshot | null,
  savedBody: string,
): string {
  if (owner && snapshot && sameNoteDraftOwner(owner, snapshot.owner)) return snapshot.body;
  return savedBody;
}
