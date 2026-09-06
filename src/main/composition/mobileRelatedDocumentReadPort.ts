import { createHash } from "node:crypto";
import { normalizeReferenceAssertion } from "../../shared/relationAssertion.mjs";
import {
  mobileRelatedDocumentDataSchema,
  mobileRelatedDocumentsDataSchema,
  type MobileRelatedDocumentRequest,
  type MobileRelatedDocumentsRequest,
  type MobileRelatedDocumentsData,
} from "../../shared/contracts/mobile/public.ts";

interface Persistence {
  get(type: string, id: string, includeDeleted?: boolean): Record<string, unknown> | null;
  list(type: string, includeDeleted?: boolean): Record<string, unknown>[];
}

/** Owner-authorized text reads: explicit relations only; never AI audience or file locators. */
export function createMobileRelatedDocumentReadPort(persistence: Persistence) {
  function related(taskId: string): MobileRelatedDocumentsData["documents"] {
    const result = new Map<string, MobileRelatedDocumentsData["documents"][number]>();
    function add(type: string, id: string, predicate: string, direction: "from_task" | "to_task") {
      if (type !== "note" && type !== "capture_entry") return;
      const key = JSON.stringify([type, id]);
      let item = result.get(key);
      if (!item) {
        const record = persistence.get(type, id);
        item = {
          type,
          id,
          title: record
            ? String(record.title || (type === "note" ? "ノート" : "Capture")).slice(0, 500)
            : "参照先が見つかりません",
          version: record ? Number(record.version) : null,
          status: record ? "available" : "not_found",
          reasons: [],
        };
        result.set(key, item);
      }
      if (
        item.reasons.length < 3 &&
        !item.reasons.some(
          (reason) => reason.predicate === predicate && reason.direction === direction,
        )
      )
        item.reasons.push({ predicate: predicate.slice(0, 200), direction });
    }
    for (const record of persistence.list("reference")) {
      let relation;
      try {
        relation = normalizeReferenceAssertion(record, { legacyRead: true });
      } catch {
        continue;
      }
      if (relation.status !== "asserted") continue;
      const subject = relation.subject as { type: string; id: string };
      const object = relation.object as { type: string; id: string };
      if (subject.type === "task" && subject.id === taskId)
        add(object.type, object.id, relation.predicate, "from_task");
      if (object.type === "task" && object.id === taskId)
        add(subject.type, subject.id, relation.predicate, "to_task");
    }
    for (const capture of persistence.list("capture_entry")) {
      if (capture.triaged_to_type === "task" && capture.triaged_to_id === taskId)
        add("capture_entry", String(capture.id), "triaged_to", "to_task");
    }
    return [...result.values()].sort(
      (a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
    );
  }
  return {
    queryRelatedDocuments(request: MobileRelatedDocumentsRequest) {
      const empty = { taskId: request.taskId, documents: [], nextCursor: null };
      if (!persistence.get("task", request.taskId))
        return mobileRelatedDocumentsDataSchema.parse({ ...empty, status: "not_found" });
      const documents = related(request.taskId);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([request.taskId, documents]))
        .digest("hex");
      let offset = 0;
      if (request.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8"));
          if (
            cursor.fingerprint !== fingerprint ||
            !Number.isSafeInteger(cursor.offset) ||
            cursor.offset < 0 ||
            cursor.offset > documents.length
          )
            throw new Error("stale");
          offset = cursor.offset;
        } catch {
          return mobileRelatedDocumentsDataSchema.parse({ ...empty, status: "cursor_stale" });
        }
      }
      const end = offset + request.limit;
      return mobileRelatedDocumentsDataSchema.parse({
        taskId: request.taskId,
        status: "available",
        documents: documents.slice(offset, end),
        nextCursor:
          end < documents.length
            ? Buffer.from(JSON.stringify({ fingerprint, offset: end })).toString("base64url")
            : null,
      });
    },
    getRelatedDocument(request: MobileRelatedDocumentRequest) {
      const base = { taskId: request.taskId, type: request.type, id: request.id, document: null };
      if (!persistence.get("task", request.taskId))
        return mobileRelatedDocumentDataSchema.parse({ ...base, status: "not_found" });
      const summary = related(request.taskId).find(
        (item) => item.type === request.type && item.id === request.id,
      );
      if (!summary)
        return mobileRelatedDocumentDataSchema.parse({ ...base, status: "not_related" });
      const record = persistence.get(request.type, request.id);
      if (!record) return mobileRelatedDocumentDataSchema.parse({ ...base, status: "not_found" });
      const body = String(request.type === "note" ? record.body_markdown || "" : record.text || "");
      const end =
        body.length > 50000 && /[\uD800-\uDBFF]/u.test(body.charAt(49999)) ? 49999 : 50000;
      return mobileRelatedDocumentDataSchema.parse({
        ...base,
        status: "available",
        document: {
          title: summary.title,
          version: Number(record.version),
          body: body.slice(0, end),
          totalCharacters: body.length,
          truncated: body.length > end,
        },
      });
    },
  };
}
