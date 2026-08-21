import type { ArtifactProposalMaterializeRequest, ArtifactProposalMaterializeResult } from "../../shared/attachments";
import type { CommandEnvelope, CommandReceipt } from "../../shared/applicationCommand";
import type { Entity } from "../../shared/types/workspace";
import { stableProposalEntityId } from "../../shared/proposalAcceptance.mjs";
import { isWebArtifact } from "../../shared/webArtifact.mjs";
import { validateArtifactProposal, validateSafeSvg } from "../../shared/proposalMedia.mjs";

interface CommandExecutor {
  execute(input: unknown): CommandReceipt;
  executeCanonicalNoteAiProposal?(
    input: unknown,
    saveCanonicalNote: (note: Entity, companion: unknown) => Entity,
  ): CommandReceipt;
}

interface ArtifactMaterializer {
  materializeArtifactProposal(request: ArtifactProposalMaterializeRequest): ArtifactProposalMaterializeResult;
  rollbackMaterializedArtifactProposal(storedPath: string): void;
  saveCanonicalNote?(request: unknown, companion?: unknown): Record<string, unknown>;
}

interface ProposalRepository {
  get(type: string, id: string, includeDeleted?: boolean): Entity | null;
  list(type: string, includeDeleted?: boolean): Entity[];
}

interface ArtifactMaterializationReference {
  entryIndex: number;
  themeId?: string | null;
}

