// AIへそのまま返す失敗は、Mainのapplicationも投げるので共有の契約に置いている。
export { CorePublicError, directWriteDisabled } from "../../../shared/contracts/task/public.ts";
