/** @deprecated Import from workspace/domain-model/persistence instead */
export type { SaveContext as V2SaveContext, SaveContext, TriageTarget } from "../../workspace/domain-model/persistence";
export {
  buildChangeEventOperation,
  buildSaveTaskOperations,
  buildSaveWaitingOperations,
  buildSavePlanNodeOperations,
  buildSaveScheduleOperations,
  buildSaveCaptureEntryOperations,
  buildTriageCaptureEntryOperations,
  saveTask,
  saveWaiting,
  savePlanNode,
  saveSchedule,
  saveCaptureEntry,
  triageCaptureEntry,
} from "../../workspace/domain-model/persistence";