interface ProposalCandidate {
  type: string;
  entity: Entity & { proposal_materialization?: ArtifactMaterializationReference };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function canonicalThemeId(repository: ProposalRepository, entry: Record<string, unknown>, fallback: unknown = null): string | null {
  const requested = text(entry.theme).trim();
  if (!requested) return text(fallback).trim() || null;
  const theme = [...repository.list("project"), ...repository.list("theme")]
    .find((candidate) => candidate.id === requested || text(candidate.name) === requested || text(candidate.title) === requested);
  return theme?.id || null;
}

function assertCandidateIdentity(candidate: ProposalCandidate | undefined, type: string, id: string): void {
  if (!candidate || candidate.type !== type || candidate.entity.id !== id) {
    throw new Error("Proposal候補が正本と一致しません。Previewを開き直してください。");
  }
}

function rebuildCanonicalCandidates(
  repository: ProposalRepository,
  proposal: Entity,
  canonicalPayload: Record<string, unknown>,
  supplied: ProposalCandidate[],
): ProposalCandidate[] | null {
  const payloadType = text(proposal.payload_type);
  if (payloadType === "artifacts") return null;
  if (payloadType === "notes") {
    const entries = records(canonicalPayload.notes);
    if (entries.length !== 1 || supplied.length !== 1) throw new Error("Note Proposal候補が正本と一致しません。Previewを開き直してください。");
    const entry = entries[0];
    const targetId = text(entry.target_id);
    const current = targetId ? repository.get("note", targetId, true) : null;
    if (targetId && (!current || current.deleted_at)) throw new Error("採用対象のNoteがありません。Previewを開き直してください。");
    const id = current?.id || stableProposalEntityId(proposal.id, "note", 0);
    assertCandidateIdentity(supplied[0], "note", id);
    return [{
      type: "note",
      entity: {
        ...(current || {}),
        id,
        title: text(entry.title) || text(current?.title) || "無題",
        body_markdown: text(entry.body_markdown) || text(entry.body),
        note_type: text(entry.note_type) || text(current?.note_type) || "memo",
        theme_id: canonicalThemeId(repository, entry, current?.project_id || current?.theme_id),
        source_url: text(entry.source_url) || text(current?.source_url),
      },
    }];
  }
  if (payloadType === "knowledge_nodes") {
    const nodeEntries = records(canonicalPayload.knowledge_nodes);
    const edgeEntries = records(canonicalPayload.knowledge_edges);
    if (supplied.length !== nodeEntries.length + edgeEntries.length) {
      throw new Error("Knowledge Proposal候補が正本と一致しません。Previewを開き直してください。");
    }
    const result: ProposalCandidate[] = [];
    const tempIds = new Map<string, string>();
    nodeEntries.forEach((entry, index) => {
      const targetId = text(entry.target_id);
      const current = targetId ? repository.get("knowledge_node", targetId, true) : null;
      const id = current?.id || stableProposalEntityId(proposal.id, "knowledge_node", index);
      assertCandidateIdentity(supplied[index], "knowledge_node", id);
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
      const id = current?.id || stableProposalEntityId(proposal.id, "knowledge_edge", operationIndex);
      assertCandidateIdentity(supplied[operationIndex], "knowledge_edge", id);
      result.push({
        type: "knowledge_edge",
        entity: {
          ...(current || {}),
          id,
          source_node_id: text(entry.source_node_id) || tempIds.get(text(entry.source_temp_id)) || "",
          target_node_id: text(entry.target_node_id) || tempIds.get(text(entry.target_temp_id)) || "",
          relation_type: text(entry.relation_type) || text(current?.relation_type) || "supports",
          description: text(entry.description) || text(current?.description),
        },
      });
    });
    return result;
  }
  if (payloadType === "sketches") {
    const entries = records(canonicalPayload.sketches);
    if (supplied.length !== entries.length) throw new Error("Sketch Proposal候補が正本と一致しません。Previewを開き直してください。");
    return entries.map((entry, index) => {
      const id = stableProposalEntityId(proposal.id, "sketch", index);
      assertCandidateIdentity(supplied[index], "sketch", id);
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
            pages: [{
              id: stableProposalEntityId(proposal.id, "sketch_page", index),
              title: "1",
              width: 1200,
              height: 850,
              background: "dot",
              objects: [{
                id: stableProposalEntityId(proposal.id, "sketch_object", index),
                type: "image",
                color: "#000000",
                x: 40,
                y: 40,
                w: 1120,
                h: 770,
                data_url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
              }],
            }],
          },
        },
      };
    });
  }
  return supplied;
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

  execute(input: CommandEnvelope): CommandReceipt {
    if (input.name !== "ApplyAiProposal") return this.commands.execute(input);
    const payload = input.payload as { proposal?: Entity; candidates?: ProposalCandidate[] };
    if (!payload.proposal || !Array.isArray(payload.candidates)) return this.commands.execute(input);
    const proposalVersion = Number(payload.proposal.version || 0);
    const commandId = `${payload.proposal.id}:accept:v${proposalVersion}`;
    const existingEvent = this.repository.list("change_event", true).find((event) => event.command_id === commandId && typeof event.receipt_json === "string");
    if (existingEvent) {
      const receipt = JSON.parse(String(existingEvent.receipt_json)) as CommandReceipt;
      Object.defineProperty(receipt, "replayed", { value: true, enumerable: false });
      return receipt;
    }
    const currentProposal = this.repository.get("ai_proposal", payload.proposal.id);
    if (!currentProposal || currentProposal.status !== "pending") return this.commands.execute(input);
    if (Number(currentProposal.version || 0) !== proposalVersion) return this.commands.execute(input);
    const canonicalPayload = currentProposal.payload && typeof currentProposal.payload === "object" && !Array.isArray(currentProposal.payload)
      ? currentProposal.payload as Record<string, unknown>
      : {};
    const artifactEntries = Array.isArray(canonicalPayload.artifacts) ? canonicalPayload.artifacts : [];
    const command: CommandEnvelope = {
      ...input,
      commandId,
      issuedAt: String(currentProposal.received_at || currentProposal.created_at || currentProposal.updated_at || new Date(0).toISOString()),
    };
    const createdPaths: string[] = [];
    try {
      const canonicalCandidates = rebuildCanonicalCandidates(this.repository, currentProposal, canonicalPayload, payload.candidates);
      const candidates = canonicalCandidates || payload.candidates.map((candidate) => {
        if (candidate.type !== "artifact") return candidate;
        const request = candidate.entity.proposal_materialization;
        if (!request) throw new Error("Artifact Proposal参照がありません。Previewを開き直してください。");
        if (!Number.isInteger(request.entryIndex) || request.entryIndex < 0 || request.entryIndex >= artifactEntries.length) {
          throw new Error("Artifact Proposal参照が不正です。Previewを開き直してください。");
        }
        const candidateId = stableProposalEntityId(currentProposal.id, "artifact", request.entryIndex);
        assertCandidateIdentity(candidate, "artifact", candidateId);
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
        const web = isWebArtifact({ filename: result.file.filename, mime_type: result.file.mimeType });
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
      const resolvedCommand = { ...command, payload: { ...payload, proposal: { ...currentProposal, status: payload.proposal.status }, candidates } };
      if (candidates.length === 1 && candidates[0].type === "note"
        && this.commands.executeCanonicalNoteAiProposal && this.artifacts.saveCanonicalNote) {
        return this.commands.executeCanonicalNoteAiProposal(resolvedCommand, (note, companion) => {
          const current = this.repository.get("note", note.id);
          return this.artifacts.saveCanonicalNote!({
            entity: note,
            snapshot: {
              owner: { recordType: "note", entityId: note.id },
              body: String(note.body_markdown || ""),
              expectedRevision: Number(current?.version || 0),
            },
            options: { source: "ai_proposal" },
          }, companion) as Entity;
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
