import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateArtifactProposal, validateSafeSvg } from "../../shared/proposalMedia.mjs";

const SCHEMA_VERSION = 1;
const MAX_PROPOSAL_BYTES = 1024 * 1024;
const PAYLOAD_TYPES = new Set(["items", "notes", "links", "knowledge_nodes", "sketches", "artifacts", "status_update"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePayload(payloadType, payload) {
  if (payloadType === "status_update") return;
  const entries = payload[payloadType];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) {
    throw new Error(`${payloadType}は1〜100件の配列にしてください。`);
  }
  for (const entry of entries) {
    if (!plainObject(entry)) throw new Error(`${payloadType}の各要素はJSON objectにしてください。`);
    if (!["create", "merge"].includes(entry.action)) {
      throw new Error(`${payloadType}のactionはcreateまたはmergeにしてください。`);
    }
    if (entry.action === "merge" && (!text(entry.target_id) || !Number.isInteger(entry.base_version))) {
      throw new Error(`${payloadType}のmergeにはtarget_idとbase_versionが必要です。`);
    }
    if (payloadType === "links" && !text(entry.url)) throw new Error("linksにはurlが必要です。");
    if (payloadType !== "links" && !text(entry.title)) throw new Error(`${payloadType}にはtitleが必要です。`);
    if (payloadType === "notes" && typeof entry.body !== "string") throw new Error("notesにはbodyが必要です。");
    if (payloadType === "sketches") validateSafeSvg(entry.svg);
    if (payloadType === "artifacts") validateArtifactProposal(entry);
  }
}

export function defaultMcpInboxPath(env = process.env) {
  if (env.TASKEN_MCP_INBOX_PATH) return path.resolve(env.TASKEN_MCP_INBOX_PATH);
  const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Tasken", "mcp-inbox");
}

export function validateMcpProposalEnvelope(value) {
  if (!plainObject(value)) throw new Error("Proposal envelopeはJSON objectにしてください。");
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROPOSAL_BYTES) {
    throw new Error("Proposalは1MB以下にしてください。");
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new Error(`未対応のProposal schemaです: ${String(value.schema_version)}`);
  }
  const id = text(value.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Proposal IDが不正です。");
  const sourceApp = text(value.source_app);
  if (!sourceApp || sourceApp.length > 120) throw new Error("source_appは1〜120文字にしてください。");
  const payloadType = text(value.payload_type);
  if (!PAYLOAD_TYPES.has(payloadType)) throw new Error("payload_typeが不正です。");
  if (!plainObject(value.payload)) throw new Error("payloadはJSON objectにしてください。");
  validatePayload(payloadType, value.payload);
  const createdAt = text(value.created_at);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error("created_atが不正です。");
  return {
    schema_version: SCHEMA_VERSION,
    id,
    created_at: createdAt,
    source: "mcp",
    source_app: sourceApp,
    payload_type: payloadType,
    payload: value.payload,
    request: plainObject(value.request) ? value.request : undefined,
  };
}

export function queueMcpProposal({
  payloadType,
  payload,
  sourceApp = "mcp-client",
  request,
  inboxPath = defaultMcpInboxPath(),
}) {
  const envelope = validateMcpProposalEnvelope({
    schema_version: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: "mcp",
    source_app: sourceApp,
    payload_type: payloadType,
    payload,
    request,
  });
  fs.mkdirSync(inboxPath, { recursive: true });
  const filePath = path.join(inboxPath, `${envelope.created_at.replace(/[:.]/g, "-")}-${envelope.id}.json`);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporaryPath, filePath);
  return {
    proposal_id: envelope.id,
    status: "queued",
    payload_type: envelope.payload_type,
    inbox_path: inboxPath,
    message: "TaskenのAI連携にProposalとして送りました。TaskenでPreviewして採用してください。",
  };
}

export class McpProposalInboxService {
  constructor(repository, userDataPath, onImported = (_entities) => {}) {
    this.repository = repository;
    this.inboxPath = path.join(userDataPath, "mcp-inbox");
    this.rejectedPath = path.join(this.inboxPath, "rejected");
    this.onImported = onImported;
    this.timer = null;
  }

  start() {
    this.drain();
    if (!this.timer) this.timer = setInterval(() => this.drain(), 1500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    fs.mkdirSync(this.inboxPath, { recursive: true });
    const pendingFiles = fs.readdirSync(this.inboxPath)
      .filter((name) => name.endsWith(".json") && !name.endsWith(".error.json"));
    return {
      inboxPath: this.inboxPath,
      pendingFileCount: pendingFiles.length,
      rejectedPath: this.rejectedPath,
    };
  }

  drain() {
    fs.mkdirSync(this.inboxPath, { recursive: true });
    const files = fs.readdirSync(this.inboxPath)
      .filter((name) => name.endsWith(".json") && !name.endsWith(".error.json"))
      .sort();
    const imported = [];
    for (const name of files) {
      const filePath = path.join(this.inboxPath, name);
      try {
        const envelope = validateMcpProposalEnvelope(JSON.parse(fs.readFileSync(filePath, "utf8")));
        const existing = this.repository.get("ai_proposal", envelope.id, true);
        const entity = existing || this.repository.save("ai_proposal", {
          id: envelope.id,
          source: "mcp",
          source_app: envelope.source_app,
          payload_type: envelope.payload_type,
          payload: envelope.payload,
          request: envelope.request,
          status: "pending",
          received_at: new Date().toISOString(),
        }, { source: "mcp" });
        fs.unlinkSync(filePath);
        if (!existing) imported.push(entity);
      } catch (error) {
        this.rejectFile(filePath, error);
      }
    }
    if (imported.length) this.onImported(imported);
    return imported;
  }

  rejectFile(filePath, error) {
    fs.mkdirSync(this.rejectedPath, { recursive: true });
    const destination = path.join(this.rejectedPath, path.basename(filePath));
    fs.renameSync(filePath, destination);
    fs.writeFileSync(
      `${destination}.error.txt`,
      `${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`,
      "utf8",
    );
  }
}
