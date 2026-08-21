import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateArtifactProposal, validateSafeSvg } from "../../src/shared/proposalMedia.mjs";
import { normalizeExternalReferences } from "../../src/shared/externalReference.mjs";
import { normalizeRepositoryContext, publicRepositoryContext } from "../../src/shared/repositoryContext.mjs";

const SCHEMA_VERSION = 1;
const MAX_PROPOSAL_BYTES = 1024 * 1024;
const PAYLOAD_TYPES = new Set(["items", "notes", "links", "knowledge_nodes", "sketches", "artifacts", "status_update", "task_work", "repository_contexts"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const TASK_WORK_REPOSITORY_CONTEXT_FIELDS = new Set(["repository_context_id", "provider", "repository_slug", "branch"]);
const TASK_WORK_REPOSITORY_PROVIDERS = new Set(["github", "gitlab", "azure_devops", "local", "generic_git", "unknown"]);

function normalizeTaskWorkRepositoryContext(value) {
  if (value == null) return null;
  if (!plainObject(value)) throw new Error("task_work.repository_contextが不正です。");
  const unknown = Object.keys(value).filter((field) => !TASK_WORK_REPOSITORY_CONTEXT_FIELDS.has(field));
  if (unknown.length) throw new Error(`task_work.repository_contextに非公開fieldは指定できません: ${unknown.join(", ")}`);
  const repositoryContext = {};
  const repositoryContextId = text(value.repository_context_id);
  const provider = text(value.provider);
  const repositorySlug = text(value.repository_slug);
  const branch = text(value.branch);
  if (repositoryContextId) {
    if (repositoryContextId.length > 200) throw new Error("repository_context_idは200文字以内で入力してください。");
    repositoryContext.repository_context_id = repositoryContextId;
  }
  if (provider) {
    if (!TASK_WORK_REPOSITORY_PROVIDERS.has(provider)) throw new Error("repository_context.providerが不正です。");
    repositoryContext.provider = provider;
  }
  if (repositorySlug) {
    if (repositorySlug.length > 500 || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(repositorySlug)) throw new Error("repository_context.repository_slugが不正です。");
    repositoryContext.repository_slug = repositorySlug;
  }
  if (branch) {
    if (branch.length > 500 || /[\x00-\x1f\x7f]/.test(branch)) throw new Error("repository_context.branchが不正です。");
    repositoryContext.branch = branch;
  }
  return Object.keys(repositoryContext).length ? repositoryContext : null;
}

function payloadDigest(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function proposalIdForIdempotency(sourceApp, payloadType, idempotencyKey) {
  const hash = crypto.createHash("sha256").update(`${sourceApp}\0${payloadType}\0${idempotencyKey}`).digest("hex");
  const uuidHex = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`;
}

function validatePayload(payloadType, payload) {
  if (payloadType === "status_update") return;
  const entries = payload[payloadType];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100) {
    throw new Error(`${payloadType}は1〜100件の配列にしてください。`);
  }
  if (payloadType === "task_work") {
    payload[payloadType] = entries.map((entry) => {
      if (!plainObject(entry)) throw new Error("task_workの各要素はJSON objectにしてください。");
      if (!text(entry.task_id) || !["start", "append_receipt", "report_done", "report_blocked"].includes(entry.action)) {
        throw new Error("task_workにはtask_idとstart/append_receipt/report_done/report_blockedのactionが必要です。");
      }
      if (!Number.isInteger(entry.expected_version) || entry.expected_version < 0) throw new Error("task_work.expected_versionが不正です。");
      if (!text(entry.caller) || text(entry.caller).length > 200) throw new Error("task_work.callerは1〜200文字で入力してください。");
      if (entry.source_session != null && text(entry.source_session).length > 200) throw new Error("task_work.source_sessionは200文字以内で入力してください。");
      if (["append_receipt", "report_done", "report_blocked"].includes(entry.action)) {
        if (!text(entry.executor_kind) || !["self", "human", "ai_agent", "external", "unknown"].includes(entry.executor_kind)) throw new Error("task_work.executor_kindが不正です。");
        if (!text(entry.executor_label) || !text(entry.summary)) throw new Error("task_workのReceiptにはexecutor_labelとsummaryが必要です。");
        for (const field of ["completed_items", "changed_or_created_items", "verification", "remaining_work"]) {
          if (entry[field] != null && (!Array.isArray(entry[field]) || entry[field].length > 100 || entry[field].some((item) => !text(item)))) throw new Error(`task_work.${field}が不正です。`);
        }
      }
      const normalized = { ...entry };
      normalized.repository_context = normalizeTaskWorkRepositoryContext(entry.repository_context);
      if (entry.external_references != null) {
        if (!["append_receipt", "report_done", "report_blocked"].includes(entry.action)) throw new Error("external_referencesはReceipt報告にだけ指定できます。");
        normalized.external_references = normalizeExternalReferences(entry.external_references);
      }
      return normalized;
    });
    return;
  }
  if (payloadType === "repository_contexts") {
    payload[payloadType] = entries.map((entry) => {
      if (!plainObject(entry)) throw new Error("repository_contextsの各要素はJSON objectにしてください。");
      if (!['create', 'merge'].includes(entry.action)) throw new Error("repository_contextsのactionはcreateまたはmergeにしてください。");
      if (!text(entry.label)) throw new Error("repository_contextsにはlabelが必要です。");
      if (entry.action === "merge" && (!text(entry.target_id) || !Number.isInteger(entry.base_version))) {
        throw new Error("repository_contextsのmergeにはtarget_idとbase_versionが必要です。");
      }
      const normalized = normalizeRepositoryContext(entry);
      const publicNormalized = publicRepositoryContext(normalized);
      if (normalized.provider === "local" || String(normalized.canonical_identity || "").startsWith("local:")) {
        throw new Error("local repository contextはprivate pathを含むためMCP Proposalでは作成できません。TaskenのUIから登録してください。");
      }
      return {
        action: entry.action,
        ...(entry.target_id ? { target_id: text(entry.target_id) } : {}),
        ...(entry.base_version != null ? { base_version: entry.base_version } : {}),
        ...publicNormalized,
        reason: text(entry.reason),
      };
    });
    return;
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
  idempotencyKey,
  inboxPath = defaultMcpInboxPath(),
}) {
  const normalizedIdempotencyKey = text(idempotencyKey);
  if (normalizedIdempotencyKey.length > 200) throw new Error("idempotency_keyは200文字以内で入力してください。");
  // Validatorのnormalizationで呼び出し元payloadを変えず、digestは実際に
  // Inboxへ保存するcanonical payloadから計算する。
  const normalizedPayload = JSON.parse(JSON.stringify(payload));
  validatePayload(payloadType, normalizedPayload);
  const digest = payloadDigest(normalizedPayload);
  const envelope = validateMcpProposalEnvelope({
    schema_version: SCHEMA_VERSION,
    id: normalizedIdempotencyKey
      ? proposalIdForIdempotency(sourceApp, payloadType, normalizedIdempotencyKey)
      : crypto.randomUUID(),
    created_at: new Date().toISOString(),
    source: "mcp",
    source_app: sourceApp,
    payload_type: payloadType,
    payload: normalizedPayload,
    request: {
      ...(plainObject(request) ? request : {}),
      ...(normalizedIdempotencyKey ? { idempotency_key: normalizedIdempotencyKey } : {}),
      payload_digest: digest,
    },
  });
  fs.mkdirSync(inboxPath, { recursive: true });
  const filePath = path.join(inboxPath, normalizedIdempotencyKey
    ? `${envelope.id}.json`
    : `${envelope.created_at.replace(/[:.]/g, "-")}-${envelope.id}.json`);
  if (fs.existsSync(filePath)) {
    const existing = validateMcpProposalEnvelope(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (existing.request?.payload_digest !== digest) throw new Error("同じidempotency_keyへ異なる内容を送信できません。");
    return {
      proposal_id: existing.id,
      status: "duplicate",
      payload_type: existing.payload_type,
      inbox_path: inboxPath,
      message: "同じidempotency_keyのProposalはすでに受信済みです。",
    };
  }
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
        if (existing && existing.request?.payload_digest !== envelope.request?.payload_digest) {
          throw new Error("同じProposal IDへ異なるpayloadを取り込めません。");
        }
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
