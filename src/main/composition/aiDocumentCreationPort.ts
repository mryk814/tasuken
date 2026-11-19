import type { AiDocumentCreationPort } from "../core/public.ts";
import { createDocumentAssetPort } from "../services/documentAssetStore.ts";
import { DocumentFileStore } from "../services/documentFileStore.ts";

/**
 * Document直接作成（#789）の保存の実務を束ねる。アセットと本文ファイルはどちらも
 * 受け側ノードのuserData配下（attachments/）に置くので、Desktopでも常時稼働nodeでも
 * 同じ形で渡せる。
 */
export function createAiDocumentCreationPort(
  userDataPath: string,
  onCommitted?: () => void,
): AiDocumentCreationPort {
  const files = new DocumentFileStore(userDataPath);
  return {
    assets: createDocumentAssetPort(userDataPath),
    writeFile: (input) => files.write(input),
    removeFile: (filename) => files.remove(filename),
    onCommitted,
  };
}
