import { createHash } from "node:crypto";
import type {
  ArtifactProposalMaterializeRequest,
  ArtifactProposalMaterializeResult,
} from "../../shared/attachments";
import {
  ApplicationCommandError,
  parseCommandEnvelope,
  type CommandEnvelope,
  type CommandReceipt,
} from "../../shared/applicationCommand";
import type { Entity } from "../../shared/types/workspace";
import { markdownSignature } from "../../shared/canonicalMarkdown.mjs";
import {
  applyProposalMarkdownHunks,
  markdownProposalHunkCount,
  stableProposalEntityId,
} from "../../shared/proposalAcceptance.mjs";
import { isWebArtifact } from "../../shared/webArtifact.mjs";
import { validateArtifactProposal, validateSafeSvg } from "../../shared/proposalMedia.mjs";
import { commandFingerprint } from "./applicationCommandService";

interface CommandExecutor {
  execute(input: unknown): CommandReceipt;
  executeCanonicalNoteAiProposal?(
    input: unknown,
    saveCanonicalNote: (note: Entity, companion: unknown) => Entity,
  ): CommandReceipt;
}

interface ArtifactMaterializer {
  materializeArtifactProposal(
    request: ArtifactProposalMaterializeRequest,
  ): ArtifactProposalMaterializeResult;
  rollbackMaterializedArtifactProposal(storedPath: string): void;
  saveCanonicalNote?(request: unknown, companion?: unknown): Record<string, unknown>;
}

interface ProposalRepository {
  get(type: string, id: string, includeDeleted?: boolean): Entity | null;
  list(type: string, includeDeleted?: boolean): Entity[];
  save(type: string, entity: Entity): Entity;
}

const RECEIPT_INTEGRITY_SCHEMA = "tasken-content-proposal-receipt/v1";
const RECEIPT_INTEGRITY_KEY = "content_proposal_receipt_integrity";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function receiptDigest(serialized: string): string {
  return `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

function receiptConflict(commandId: string): never {
  throw new ApplicationCommandError(
    "COMMAND_ID_REUSED",
    "同じcommandIdの完了状態がContent Proposal commandと一致しません。",
    {
      commandId,
      conflictReason: "command_fingerprint_mismatch",
    },
  );
}

function validateLegacyReceipt(
  repository: ProposalRepository,
  command: CommandEnvelope,
  receipt: CommandReceipt,
  payload: { proposal?: Entity; candidates?: ProposalCandidate[] },
): void {
  const allowedKeys = [
    "changes",
    "commandId",
    "deleted",
    "events",
    "name",
    "revisions",
    "saved",
    "status",
    "warnings",
  ];
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    canonicalJson(Object.keys(receipt).sort()) !== canonicalJson(allowedKeys) ||
    receipt.commandId !== command.commandId ||
    receipt.name !== command.name ||
    receipt.status !== "applied" ||
    !Array.isArray(receipt.events) ||
    !Array.isArray(receipt.changes) ||
    !Array.isArray(receipt.saved) ||
    !Array.isArray(receipt.revisions) ||
    !Array.isArray(receipt.deleted) ||
    !Array.isArray(receipt.warnings) ||
    receipt.deleted.length !== 0 ||
    receipt.warnings.length !== 0 ||
    new Set(receipt.events).size !== receipt.events.length
  )
    receiptConflict(command.commandId);

  const commandEvents = repository
    .list("change_event", true)
    .filter((event) => event.command_id === command.commandId);
  const commandEventIds = new Set(commandEvents.map((event) => event.id));
  if (
    commandEventIds.size !== receipt.events.length ||
    receipt.events.some((id) => typeof id !== "string" || !commandEventIds.has(id))
  ) {
    receiptConflict(command.commandId);
  }
  const events = receipt.events.map((id) => repository.get("change_event", id, true));
  if (
    events.some(
      (event) =>
        !event ||
        event.command_name !== command.name ||
        event.command_fingerprint !== commandFingerprint(command),
    )
  ) {
    receiptConflict(command.commandId);
  }
  let expectedChanges: CommandReceipt["changes"];
  try {
    expectedChanges = events.map((event) => ({
      type: String(
        event!.record_type || event!.entity_type,
      ) as CommandReceipt["changes"][number]["type"],
      entity: JSON.parse(String(event!.after_json)) as Entity,
    }));
  } catch {
    receiptConflict(command.commandId);
  }
  if (!expectedChanges.some(({ type }) => type === "ai_proposal")) {
    const proposalId = String(payload.proposal?.id || "");
    const companionProposal = proposalId ? repository.get("ai_proposal", proposalId, true) : null;
    if (!companionProposal) receiptConflict(command.commandId);
    expectedChanges.push({ type: "ai_proposal", entity: companionProposal });
  }
  const expectedRefs = [
    ...(payload.candidates || []).map((candidate) => ({
      type: candidate.type,
      id: candidate.entity.id,
    })),
    { type: "ai_proposal", id: String(payload.proposal?.id || "") },
  ];
  if (
    canonicalJson(expectedChanges.map(({ type, entity }) => ({ type, id: entity.id }))) !==
      canonicalJson(expectedRefs) ||
    canonicalJson(receipt.changes) !== canonicalJson(expectedChanges)
  )
    receiptConflict(command.commandId);
  const expectedSaved = expectedChanges.map(({ type, entity }) => ({
    type,
    id: entity.id,
    version: Number(entity.version || 0),
  }));
  if (
    canonicalJson(receipt.saved) !== canonicalJson(expectedSaved) ||
    canonicalJson(receipt.revisions) !== canonicalJson(expectedSaved)
  )
    receiptConflict(command.commandId);
}

interface ArtifactMaterializationReference {
  entryIndex: number;
  themeId?: string | null;
}

interface ProposalCandidate {
  type: string;
  entity: Entity & { proposal_materialization?: ArtifactMaterializationReference };
}

interface ProposalEntryDecision {
  entryIndex: number;
  type: "note" | "knowledge_node" | "knowledge_edge" | "artifact" | "sketch";
  action: "accept" | "ignore";
  acceptedHunks?: number[];
  beforeSignature?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

function canonicalThemeId(
  repository: ProposalRepository,
  entry: Record<string, unknown>,
  fallback: unknown = null,
): string | null {
  const requested = text(entry.theme).trim();
  if (!requested) return text(fallback).trim() || null;
  const theme = [...repository.list("project"), ...repository.list("theme")].find(
    (candidate) =>
      candidate.id === requested ||
      text(candidate.name) === requested ||
      text(candidate.title) === requested,
  );
  return theme?.id || null;
}

function rebuildCanonicalCandidates(
  repository: ProposalRepository,
  proposal: Entity,
  canonicalPayload: Record<string, unknown>,
  decisions: ProposalEntryDecision[],
): ProposalCandidate[] {
  const payloadType = text(proposal.payload_type);
  if (payloadType === "notes") {
    const entries = records(canonicalPayload.notes);
    if (entries.length !== 1)
      throw new Error("Note Proposal候補が正本と一致しません。Previewを開き直してください。");
    const entry = entries[0];
    const targetId = text(entry.target_id);
    const current = targetId ? repository.get("note", targetId, true) : null;
    const decision = decisions[0];
    if (decision?.action === "accept" && targetId && (!current || current.deleted_at)) {
      throw new Error("採用対象のNoteがありません。Previewを開き直してください。");
    }
    const id = current?.id || targetId || stableProposalEntityId(proposal.id, "note", 0);
    let body = text(entry.body_markdown) || text(entry.body);
    if (current && decision?.action === "accept") {
      const request =
        proposal.request && typeof proposal.request === "object" && !Array.isArray(proposal.request)
          ? (proposal.request as Record<string, unknown>)
          : {};
      const target =
        request.target && typeof request.target === "object" && !Array.isArray(request.target)
          ? (request.target as Record<string, unknown>)
          : {};
      const baseVersion = Number(entry.base_version);
      if (
        target.type !== "note" ||
        target.id !== current.id ||
        Number(target.base_version) !== baseVersion ||
        !Number.isInteger(baseVersion) ||
        baseVersion !== Number(current.version || 0)
      ) {
        throw new Error(
          "Note Proposalのbase_versionまたはtargetが更新済みです。contextを再取得してください。",
        );
      }
      const before = text(current.body_markdown);
      if (!decision || decision.beforeSignature !== markdownSignature(before)) {
        throw new Error("Note Proposalの編集元署名が一致しません。Previewを開き直してください。");
      }
      const acceptedHunks = decision.acceptedHunks;
      const hunkCount = markdownProposalHunkCount(before, body);
      if (
        !Array.isArray(acceptedHunks) ||
        new Set(acceptedHunks).size !== acceptedHunks.length ||
        acceptedHunks.some((index) => index < 0 || index >= hunkCount)
      ) {
        throw new Error("Note Proposalの採用hunkが不正です。Previewを開き直してください。");
      }
      body = applyProposalMarkdownHunks(before, body, acceptedHunks);
    }
    const reportDate = text(entry.report_date);
    const currentProperties = current?.properties_json;
    return [
      {
        type: "note",
        entity: {
          ...(current || {}),
          id,
          title: text(entry.title) || text(current?.title) || "無題",
          body_markdown: body,
          note_type: text(entry.note_type) || text(current?.note_type) || "memo",
          theme_id: canonicalThemeId(repository, entry, current?.project_id || current?.theme_id),
          source_url: text(entry.source_url) || text(current?.source_url),
          ...(reportDate
            ? {
                properties_json: {
                  ...(currentProperties &&
                  typeof currentProperties === "object" &&
                  !Array.isArray(currentProperties)
                    ? currentProperties
                    : {}),
                  daily_report: { date: reportDate },
                },
              }
            : {}),
        },
      },
    ];
  }
  if (payloadType === "knowledge_nodes") {
    const nodeEntries = records(canonicalPayload.knowledge_nodes);
    const edgeEntries = records(canonicalPayload.knowledge_edges);
    const result: ProposalCandidate[] = [];
    const tempIds = new Map<string, string>();
    nodeEntries.forEach((entry, index) => {
      const targetId = text(entry.target_id);
      const current = targetId ? repository.get("knowledge_node", targetId, true) : null;
      const id = current?.id || stableProposalEntityId(proposal.id, "knowledge_node", index);
      if (text(entry.temp_id)) tempIds.set(text(entry.temp_id), id);
      result.push({
        type: "knowledge_node",
        entity: {
          ...(current || {}),
          id,
          node_type: text(entry.node_type) || "insight",
          title: text(entry.title) || "無題",
          body: text(entry.body),
          theme_id: canonicalThemeId(repository, entry, current?.theme_id),
          source_note_id: text(entry.source_note_id) || text(current?.source_note_id) || null,
          source_link_id: text(entry.source_link_id) || text(current?.source_link_id) || null,
          source_item_id: text(entry.source_item_id) || text(current?.source_item_id) || null,
          confidence: text(entry.confidence) || text(current?.confidence) || "medium",
          status: text(entry.status) || text(current?.status) || "active",
        },
      });
    });
    edgeEntries.forEach((entry, edgeIndex) => {
      const operationIndex = nodeEntries.length + edgeIndex;
      const targetId = text(entry.target_id);
      const current = targetId ? repository.get("knowledge_edge", targetId, true) : null;
      const id =
        current?.id || stableProposalEntityId(proposal.id, "knowledge_edge", operationIndex);
      result.push({
        type: "knowledge_edge",
        entity: {
          ...(current || {}),
          id,
          source_node_id:
            text(entry.source_node_id) || tempIds.get(text(entry.source_temp_id)) || "",
          target_node_id:
            text(entry.target_node_id) || tempIds.get(text(entry.target_temp_id)) || "",
          relation_type: text(entry.relation_type) || text(current?.relation_type) || "supports",
          description: text(entry.description) || text(current?.description),
        },
      });
    });
    return result;
  }
  if (payloadType === "sketches") {
    const entries = records(canonicalPayload.sketches);
    return entries.map((entry, index) => {
      const id = stableProposalEntityId(proposal.id, "sketch", index);
      const svg = validateSafeSvg(entry.svg);
      return {
        type: "sketch",
        entity: {
          id,
          title: text(entry.title) || "AI Sketch",
          project_id: canonicalThemeId(repository, entry),
          origin_capture_id: null,
          document: {
            schema_version: 1,
            mode: "page",
            pages: [
              {
                id: stableProposalEntityId(proposal.id, "sketch_page", index),
                title: "1",
                width: 1200,
                height: 850,
                background: "dot",
                objects: [
                  {
                    id: stableProposalEntityId(proposal.id, "sketch_object", index),
                    type: "image",
                    color: "#000000",
                    x: 40,
                    y: 40,
                    w: 1120,
                    h: 770,
                    data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
                  },
                ],
              },
            ],
          },
        },
      };
    });
  }
  if (payloadType === "artifacts") {
    return records(canonicalPayload.artifacts).map((entry, index) => ({
      type: "artifact",
      entity: {
        id: stableProposalEntityId(proposal.id, "artifact", index),
        proposal_materialization: { entryIndex: index },
      },
    }));
  }
  throw new Error("このProposal typeはcontent acceptance境界で扱えません。");
}

function selectedCanonicalCandidates(
  full: ProposalCandidate[],
  supplied: ProposalCandidate[],
  decisions: ProposalEntryDecision[],
  reject: boolean,
): ProposalCandidate[] {
  if (decisions.length !== full.length)
    throw new Error("Proposal entry decisionが不足しています。Previewを開き直してください。");
  decisions.forEach((decision, index) => {
    if (decision.entryIndex !== index || decision.type !== full[index]?.type) {
      throw new Error(
        "Proposal entry decisionのindex/typeが正本と一致しません。Previewを開き直してください。",
      );
    }
  });
  if (reject) {
    if (supplied.length || decisions.some((decision) => decision.action !== "ignore")) {
      throw new Error("Proposal却下には全entryのignore decisionと空の候補だけを指定してください。");
    }
    return [];
  }
  const selected = full.filter((_, index) => decisions[index].action === "accept");
  if (selected.length !== supplied.length)
    throw new Error("Proposal候補の件数がentry decisionと一致しません。");
  selected.forEach((candidate, index) => {
    const input = supplied[index];
    if (!input || input.type !== candidate.type || input.entity.id !== candidate.entity.id) {
      throw new Error(
        "Proposal候補のtype/id/indexが正本と一致しません。Previewを開き直してください。",
      );
    }
  });
  return selected;
}

/**
 * Main-owned coordinator for ApplyAiProposal. Files are materialized with a
 * stable candidate key, then the canonical Application Command commits DB
 * state. A failed DB command removes only files created by this attempt.
 */
export class AiProposalAcceptanceService {
  constructor(
    private readonly commands: CommandExecutor,
    private readonly artifacts: ArtifactMaterializer,
    private readonly repository: ProposalRepository,
  ) {}

  private sealReceipt(receipt: CommandReceipt): CommandReceipt {
    for (const eventId of receipt.events) {
      const event = this.repository.get("change_event", eventId, true);
      if (!event || typeof event.receipt_json !== "string") receiptConflict(receipt.commandId);
      const metadata =
        event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : {};
      this.repository.save("change_event", {
        ...event,
        metadata: {
          ...metadata,
          [RECEIPT_INTEGRITY_KEY]: {
            schema: RECEIPT_INTEGRITY_SCHEMA,
            digest: receiptDigest(event.receipt_json),
          },
        },
      });
    }
    return receipt;
  }

  execute(input: CommandEnvelope): CommandReceipt {
    if (input.name !== "ApplyAiProposal") return this.commands.execute(input);
    const parsedInput = parseCommandEnvelope(input);
    const payload = parsedInput.payload as {
      proposal?: Entity;
      decision?: "accept" | "reject";
      decisions?: ProposalEntryDecision[];
      candidates?: ProposalCandidate[];
    };
    const contentTypes = new Set(["notes", "knowledge_nodes", "sketches", "artifacts"]);
    const hintedType = text(payload.proposal?.payload_type);
    const proposalId = text(payload.proposal?.id);
    const currentProposal = proposalId ? this.repository.get("ai_proposal", proposalId) : null;
    const currentType = text(currentProposal?.payload_type);
    if (!contentTypes.has(hintedType) && !contentTypes.has(currentType))
      return this.commands.execute(input);
    if (
      !payload.proposal ||
      !Array.isArray(payload.candidates) ||
      !Array.isArray(payload.decisions) ||
      (payload.decision !== "accept" && payload.decision !== "reject")
    ) {
      throw new Error("Content Proposal acceptance payloadが不正です。");
    }
    if (!currentProposal) throw new Error("Content Proposalがありません。");
    if (!contentTypes.has(currentType) || currentType !== hintedType) {
      throw new Error("Content Proposal typeが正本と一致しません。");
    }
    const proposalVersion = Number(payload.proposal.version || 0);
    const commandId = `${payload.proposal.id}:accept:v${proposalVersion}`;
    const canonicalIssuedAt = String(
      currentProposal?.received_at ||
        currentProposal?.created_at ||
        currentProposal?.updated_at ||
        new Date(0).toISOString(),
    );
    if (parsedInput.commandId !== commandId) {
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "Content Proposal command identityが正本と一致しません。",
      );
    }
    const command: CommandEnvelope = { ...parsedInput, commandId };
    const existingEvent = this.repository
      .list("change_event", true)
      .find((event) => event.command_id === commandId);
    if (existingEvent && typeof existingEvent.receipt_json === "string") {
      if (
        existingEvent.command_name !== command.name ||
        existingEvent.command_fingerprint !== commandFingerprint(command)
      ) {
        throw new ApplicationCommandError(
          "COMMAND_ID_REUSED",
          "同じcommandIdを別のContent Proposal decisionで再利用できません。",
          {
            commandId,
            conflictReason: "command_fingerprint_mismatch",
          },
        );
      }
      const serializedReceipt = String(existingEvent.receipt_json);
      let receipt: CommandReceipt;
      try {
        receipt = JSON.parse(serializedReceipt) as CommandReceipt;
      } catch {
        throw new ApplicationCommandError(
          "COMMAND_ID_REUSED",
          "同じcommandIdの完了状態を復元できません。",
          {
            commandId,
            conflictReason: "other_conflict",
          },
        );
      }
      if (receipt.commandId !== commandId || receipt.name !== command.name) {
        throw new ApplicationCommandError(
          "COMMAND_ID_REUSED",
          "同じcommandIdの完了状態がContent Proposal commandと一致しません。",
          {
            commandId,
            conflictReason: "command_fingerprint_mismatch",
          },
        );
      }
      const metadata =
        existingEvent.metadata &&
        typeof existingEvent.metadata === "object" &&
        !Array.isArray(existingEvent.metadata)
          ? (existingEvent.metadata as Record<string, unknown>)
          : {};
      if (Object.prototype.hasOwnProperty.call(metadata, RECEIPT_INTEGRITY_KEY)) {
        const integrity = metadata[RECEIPT_INTEGRITY_KEY];
        if (
          !integrity ||
          typeof integrity !== "object" ||
          Array.isArray(integrity) ||
          canonicalJson(Object.keys(integrity as Record<string, unknown>).sort()) !==
            canonicalJson(["digest", "schema"]) ||
          (integrity as Record<string, unknown>).schema !== RECEIPT_INTEGRITY_SCHEMA ||
          (integrity as Record<string, unknown>).digest !== receiptDigest(serializedReceipt)
        )
          receiptConflict(commandId);
      } else {
        validateLegacyReceipt(this.repository, command, receipt, payload);
        this.sealReceipt(receipt);
      }
      Object.defineProperty(receipt, "replayed", { value: true, enumerable: false });
      return receipt;
    }
    if (parsedInput.issuedAt !== canonicalIssuedAt) {
      throw new ApplicationCommandError(
        "INVALID_ENVELOPE",
        "Content Proposal issuedAtが正本と一致しません。",
      );
    }
    if (currentProposal.status !== "pending") {
      const marker =
        existingEvent?.metadata &&
        typeof existingEvent.metadata === "object" &&
        !Array.isArray(existingEvent.metadata)
          ? (existingEvent.metadata as Record<string, unknown>).note_ai_command_marker
          : null;
      if (marker && this.commands.executeCanonicalNoteAiProposal) {
        return this.sealReceipt(
          this.commands.executeCanonicalNoteAiProposal(command, () => {
            throw new Error("durable canonical Note replay must not save again");
          }),
        );
      }
      throw new Error("Pending以外のContent Proposalは採用できません。");
    }
    if (Number(currentProposal.version || 0) !== proposalVersion)
      throw new Error("Content Proposalが更新済みです。Previewを開き直してください。");
    const canonicalPayload =
      currentProposal.payload &&
      typeof currentProposal.payload === "object" &&
      !Array.isArray(currentProposal.payload)
        ? (currentProposal.payload as Record<string, unknown>)
        : {};
    const artifactEntries = Array.isArray(canonicalPayload.artifacts)
      ? canonicalPayload.artifacts
      : [];
    const createdPaths: string[] = [];
    try {
      const fullCandidates = rebuildCanonicalCandidates(
        this.repository,
        currentProposal,
        canonicalPayload,
        payload.decisions,
      );
      const selectedCandidates = selectedCanonicalCandidates(
        fullCandidates,
        payload.candidates,
        payload.decisions,
        payload.decision === "reject",
      );
      const expectedStatus =
        payload.decision === "reject" || selectedCandidates.length === 0
          ? "rejected"
          : selectedCandidates.length === fullCandidates.length
            ? "accepted"
            : "partially_accepted";
      if (payload.proposal.status !== expectedStatus)
        throw new Error("Content Proposal statusがentry decisionと一致しません。");
      const candidates = selectedCandidates.map((candidate) => {
        if (candidate.type !== "artifact") return candidate;
        const request = candidate.entity.proposal_materialization;
        if (!request)
          throw new Error("Artifact Proposal参照がありません。Previewを開き直してください。");
        if (
          !Number.isInteger(request.entryIndex) ||
          request.entryIndex < 0 ||
          request.entryIndex >= artifactEntries.length
        ) {
          throw new Error("Artifact Proposal参照が不正です。Previewを開き直してください。");
        }
        const candidateId = stableProposalEntityId(
          currentProposal.id,
          "artifact",
          request.entryIndex,
        );
        if (candidate.entity.id !== candidateId)
          throw new Error("Artifact候補IDが正本と一致しません。");
        const normalized = validateArtifactProposal(artifactEntries[request.entryIndex]);
        const result = this.artifacts.materializeArtifactProposal({
          title: normalized.title,
          fileName: normalized.fileName,
          mediaType: normalized.mediaType,
          content: normalized.content,
          themeId: canonicalThemeId(this.repository, artifactEntries[request.entryIndex]),
          materializationKey: candidateId,
        });
        if (result.status === "needs_directory") {
          throw new Error("Artifact保存先が未設定です。Settingsで保存先を選んでください。");
        }
        if (result.created) createdPaths.push(result.file.storedPath);
        const web = isWebArtifact({
          filename: result.file.filename,
          mime_type: result.file.mimeType,
        });
        return {
          type: "artifact",
          entity: {
            id: candidateId,
            title: normalized.title,
            source_type: "ai_proposal",
            source_id: currentProposal.id,
            theme_id: canonicalThemeId(this.repository, artifactEntries[request.entryIndex]),
            description: text(artifactEntries[request.entryIndex].reason),
            generated_by: null,
            filename: result.file.filename,
            file_type: result.file.fileType,
            mime_type: result.file.mimeType,
            file_size: result.file.fileSize,
            stored_path: result.file.storedPath,
            original_path: null,
            storage_mode: "managed",
            copied_at: result.file.copiedAt,
            web_kind: web ? "self_contained_html" : null,
            web_entrypoint: web ? result.file.filename : null,
            web_execution_policy: web ? "sandboxed_interactive" : null,
          },
        } satisfies ProposalCandidate;
      });
      const resolvedCommand = {
        ...command,
        payload: {
          ...payload,
          proposal: { ...currentProposal, status: payload.proposal.status },
          candidates,
        },
      };
      if (
        candidates.length === 1 &&
        candidates[0].type === "note" &&
        this.commands.executeCanonicalNoteAiProposal &&
        this.artifacts.saveCanonicalNote
      ) {
        return this.commands.executeCanonicalNoteAiProposal(resolvedCommand, (note, companion) => {
          const current = this.repository.get("note", note.id);
          return this.artifacts.saveCanonicalNote!(
            {
              entity: note,
              snapshot: {
                owner: { recordType: "note", entityId: note.id },
                body: String(note.body_markdown || ""),
                expectedRevision: Number(current?.version || 0),
              },
              options: { source: "ai_proposal" },
            },
            companion,
          ) as Entity;
        });
      }
      return this.commands.execute(resolvedCommand);
    } catch (error) {
      for (const storedPath of createdPaths.reverse()) {
        try {
          this.artifacts.rollbackMaterializedArtifactProposal(storedPath);
        } catch {
          // Cleanup is best effort; the original command error remains primary.
        }
      }
      throw error;
    }
  }
}
