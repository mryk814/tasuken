import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSnapshot } from "../src/main/services/snapshotService.mjs";
import {
  WorkspaceDatabase,
  workspaceEntityTypes,
} from "../src/main/repositories/workspaceRepository.mjs";
import { collectionKeyForEntityType } from "../src/shared/entityRegistry.mjs";
import { buildPersonalDefaultTheme } from "../src/shared/personalTheme.mjs";
import { resolveTaskenDatabasePath } from "../src/shared/taskenPaths.mjs";
import { buildActivityEvent } from "../src/shared/activityEvent.mjs";
import { queryActivityEvents } from "../src/shared/activityProjection.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
const fixtureRoot = path.join(repositoryRoot, "fixtures", "materials-informatics");
const localDatabasePath = resolveTaskenDatabasePath();

function id(group, number) {
  const prefixes = {
    theme: "a1000000",
    plan: "a2000000",
    task: "a3000000",
    waiting: "a4000000",
    schedule: "a5000000",
    note: "a6000000",
    resource: "a7000000",
    capture: "a8000000",
    knowledge: "a9000000",
    edge: "aa000000",
    reference: "ab000000",
    artifact: "ac000000",
    sketch: "ad000000",
    view: "ae000000",
    status: "af000000",
    dependency: "b0000000",
    proposal: "b1000000",
    source: "b2000000",
    import: "b3000000",
    event: "b4000000",
    repository: "b5000000",
    working_copy: "b6000000",
    session: "b7000000",
  };
  return `${prefixes[group]}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const theme = {
  personal: "theme-personal-default",
  llzo: id("theme", 1),
  aluminum: id("theme", 2),
};

const plan = {
  llzoProgram: id("plan", 1),
  dataFoundation: id("plan", 2),
  baselineComplete: id("plan", 3),
  activeLearning: id("plan", 4),
  candidateBatch: id("plan", 5),
  validation: id("plan", 6),
  interimReport: id("plan", 7),
  alProgram: id("plan", 8),
  alData: id("plan", 9),
  alModel: id("plan", 10),
  alReview: id("plan", 11),
};

const task = {
  xrdBaseline: id("task", 1),
  cleanDataset: id("task", 2),
  unitAudit: id("task", 3),
  trainGp: id("task", 4),
  candidateReview: id("task", 5),
  weighCandidates: id("task", 6),
  sinterCandidates: id("task", 7),
  eisMeasure: id("task", 8),
  xrdCandidates: id("task", 9),
  updateModel: id("task", 10),
  labSafety: id("task", 11),
  weeklyBackup: id("task", 12),
  conferenceAbstract: id("task", 13),
  alImport: id("task", 14),
  alFeatures: id("task", 15),
  alBaseline: id("task", 16),
  alExplain: id("task", 17),
  alMeeting: id("task", 18),
  literatureSweep: id("task", 19),
  electrodeOrder: id("task", 20),
  uncertaintyCheck: id("task", 21),
  oldCancelled: id("task", 22),
};

const note = {
  kickoff: id("note", 1),
  experiment: id("note", 2),
  analysis: id("note", 3),
  decision: id("note", 4),
  weekly: id("note", 5),
  reportPrompt: id("note", 6),
  daily1: id("note", 7),
  daily2: id("note", 8),
  focusEnded: id("note", 9),
  focusActive: id("note", 10),
  alMemo: id("note", 11),
  conference: id("note", 12),
};

const resource = {
  paper: id("resource", 1),
  matbench: id("resource", 2),
  chatGp: id("resource", 3),
  chatXrd: id("resource", 4),
  alPaper: id("resource", 5),
  archivedChat: id("resource", 6),
};

function record(value, createdAt, updatedAt = createdAt, source = "manual") {
  return {
    ...value,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    source,
    version: 1,
  };
}

const repository = {
  lab: id("repository", 1),
  notebook: id("repository", 2),
  plant: id("repository", 3),
  review: id("repository", 4),
};

const workingCopy = {
  lab: id("working_copy", 1),
  notebook: id("working_copy", 2),
  plant: id("working_copy", 3),
  review: id("working_copy", 4),
};

const agentSession = {
  lab: id("session", 1),
  notebook: id("session", 2),
  plant: id("session", 3),
  review: id("session", 4),
};

function activityEvent(number, entityType, entityId, eventKind, occurredAt, themeId, options = {}) {
  return record(
    buildActivityEvent({
      id: id("event", 100 + number),
      entity_type: entityType,
      entity_id: entityId,
      event_kind: eventKind,
      occurred_at: occurredAt,
      changed_at: occurredAt,
      change_type: "updated",
      after: { id: entityId, project_id: themeId, version: 1, state: "doing" },
      theme_ref: themeId ? { kind: "theme", id: themeId } : { kind: "none", id: null },
      actor: { kind: options.sessionId ? "ai_agent" : "user" },
      origin: options.sessionId
        ? { kind: "agent", session_id: options.sessionId }
        : { kind: "user" },
      summary: options.summary,
      changed_fields: options.changedFields || ["work_state"],
      metadata: {
        include_in_activity: true,
        dedupe_key: "materials-demo-day:" + number,
      },
    }),
    occurredAt,
    occurredAt,
    "manual",
  );
}

function relation(number, subjectType, subjectId, predicate, objectType, objectId, recordedAt) {
  const relationId = id("reference", 100 + number);
  return record(
    {
      id: relationId,
      assertion_id: relationId,
      subject: { type: subjectType, id: subjectId },
      predicate,
      object: { type: objectType, id: objectId },
      layer: "operational",
      status: "asserted",
      origin: "system_action",
      evidence_refs: [],
      confidence: null,
      metadata: { fixture: "materials-demo-day" },
      recorded_at: recordedAt,
      superseded_by_assertion_id: null,
      source_type: subjectType,
      source_id: subjectId,
      target_type: objectType,
      target_id: objectId,
      relation_type: predicate,
    },
    recordedAt,
    recordedAt,
    "development-fixture",
  );
}
function schedule(
  number,
  ownerType,
  ownerId,
  startDate,
  endDate,
  dateKind,
  confidence = "fixed",
  extras = {},
) {
  return record(
    {
      id: id("schedule", number),
      owner_type: ownerType,
      owner_id: ownerId,
      start_date: startDate,
      end_date: endDate,
      date_kind: dateKind,
      confidence,
      granularity: extras.granularity || "day",
      range_semantics: extras.range_semantics ?? null,
      baseline_start: extras.baseline_start || null,
      baseline_end: extras.baseline_end || null,
      actual_start: extras.actual_start || null,
      actual_end: extras.actual_end || null,
    },
    extras.created_at || "2026-07-01T00:00:00.000Z",
    extras.updated_at,
  );
}

function buildSketchDocument(kind) {
  if (kind === "loop") {
    return {
      schema_version: 1,
      mode: "page",
      pages: [
        {
          id: "page-loop",
          title: "探索ループ",
          width: 1200,
          height: 850,
          background: "dot",
          objects: [
            {
              id: "txt-1",
              type: "text",
              color: "#211e1d",
              x: 90,
              y: 105,
              text: "既知データ\n組成・焼成・特性",
              font_size: 28,
            },
            {
              id: "box-1",
              type: "shape",
              shape: "rounded_rectangle",
              color: "#8A2F3B",
              width: 3,
              x: 65,
              y: 75,
              w: 260,
              h: 130,
            },
            {
              id: "txt-2",
              type: "text",
              color: "#211e1d",
              x: 470,
              y: 105,
              text: "Gaussian Process\n予測 + 不確かさ",
              font_size: 28,
            },
            {
              id: "box-2",
              type: "shape",
              shape: "rounded_rectangle",
              color: "#8A2F3B",
              width: 3,
              x: 445,
              y: 75,
              w: 270,
              h: 130,
            },
            {
              id: "txt-3",
              type: "text",
              color: "#211e1d",
              x: 855,
              y: 105,
              text: "候補選択\nExpected Improvement",
              font_size: 28,
            },
            {
              id: "box-3",
              type: "shape",
              shape: "rounded_rectangle",
              color: "#8A2F3B",
              width: 3,
              x: 825,
              y: 75,
              w: 300,
              h: 130,
            },
            {
              id: "arrow-1",
              type: "shape",
              shape: "arrow",
              color: "#8A2F3B",
              width: 4,
              x: 330,
              y: 130,
              w: 105,
              h: 0,
            },
            {
              id: "arrow-2",
              type: "shape",
              shape: "arrow",
              color: "#8A2F3B",
              width: 4,
              x: 720,
              y: 130,
              w: 95,
              h: 0,
            },
            {
              id: "txt-4",
              type: "text",
              color: "#211e1d",
              x: 855,
              y: 520,
              text: "合成・XRD・EIS",
              font_size: 30,
            },
            {
              id: "box-4",
              type: "shape",
              shape: "rounded_rectangle",
              color: "#C46A2D",
              width: 4,
              x: 825,
              y: 485,
              w: 300,
              h: 120,
            },
            {
              id: "arrow-3",
              type: "shape",
              shape: "arrow",
              color: "#8A2F3B",
              width: 4,
              x: 975,
              y: 215,
              w: 0,
              h: 260,
            },
            {
              id: "arrow-4",
              type: "shape",
              shape: "bidirectional_arrow",
              color: "#8A2F3B",
              width: 4,
              x: 330,
              y: 545,
              w: 485,
              h: 0,
            },
            {
              id: "txt-5",
              type: "text",
              color: "#211e1d",
              x: 80,
              y: 500,
              text: "データ更新\n外れ値とロット差も残す",
              font_size: 28,
            },
            {
              id: "box-5",
              type: "shape",
              shape: "sticky_note",
              color: "#C46A2D",
              width: 3,
              x: 55,
              y: 465,
              w: 280,
              h: 150,
            },
          ],
        },
      ],
    };
  }
  return {
    schema_version: 1,
    mode: "infinite",
    viewport: { x: -80, y: -40, zoom: 0.82 },
    pages: [
      {
        id: "page-process",
        title: "焼結プロセス",
        width: 2400,
        height: 1600,
        background: "grid",
        objects: [
          {
            id: "p-t1",
            type: "text",
            color: "#211e1d",
            x: 150,
            y: 170,
            text: "原料秤量",
            font_size: 32,
          },
          {
            id: "p-b1",
            type: "shape",
            shape: "rectangle",
            color: "#8A2F3B",
            width: 3,
            x: 115,
            y: 130,
            w: 250,
            h: 120,
          },
          {
            id: "p-t2",
            type: "text",
            color: "#211e1d",
            x: 550,
            y: 170,
            text: "混合・粉砕",
            font_size: 32,
          },
          {
            id: "p-b2",
            type: "shape",
            shape: "rectangle",
            color: "#8A2F3B",
            width: 3,
            x: 515,
            y: 130,
            w: 250,
            h: 120,
          },
          {
            id: "p-t3",
            type: "text",
            color: "#211e1d",
            x: 950,
            y: 170,
            text: "成形",
            font_size: 32,
          },
          {
            id: "p-b3",
            type: "shape",
            shape: "rectangle",
            color: "#8A2F3B",
            width: 3,
            x: 915,
            y: 130,
            w: 250,
            h: 120,
          },
          {
            id: "p-t4",
            type: "text",
            color: "#211e1d",
            x: 1350,
            y: 170,
            text: "焼成 1140–1160℃",
            font_size: 32,
          },
          {
            id: "p-b4",
            type: "shape",
            shape: "rectangle",
            color: "#C46A2D",
            width: 4,
            x: 1300,
            y: 130,
            w: 340,
            h: 120,
          },
          {
            id: "p-a1",
            type: "shape",
            shape: "arrow",
            color: "#8A2F3B",
            width: 4,
            x: 375,
            y: 190,
            w: 130,
            h: 0,
          },
          {
            id: "p-a2",
            type: "shape",
            shape: "arrow",
            color: "#8A2F3B",
            width: 4,
            x: 775,
            y: 190,
            w: 130,
            h: 0,
          },
          {
            id: "p-a3",
            type: "shape",
            shape: "arrow",
            color: "#8A2F3B",
            width: 4,
            x: 1175,
            y: 190,
            w: 115,
            h: 0,
          },
          {
            id: "p-note",
            type: "text",
            color: "#8A2F3B",
            x: 1310,
            y: 320,
            text: "Li損失をロットごとに追う\n→ 焼成前後の質量を必須記録",
            font_size: 28,
          },
        ],
      },
    ],
  };
}

function buildWorkspace(managedDirectory) {
  const workspace = Object.fromEntries(
    workspaceEntityTypes.map((type) => [collectionKeyForEntityType(type), []]),
  );
  const put = (type, ...records) => workspace[collectionKeyForEntityType(type)].push(...records);

  put(
    "theme",
    buildPersonalDefaultTheme("2026-06-02T00:15:00.000Z"),
    record(
      {
        id: theme.llzo,
        name: "Ta置換LLZO 固体電解質探索",
        code: "MI-LLZO-26",
        description:
          "組成・焼成条件・微構造から室温Liイオン伝導度を高める。ベイズ最適化で候補提案と実験を反復する。",
        status: "active",
        color: "chart-1",
        group: "材料インフォマティクス",
        storage_root: path.join(managedDirectory, "MI-LLZO-26"),
        ai_visibility: ["coding_agent"],
        repository_context_ids: [repository.lab, repository.notebook],
        primary_repository_context_id: repository.lab,
      },
      "2026-06-03T01:00:00.000Z",
    ),
    record(
      {
        id: theme.aluminum,
        name: "再生Al-Mg-Si 熱処理最適化",
        code: "CIRC-AL-07",
        description: "スクラップ由来の組成変動を含め、時効条件と強度・導電率のPareto最適化を行う。",
        status: "paused",
        color: "chart-4",
        group: "サーキュラーマテリアル",
        storage_root: path.join(managedDirectory, "CIRC-AL-07"),
        repository_context_ids: [repository.plant, repository.review],
        primary_repository_context_id: repository.plant,
      },
      "2026-06-12T02:30:00.000Z",
    ),
  );

  put(
    "project",
    record(
      {
        id: theme.llzo,
        name: "Ta置換LLZO 固体電解質探索",
        state: "active",
        code: "MI-LLZO-26",
        description: "Fixture研究Theme",
        color: "chart-1",
        group: "材料インフォマティクス",
        repository_context_ids: [repository.lab, repository.notebook],
        primary_repository_context_id: repository.lab,
      },
      "2026-06-03T01:00:00.000Z",
    ),
    record(
      {
        id: theme.aluminum,
        name: "再生Al-Mg-Si 熱処理最適化",
        state: "paused",
        code: "CIRC-AL-07",
        description: "Fixture研究Theme",
        color: "chart-4",
        group: "サーキュラーマテリアル",
        repository_context_ids: [repository.plant, repository.review],
        primary_repository_context_id: repository.plant,
      },
      "2026-06-12T02:30:00.000Z",
    ),
  );

  put(
    "repository_context",
    record(
      {
        id: repository.lab,
        label: "Fixture Lab",
        provider: "generic_git",
        canonical_url: "https://example.invalid/tasken-fixture-lab",
        repository_slug: "tasken-fixture-lab",
        active: true,
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T00:00:00.000Z",
      "development-fixture",
    ),
    record(
      {
        id: repository.notebook,
        label: "Fixture Notebook",
        provider: "generic_git",
        canonical_url: "https://example.invalid/tasken-fixture-notebook",
        repository_slug: "tasken-fixture-notebook",
        active: true,
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T00:00:00.000Z",
      "development-fixture",
    ),
    record(
      {
        id: repository.plant,
        label: "Fixture Plant",
        provider: "generic_git",
        canonical_url: "https://example.invalid/tasken-fixture-plant",
        repository_slug: "tasken-fixture-plant",
        active: true,
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T00:00:00.000Z",
      "development-fixture",
    ),
    record(
      {
        id: repository.review,
        label: "Fixture Review",
        provider: "generic_git",
        canonical_url: "https://example.invalid/tasken-fixture-review",
        repository_slug: "tasken-fixture-review",
        active: true,
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T00:00:00.000Z",
      "development-fixture",
    ),
  );

  put(
    "working_copy",
    record(
      {
        id: workingCopy.lab,
        repository_context_id: repository.lab,
        device_id: "fixture-device",
        storage_root_id: "fixture-root",
        worktree_identity: "fixture/lab",
        branch_hint: "fixture/lab",
        active: true,
        last_seen_at: "2026-08-28T08:30:00+09:00",
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T08:30:00+09:00",
      "development-fixture",
    ),
    record(
      {
        id: workingCopy.notebook,
        repository_context_id: repository.notebook,
        device_id: "fixture-device",
        storage_root_id: "fixture-root",
        worktree_identity: "fixture/notebook",
        branch_hint: "fixture/notebook",
        active: true,
        last_seen_at: "2026-08-28T10:20:00+09:00",
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T10:20:00+09:00",
      "development-fixture",
    ),
    record(
      {
        id: workingCopy.plant,
        repository_context_id: repository.plant,
        device_id: "fixture-device",
        storage_root_id: "fixture-root",
        worktree_identity: "fixture/plant",
        branch_hint: "fixture/plant",
        active: true,
        last_seen_at: "2026-08-28T13:30:00+09:00",
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T13:30:00+09:00",
      "development-fixture",
    ),
    record(
      {
        id: workingCopy.review,
        repository_context_id: repository.review,
        device_id: "fixture-device",
        storage_root_id: "fixture-root",
        worktree_identity: "fixture/review",
        branch_hint: "fixture/review",
        active: true,
        last_seen_at: "2026-08-28T14:10:00+09:00",
      },
      "2026-08-20T00:00:00.000Z",
      "2026-08-28T14:10:00+09:00",
      "development-fixture",
    ),
  );

  put(
    "agent_session",
    record(
      {
        id: agentSession.lab,
        started_at: "2026-08-28T08:30:00+09:00",
        ended_at: "2026-08-28T11:00:00+09:00",
        status: "completed",
        client_kind: "codex",
        source_session_id: "fixture-session-lab",
        intent: { summary: "集中実験と解析" },
        outcome: {
          summary: "実験条件の解析を一区切り",
          decisions: [],
          changed_items: [],
          verification: ["fixture"],
          remaining_work: [],
          next_suggested_action: null,
        },
      },
      "2026-08-28T08:30:00+09:00",
      "2026-08-28T11:00:00+09:00",
      "development-fixture",
    ),
    record(
      {
        id: agentSession.notebook,
        started_at: "2026-08-28T10:20:00+09:00",
        ended_at: "2026-08-28T10:50:00+09:00",
        status: "completed",
        client_kind: "claude_code",
        source_session_id: "fixture-session-notebook",
        intent: { summary: "解析ノートの補助確認" },
        outcome: {
          summary: "補助確認を完了",
          decisions: [],
          changed_items: [],
          verification: ["fixture"],
          remaining_work: [],
          next_suggested_action: null,
        },
      },
      "2026-08-28T10:20:00+09:00",
      "2026-08-28T10:50:00+09:00",
      "development-fixture",
    ),
    record(
      {
        id: agentSession.plant,
        started_at: "2026-08-28T13:30:00+09:00",
        ended_at: "2026-08-28T15:00:00+09:00",
        status: "completed",
        client_kind: "codex",
        source_session_id: "fixture-session-plant",
        intent: { summary: "製造条件の集中解析" },
        outcome: {
          summary: "製造条件の比較を一区切り",
          decisions: [],
          changed_items: [],
          verification: ["fixture"],
          remaining_work: [],
          next_suggested_action: null,
        },
      },
      "2026-08-28T13:30:00+09:00",
      "2026-08-28T15:00:00+09:00",
      "development-fixture",
    ),
    record(
      {
        id: agentSession.review,
        started_at: "2026-08-28T14:10:00+09:00",
        ended_at: "2026-08-28T14:40:00+09:00",
        status: "completed",
        client_kind: "cursor",
        source_session_id: "fixture-session-review",
        intent: { summary: "レビュー観点の補助解析" },
        outcome: {
          summary: "レビュー観点を整理",
          decisions: [],
          changed_items: [],
          verification: ["fixture"],
          remaining_work: [],
          next_suggested_action: null,
        },
      },
      "2026-08-28T14:10:00+09:00",
      "2026-08-28T14:40:00+09:00",
      "development-fixture",
    ),
  );

  put(
    "reference",
    relation(
      101,
      "agent_session",
      agentSession.lab,
      "worked_on",
      "project",
      theme.llzo,
      "2026-08-28T08:30:00+09:00",
    ),
    relation(
      102,
      "agent_session",
      agentSession.lab,
      "worked_on",
      "repository_context",
      repository.lab,
      "2026-08-28T08:30:00+09:00",
    ),
    relation(
      103,
      "agent_session",
      agentSession.lab,
      "executed_in",
      "working_copy",
      workingCopy.lab,
      "2026-08-28T08:30:00+09:00",
    ),
    relation(
      104,
      "agent_session",
      agentSession.notebook,
      "worked_on",
      "project",
      theme.llzo,
      "2026-08-28T10:20:00+09:00",
    ),
    relation(
      105,
      "agent_session",
      agentSession.notebook,
      "worked_on",
      "repository_context",
      repository.notebook,
      "2026-08-28T10:20:00+09:00",
    ),
    relation(
      106,
      "agent_session",
      agentSession.notebook,
      "executed_in",
      "working_copy",
      workingCopy.notebook,
      "2026-08-28T10:20:00+09:00",
    ),
    relation(
      107,
      "agent_session",
      agentSession.plant,
      "worked_on",
      "project",
      theme.aluminum,
      "2026-08-28T13:30:00+09:00",
    ),
    relation(
      108,
      "agent_session",
      agentSession.plant,
      "worked_on",
      "repository_context",
      repository.plant,
      "2026-08-28T13:30:00+09:00",
    ),
    relation(
      109,
      "agent_session",
      agentSession.plant,
      "executed_in",
      "working_copy",
      workingCopy.plant,
      "2026-08-28T13:30:00+09:00",
    ),
    relation(
      110,
      "agent_session",
      agentSession.review,
      "worked_on",
      "project",
      theme.aluminum,
      "2026-08-28T14:10:00+09:00",
    ),
    relation(
      111,
      "agent_session",
      agentSession.review,
      "worked_on",
      "repository_context",
      repository.review,
      "2026-08-28T14:10:00+09:00",
    ),
    relation(
      112,
      "agent_session",
      agentSession.review,
      "executed_in",
      "working_copy",
      workingCopy.review,
      "2026-08-28T14:10:00+09:00",
    ),
  );
  put(
    "plan_node",
    record(
      {
        id: plan.llzoProgram,
        project_id: theme.llzo,
        parent_plan_node_id: null,
        title: "2026年度 LLZO探索サイクル",
        description: "データ整備から候補検証までを3サイクル回す。",
        type: "phase",
        state: "active",
        sort_order: 10,
      },
      "2026-06-03T01:10:00.000Z",
    ),
    record(
      {
        id: plan.dataFoundation,
        project_id: theme.llzo,
        parent_plan_node_id: plan.llzoProgram,
        title: "既存データ統合と基準モデル",
        type: "phase",
        state: "done",
        sort_order: 10,
      },
      "2026-06-03T01:15:00.000Z",
      "2026-07-03T08:00:00.000Z",
    ),
    record(
      {
        id: plan.baselineComplete,
        project_id: theme.llzo,
        parent_plan_node_id: plan.llzoProgram,
        title: "Baseline dataset v1 固定",
        type: "milestone",
        state: "done",
        sort_order: 20,
      },
      "2026-06-03T01:20:00.000Z",
      "2026-07-03T08:05:00.000Z",
    ),
    record(
      {
        id: plan.activeLearning,
        project_id: theme.llzo,
        parent_plan_node_id: plan.llzoProgram,
        title: "Active learning cycle 2",
        type: "phase",
        state: "active",
        sort_order: 30,
      },
      "2026-07-04T00:00:00.000Z",
    ),
    record(
      {
        id: plan.candidateBatch,
        project_id: theme.llzo,
        parent_plan_node_id: plan.activeLearning,
        title: "候補バッチ #2 合成",
        type: "deliverable",
        state: "active",
        sort_order: 10,
      },
      "2026-07-28T00:00:00.000Z",
    ),
    record(
      {
        id: plan.validation,
        project_id: theme.llzo,
        parent_plan_node_id: plan.llzoProgram,
        title: "候補検証とモデル更新",
        type: "phase",
        state: "planned",
        sort_order: 40,
      },
      "2026-07-04T00:05:00.000Z",
    ),
    record(
      {
        id: plan.interimReport,
        project_id: theme.llzo,
        parent_plan_node_id: plan.llzoProgram,
        title: "研究会 中間報告",
        type: "milestone",
        state: "planned",
        sort_order: 50,
      },
      "2026-06-03T01:25:00.000Z",
    ),
    record(
      {
        id: plan.alProgram,
        project_id: theme.aluminum,
        parent_plan_node_id: null,
        title: "再生Al 条件探索 PoC",
        type: "phase",
        state: "active",
        sort_order: 10,
      },
      "2026-06-12T02:40:00.000Z",
    ),
    record(
      {
        id: plan.alData,
        project_id: theme.aluminum,
        parent_plan_node_id: plan.alProgram,
        title: "溶解ロットデータ整備",
        type: "phase",
        state: "done",
        sort_order: 10,
      },
      "2026-06-12T02:45:00.000Z",
      "2026-07-22T04:00:00.000Z",
    ),
    record(
      {
        id: plan.alModel,
        project_id: theme.aluminum,
        parent_plan_node_id: plan.alProgram,
        title: "Paretoモデル構築",
        type: "phase",
        state: "active",
        sort_order: 20,
      },
      "2026-07-23T01:00:00.000Z",
    ),
    record(
      {
        id: plan.alReview,
        project_id: theme.aluminum,
        parent_plan_node_id: plan.alProgram,
        title: "製造部レビュー",
        type: "milestone",
        state: "planned",
        sort_order: 30,
      },
      "2026-07-23T01:05:00.000Z",
    ),
  );

  const checklist = (prefix, values, doneCount = 0) =>
    values.map((title, index) => ({
      id: `${prefix}-${index + 1}`,
      title,
      done: index < doneCount,
      sort_order: index,
      completed_at: index < doneCount ? "2026-08-07T06:00:00.000Z" : null,
    }));
  put(
    "task",
    record(
      {
        id: task.xrdBaseline,
        project_id: theme.llzo,
        plan_node_id: plan.dataFoundation,
        title: "既存XRD 128試料の相ラベルを再確認",
        description: "cubic / tetragonal / impurity を統一基準で付け直す。",
        state: "done",
        priority: "high",
        completed_at: "2026-06-24T07:20:00.000Z",
        completion_note: "曖昧な7試料はunknownとして残し、学習から除外した。",
      },
      "2026-06-08T00:30:00.000Z",
      "2026-06-24T07:20:00.000Z",
    ),
    record(
      {
        id: task.cleanDataset,
        project_id: theme.llzo,
        plan_node_id: plan.dataFoundation,
        title: "伝導度データの測定温度を25℃へ換算",
        state: "done",
        priority: "normal",
        completed_at: "2026-06-29T05:00:00.000Z",
        completion_note: "Arrhenius換算式と元温度を列として保持。",
      },
      "2026-06-10T01:00:00.000Z",
      "2026-06-29T05:00:00.000Z",
    ),
    record(
      {
        id: task.unitAudit,
        project_id: theme.llzo,
        plan_node_id: plan.dataFoundation,
        title: "組成特徴量のmol% / at%混在を監査",
        state: "done",
        priority: "normal",
        completed_at: "2026-07-03T08:00:00.000Z",
      },
      "2026-06-21T02:00:00.000Z",
      "2026-07-03T08:00:00.000Z",
    ),
    record(
      {
        id: task.trainGp,
        project_id: theme.llzo,
        plan_node_id: plan.activeLearning,
        title: "GP baselineを再学習してLOCO-CVを確認",
        description: "ロット単位のGroupKFold。目的変数はlog10(σ25℃)。",
        state: "done",
        priority: "high",
        completed_at: "2026-08-04T09:10:00.000Z",
        completion_note: "MAE 0.18 decade。L2407-Bで負側バイアスあり。",
        checklist_items: checklist(
          "gp",
          [
            "欠損処理を固定",
            "GroupKFoldをロットで分割",
            "予測区間被覆率を確認",
            "モデルカードを更新",
          ],
          4,
        ),
      },
      "2026-07-24T00:30:00.000Z",
      "2026-08-04T09:10:00.000Z",
    ),
    record(
      {
        id: task.candidateReview,
        project_id: theme.llzo,
        plan_node_id: plan.activeLearning,
        title: "提案候補3条件を実験制約と照合",
        state: "review",
        priority: "high",
        checklist_items: checklist(
          "review",
          ["Li原料在庫", "炉の上限温度", "既知の二次相領域", "候補間距離"],
          3,
        ),
      },
      "2026-08-05T01:00:00.000Z",
      "2026-08-08T00:10:00.000Z",
    ),
    record(
      {
        id: task.weighCandidates,
        project_id: theme.llzo,
        plan_node_id: plan.candidateBatch,
        parent_task_id: task.sinterCandidates,
        title: "候補3条件の原料を秤量",
        state: "doing",
        priority: "high",
        planned_start_time: "09:30",
        planned_duration_minutes: 90,
        checklist_items: checklist(
          "weigh",
          ["秤量表を印刷", "候補1", "候補2", "候補3", "残量を記録"],
          2,
        ),
      },
      "2026-08-07T01:20:00.000Z",
      "2026-08-08T00:20:00.000Z",
    ),
    record(
      {
        id: task.sinterCandidates,
        project_id: theme.llzo,
        plan_node_id: plan.candidateBatch,
        title: "候補バッチ #2を合成・焼成",
        description: "候補3条件＋baseline 1条件。",
        state: "doing",
        priority: "high",
        planning_shelf: "this_week",
        planned_duration_minutes: 360,
        checklist_items: checklist(
          "sinter",
          ["原料秤量", "混合", "成形", "焼成", "質量変化記録"],
          1,
        ),
      },
      "2026-08-06T03:00:00.000Z",
      "2026-08-08T00:25:00.000Z",
    ),
    record(
      {
        id: task.eisMeasure,
        project_id: theme.llzo,
        plan_node_id: plan.validation,
        title: "候補バッチのEIS測定",
        state: "todo",
        priority: "high",
        planning_shelf: "this_week",
        checklist_items: checklist(
          "eis",
          ["Auスパッタ", "25℃平衡", "周波数掃引", "等価回路fit", "生データ保存"],
          0,
        ),
      },
      "2026-08-06T03:10:00.000Z",
    ),
    record(
      {
        id: task.xrdCandidates,
        project_id: theme.llzo,
        plan_node_id: plan.validation,
        title: "候補バッチのXRD測定と相同定",
        state: "waiting",
        priority: "normal",
      },
      "2026-08-06T03:15:00.000Z",
    ),
    record(
      {
        id: task.updateModel,
        project_id: theme.llzo,
        plan_node_id: plan.validation,
        title: "cycle 2結果を追加してposteriorを更新",
        state: "todo",
        priority: "normal",
        planning_shelf: "backlog",
      },
      "2026-08-06T03:20:00.000Z",
    ),
    record(
      {
        id: task.labSafety,
        project_id: theme.personal,
        title: "実験室安全点検チェックシートを提出",
        state: "todo",
        priority: "high",
      },
      "2026-08-01T00:00:00.000Z",
    ),
    record(
      {
        id: task.weeklyBackup,
        project_id: theme.personal,
        title: "測定PCのデータを研究NASへ同期",
        state: "todo",
        priority: "normal",
        repeat_rule: {
          frequency: "weekly",
          interval: 1,
          weekdays: [5],
          next_from: "scheduled",
          until: null,
        },
      },
      "2026-07-01T00:00:00.000Z",
    ),
    record(
      {
        id: task.conferenceAbstract,
        project_id: theme.llzo,
        title: "電池討論会要旨の初稿を作る",
        state: "todo",
        priority: "high",
        planning_shelf: "this_week",
      },
      "2026-07-30T01:00:00.000Z",
    ),
    record(
      {
        id: task.alImport,
        project_id: theme.aluminum,
        plan_node_id: plan.alData,
        title: "溶解ロット14件を統合",
        state: "done",
        priority: "normal",
        completed_at: "2026-07-22T04:00:00.000Z",
      },
      "2026-06-15T02:00:00.000Z",
      "2026-07-22T04:00:00.000Z",
    ),
    record(
      {
        id: task.alFeatures,
        project_id: theme.aluminum,
        plan_node_id: plan.alModel,
        title: "Mg/Si比と過剰Si量の派生特徴量を追加",
        state: "done",
        priority: "normal",
        completed_at: "2026-07-29T07:00:00.000Z",
      },
      "2026-07-23T01:20:00.000Z",
      "2026-07-29T07:00:00.000Z",
    ),
    record(
      {
        id: task.alBaseline,
        project_id: theme.aluminum,
        plan_node_id: plan.alModel,
        title: "強度・導電率のPareto frontを再計算",
        state: "doing",
        priority: "high",
      },
      "2026-07-29T07:10:00.000Z",
      "2026-08-07T05:30:00.000Z",
    ),
    record(
      {
        id: task.alExplain,
        project_id: theme.aluminum,
        plan_node_id: plan.alModel,
        title: "SHAPで高強度側の支配因子を説明",
        state: "todo",
        priority: "normal",
      },
      "2026-08-01T02:00:00.000Z",
    ),
    record(
      {
        id: task.alMeeting,
        project_id: theme.aluminum,
        plan_node_id: plan.alReview,
        title: "製造部レビュー資料を共有",
        state: "waiting",
        priority: "normal",
      },
      "2026-08-02T02:00:00.000Z",
    ),
    record(
      {
        id: task.literatureSweep,
        project_id: theme.llzo,
        title: "LLZOのLi過剰量と相純度の文献を5報読む",
        state: "doing",
        priority: "normal",
        planning_shelf: "someday",
      },
      "2026-07-15T00:00:00.000Z",
    ),
    record(
      {
        id: task.electrodeOrder,
        project_id: theme.llzo,
        title: "Auターゲットの見積回答を確認",
        state: "waiting",
        priority: "high",
      },
      "2026-08-03T02:00:00.000Z",
    ),
    record(
      {
        id: task.uncertaintyCheck,
        project_id: theme.llzo,
        plan_node_id: plan.activeLearning,
        title: "予測区間のcoverage低下を調べる",
        state: "doing",
        priority: "high",
        planned_start_time: "13:30",
        planned_duration_minutes: 120,
      },
      "2026-08-07T06:00:00.000Z",
      "2026-08-08T00:35:00.000Z",
    ),
    record(
      {
        id: task.oldCancelled,
        project_id: theme.aluminum,
        title: "旧RandomForestモデルを再調整",
        state: "cancelled",
        priority: "normal",
        completion_note: "GP+多目的獲得関数へ一本化したため中止。",
      },
      "2026-06-20T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
    ),
  );

  put(
    "waiting",
    record(
      {
        id: id("waiting", 1),
        project_id: theme.llzo,
        task_id: task.xrdCandidates,
        title: "共通機器室のXRD測定枠",
        description: "候補バッチ4試料、通常測定。",
        waiting_for: "共通機器室 田中さん",
        next_action: "8/11までに返答がなければTeamsで確認",
        check_reminder_at: "2026-08-11T09:00",
        state: "waiting",
      },
      "2026-08-07T02:00:00.000Z",
    ),
    record(
      {
        id: id("waiting", 2),
        project_id: theme.llzo,
        task_id: task.electrodeOrder,
        title: "Auターゲット見積",
        waiting_for: "材料商事 営業担当",
        next_action: "見積受領後に購買申請",
        check_reminder_at: "2026-08-12T10:00",
        state: "waiting",
      },
      "2026-08-03T02:10:00.000Z",
    ),
    record(
      {
        id: id("waiting", 3),
        project_id: theme.aluminum,
        task_id: task.alMeeting,
        title: "製造部からレビュー参加者の返答",
        waiting_for: "製造技術G",
        next_action: "参加者確定後に資料リンクを送る",
        state: "waiting",
      },
      "2026-08-02T02:10:00.000Z",
    ),
    record(
      {
        id: id("waiting", 4),
        project_id: theme.llzo,
        title: "共同研究先からロットL2407-Bの粉末SEM",
        waiting_for: "東都大学 材料解析室",
        next_action: "受領後に粒径分布をbaselineへ追加",
        state: "received",
      },
      "2026-07-18T02:00:00.000Z",
      "2026-08-01T06:30:00.000Z",
    ),
  );

  put(
    "schedule",
    schedule(1, "plan_node", plan.llzoProgram, "2026-06-01", "2026-11-30", "range", "rough", {
      granularity: "month",
      range_semantics: "ongoing",
      baseline_start: "2026-06-01",
      baseline_end: "2026-11-30",
    }),
    schedule(2, "plan_node", plan.dataFoundation, "2026-06-03", "2026-07-03", "range", "fixed", {
      granularity: "week",
      range_semantics: "ongoing",
      actual_start: "2026-06-03",
      actual_end: "2026-07-03",
    }),
    schedule(3, "plan_node", plan.baselineComplete, "2026-07-03", "2026-07-03", "point", "fixed", {
      actual_start: "2026-07-03",
      actual_end: "2026-07-03",
    }),
    schedule(
      4,
      "plan_node",
      plan.activeLearning,
      "2026-07-04",
      "2026-08-21",
      "range",
      "tentative",
      {
        granularity: "week",
        range_semantics: "ongoing",
        baseline_start: "2026-07-01",
        baseline_end: "2026-08-15",
        actual_start: "2026-07-04",
      },
    ),
    schedule(5, "plan_node", plan.candidateBatch, "2026-08-07", "2026-08-12", "range", "fixed", {
      range_semantics: "ongoing",
      baseline_start: "2026-08-05",
      baseline_end: "2026-08-10",
      actual_start: "2026-08-07",
    }),
    schedule(6, "plan_node", plan.validation, "2026-08-13", "2026-09-04", "range", "tentative", {
      granularity: "week",
      range_semantics: "ongoing",
    }),
    schedule(7, "plan_node", plan.interimReport, "2026-09-18", "2026-09-18", "point", "fixed"),
    schedule(8, "plan_node", plan.alProgram, "2026-06-15", "2026-10-30", "range", "rough", {
      granularity: "month",
      range_semantics: "ongoing",
    }),
    schedule(9, "plan_node", plan.alData, "2026-06-15", "2026-07-22", "range", "fixed", {
      range_semantics: "ongoing",
      actual_start: "2026-06-15",
      actual_end: "2026-07-22",
    }),
    schedule(10, "plan_node", plan.alModel, "2026-07-23", "2026-09-04", "range", "tentative", {
      range_semantics: "ongoing",
      actual_start: "2026-07-23",
    }),
    schedule(11, "plan_node", plan.alReview, "2026-09-10", "2026-09-10", "point", "tentative"),
    schedule(12, "task", task.candidateReview, "2026-08-08", "2026-08-08", "deadline", "fixed"),
    schedule(13, "task", task.weighCandidates, "2026-08-08", "2026-08-08", "point", "fixed", {
      actual_start: "2026-08-08",
    }),
    schedule(14, "task", task.sinterCandidates, "2026-08-07", "2026-08-12", "range", "fixed", {
      range_semantics: "ongoing",
      actual_start: "2026-08-07",
    }),
    schedule(15, "task", task.eisMeasure, "2026-08-13", "2026-08-18", "range", "tentative", {
      range_semantics: "once_within_window",
    }),
    schedule(16, "task", task.xrdCandidates, "2026-08-13", "2026-08-15", "range", "tentative", {
      range_semantics: "once_within_window",
    }),
    schedule(17, "task", task.updateModel, null, null, "unknown", "rough"),
    schedule(18, "task", task.labSafety, "2026-08-06", "2026-08-06", "deadline", "fixed"),
    schedule(19, "task", task.weeklyBackup, "2026-08-08", "2026-08-08", "point", "fixed"),
    schedule(20, "task", task.conferenceAbstract, "2026-08-08", "2026-08-14", "range", "fixed", {
      range_semantics: "once_within_window",
    }),
    schedule(21, "task", task.alBaseline, "2026-08-03", "2026-08-14", "range", "tentative", {
      range_semantics: "ongoing",
      actual_start: "2026-08-03",
    }),
    schedule(22, "task", task.alExplain, "2026-08-17", "2026-08-21", "range", "rough", {
      range_semantics: "once_within_window",
    }),
    schedule(23, "task", task.alMeeting, "2026-09-08", "2026-09-08", "deadline", "tentative"),
    schedule(24, "task", task.literatureSweep, "2026-07-15", "2026-08-31", "range", "rough", {
      range_semantics: "ongoing",
    }),
    schedule(25, "task", task.electrodeOrder, "2026-08-12", "2026-08-12", "deadline", "fixed"),
    schedule(26, "task", task.uncertaintyCheck, "2026-08-08", "2026-08-08", "point", "fixed", {
      actual_start: "2026-08-08",
    }),
    schedule(27, "waiting", id("waiting", 1), "2026-08-11", "2026-08-11", "deadline", "fixed"),
    schedule(28, "waiting", id("waiting", 2), "2026-08-12", "2026-08-12", "deadline", "fixed"),
  );

  put(
    "note",
    record(
      {
        id: note.kickoff,
        project_id: theme.llzo,
        title: "LLZO探索 研究設計と非交渉条件",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "# 研究目的\n\n室温Liイオン伝導度を高めつつ、cubic相純度95%以上と成形密度5.0 g/cm³以上を満たす条件を探索する。\n\n## 非交渉条件\n\n- 学習/検証は試料単位でなく**原料ロット単位**に分ける\n- 測定温度の換算前値を残す\n- 予測平均だけで候補を決めず、不確かさを表示する\n- 不成立試料も欠測として消さない\n\n```mermaid\nflowchart LR\n  D[既知データ] --> M[GPモデル]\n  M --> A[獲得関数]\n  A --> E[実験]\n  E --> D\n```",
      },
      "2026-06-03T02:00:00.000Z",
      "2026-07-04T00:10:00.000Z",
    ),
    record(
      {
        id: note.experiment,
        project_id: theme.llzo,
        title: "候補バッチ #2 実験計画",
        note_type: "note",
        content_format: "markdown",
        body_markdown: fs.readFileSync(path.join(fixtureRoot, "experiment_protocol.md"), "utf8"),
        properties_json: { heading_numbers: true, heading_number_levels: [2, 3] },
      },
      "2026-08-05T02:00:00.000Z",
      "2026-08-08T00:30:00.000Z",
    ),
    record(
      {
        id: note.analysis,
        project_id: theme.llzo,
        title: "GP-EI v4 モデル診断",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "# 結果\n\nロット単位LOCO-CVで MAE = **0.18 decade**、95%予測区間の被覆率は **82%**。\n\n| split | MAE | coverage |\n|---|---:|---:|\n| L2407-A | 0.14 | 0.91 |\n| L2407-B | 0.25 | 0.67 |\n| L2408-A | 0.15 | 0.88 |\n\n> [!INSIGHT]\n> L2407-Bだけ予測が系統的に高い。粉末粒径か焼成炉位置を潜在バッチ要因として確認する。\n\n目的変数は $y=\\log_{10}(\\sigma_{25^\\circ C})$。候補選択は $\\mathrm{EI}(x)$ と相純度制約の積で評価した。",
      },
      "2026-08-04T09:20:00.000Z",
      "2026-08-07T06:20:00.000Z",
    ),
    record(
      {
        id: note.decision,
        project_id: theme.llzo,
        title: "Decision: cycle 2は外挿候補を1条件だけ含める",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "# 決定\n\n3候補のうち1条件は既知組成の凸包外を許容する。残り2条件は再現性と局所改善を優先する。\n\n## 理由\n\n- 全条件を外挿にすると失敗時に学習信号が薄い\n- 全条件を局所探索にするとTa量方向の不確かさが縮まらない\n- 炉は同一runに4ペレットまで投入できる\n\n## 見直し条件\n\n外挿候補で二次相が10%以上なら、次cycleは制約モデルを先に更新する。",
      },
      "2026-08-05T03:10:00.000Z",
    ),
    record(
      {
        id: note.weekly,
        project_id: theme.llzo,
        title: "Ta置換LLZO 週報 2026-W32",
        note_type: "report",
        content_format: "markdown",
        body_markdown:
          "# 今週の現在地\n\nGP baselineの再学習と候補生成まで完了。候補3条件は実験制約の確認待ち1件を除き合成へ進められる。\n\n## Done\n\n- LOCO-CVと予測区間を再評価\n- candidate_batch_2026-08-08.jsonを固定\n- 焼成プロトコルを更新\n\n## Risk\n\nL2407-Bでcoverageが67%まで低下。粉末SEMの受領後に粒径特徴量を追加するか判断する。\n\n## Next\n\n1. 候補バッチを焼成\n2. XRD枠を確定\n3. EIS測定後にcycle 2 posteriorを更新",
        properties_json: {
          report_type: "weekly",
          period_start: "2026-08-03",
          period_end: "2026-08-08",
          publish_enabled: true,
          ai_export_enabled: true,
        },
      },
      "2026-08-08T01:00:00.000Z",
    ),
    record(
      {
        id: note.reportPrompt,
        project_id: theme.llzo,
        title: "研究週報を更新するプロンプト",
        note_type: "prompt",
        content_format: "markdown",
        body_markdown:
          "{{themeName}} の {{periodStart}} から {{periodEnd}} までの活動を整理してください。完了数の羅列ではなく、研究判断・得られた証拠・未解決のリスク・次の実験を分けてください。予測値と実測値を混同しないでください。",
        properties_json: {
          prompt_purpose: "report",
          prompt_variables: "themeName, periodStart, periodEnd",
          is_default: true,
        },
      },
      "2026-07-10T01:00:00.000Z",
    ),
    record(
      {
        id: note.daily1,
        project_id: theme.personal,
        title: "Daily Scratchpad 2026-08-07",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "## 朝\n\n- GP候補の制約確認\n- XRD依頼メール\n\n## 気づき\n\n候補2は予測値よりも既知点からの距離を理由に残した。\n\n## 明日\n\n秤量表のLi過剰量表記をmol%に統一する。",
        properties_json: { document_role: "daily_scratchpad", scratchpad_date: "2026-08-07" },
      },
      "2026-08-06T23:05:00.000Z",
      "2026-08-07T09:00:00.000Z",
    ),
    record(
      {
        id: note.daily2,
        project_id: theme.personal,
        title: "Daily Scratchpad 2026-08-08",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "## 09:10\n\n秤量開始。候補1のLa2O3乾燥履歴を確認。\n\n## あとで整理\n\n- coverage 82%は95%区間として低い\n- 電池討論会要旨は結果が揃う前に構成だけ作る\n- 製造部レビューの日程返答待ち",
        properties_json: { document_role: "daily_scratchpad", scratchpad_date: "2026-08-08" },
      },
      "2026-08-07T23:55:00.000Z",
      "2026-08-08T00:40:00.000Z",
    ),
    record(
      {
        id: note.focusEnded,
        project_id: theme.llzo,
        title: "Focus Session: GP baselineを再学習してLOCO-CVを確認",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "- L2407-Bの負側biasを確認\n- kernel変更では改善せず\n- ロット特徴量の追加はSEM受領後に判断",
        properties_json: {
          document_role: "focus_session",
          session_state: "ended",
          task_id: task.trainGp,
          started_at: "2026-08-04T06:10:00.000Z",
          ended_at: "2026-08-04T08:40:00.000Z",
          summary: "LOCO-CVを固定し、coverage低下を次Taskへ分離した。",
        },
      },
      "2026-08-04T06:10:00.000Z",
      "2026-08-04T08:40:00.000Z",
    ),
    record(
      {
        id: note.focusActive,
        project_id: theme.llzo,
        title: "Focus Session: 予測区間のcoverage低下を調べる",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "## 作業中\n\n- calibration curveをロット別に描く\n- leave-one-composition-outとも比較\n\n次: L2407-Bを除いたときのhyperparameterを保存",
        properties_json: {
          document_role: "focus_session",
          session_state: "active",
          task_id: task.uncertaintyCheck,
          started_at: "2026-08-08T04:30:00.000Z",
        },
      },
      "2026-08-08T04:30:00.000Z",
      "2026-08-08T05:10:00.000Z",
    ),
    record(
      {
        id: note.alMemo,
        project_id: theme.aluminum,
        title: "再生Al Paretoモデル 現在地",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "# 現在地\n\nMg/Si比と過剰Si量を追加すると、高強度側のfrontが安定した。一方で導電率側は溶解ロット差が支配的。\n\n# 保留理由\n\nLLZO候補バッチを優先するため、8月第3週までThemeを保留。\n\n# 再開条件\n\n- 製造部レビュー参加者の確定\n- ロットA14の時効実績値を受領",
      },
      "2026-08-06T07:00:00.000Z",
    ),
    record(
      {
        id: note.conference,
        project_id: theme.llzo,
        title: "電池討論会要旨 構成メモ",
        note_type: "note",
        content_format: "markdown",
        body_markdown:
          "# 主張候補\n\nロット外検証を組み込んだベイズ最適化により、平均性能だけでなく再現性リスクを可視化して実験候補を選べる。\n\n# 図\n\n1. 組成空間と既知点\n2. LOCO-CV parity plot\n3. EI候補と実測結果\n\n# 書かないこと\n\ncycle 2実測前に性能向上を断定しない。",
      },
      "2026-08-07T07:00:00.000Z",
    ),
  );
  // Noteは保存契約ではproject_idが正本だが、現行のdomain projectionはlegacy
  // theme_idも読んでNote投影を作る。両者を同値にして画面上のTheme所属を保つ。
  for (const entry of workspace.notes) entry.theme_id = entry.project_id;

  put(
    "resource",
    record(
      {
        id: resource.paper,
        project_id: theme.llzo,
        title: "Review: Garnet-type solid electrolytes",
        url: "https://doi.org/10.1039/C3CS60001A",
        description: "LLZOの組成・相安定性・界面課題の基礎レビュー。",
        body_markdown:
          "## 見ながら書いたメモ\n\n- cubic相安定化だけでなく粒界抵抗を分けて議論する\n- 室温伝導度の比較では密度と電極条件を併記\n- Ta/Nb置換量を単純な一変量として扱わない",
        link_type: "doi",
        reference_status: "reviewed",
        importance: "high",
        resource_scope: "note",
        captured_at: "2026-06-05",
      },
      "2026-06-05T02:00:00.000Z",
    ),
    record(
      {
        id: resource.matbench,
        project_id: theme.llzo,
        title: "Matbench benchmark datasets",
        url: "https://matbench.materialsproject.org/",
        description: "材料MLの評価分割とbaseline確認用。",
        body_markdown: "LLZO固有データではないが、少量データでの評価設計とリーク確認の参考にする。",
        link_type: "web",
        reference_status: "inbox",
        importance: "normal",
        resource_scope: "note",
        captured_at: "2026-07-02",
      },
      "2026-07-02T02:00:00.000Z",
    ),
    record(
      {
        id: resource.chatGp,
        project_id: theme.llzo,
        title: "ChatGPT: GP予測区間のcoverage診断",
        url: "https://chatgpt.com/share/example-tasken-llzo-coverage",
        description: "ロット分割とconformal calibrationの検討。",
        body_markdown:
          "## User\n\nLOCO-CVで95%予測区間のcoverageが82%でした。どこから診断すべき？\n\n## Assistant\n\n全体値だけでなくロット別coverage、標準化残差、hyperparameterのfold間変動を確認する。calibrationは評価分割の外側で行う。\n\n## 採用したこと\n\nロット別calibration curveを次Taskにした。conformal化はデータ追加後まで保留。",
        link_type: "chatgpt",
        reference_status: "active",
        importance: "high",
        resource_scope: "chat_ref",
        captured_at: "2026-08-07",
        chat_group: "LLZO / model diagnostics",
        message_count: 6,
        source_format: "rendered_markdown",
        fidelity: "rendered_text",
        parser_version: "1.0",
      },
      "2026-08-07T06:30:00.000Z",
    ),
    record(
      {
        id: resource.chatXrd,
        project_id: theme.llzo,
        title: "Claude: XRD相ラベルの判定基準レビュー",
        url: "https://claude.ai/share/example-tasken-xrd-labels",
        description: "cubic/tetragonal混相の扱いを相談。",
        body_markdown:
          "## 結論\n\n曖昧試料を多数決で強制ラベルせず、unknownとして学習対象から外す。生パターンと判定理由は残す。",
        link_type: "claude",
        reference_status: "reviewed",
        importance: "normal",
        resource_scope: "chat_ref",
        captured_at: "2026-06-22",
        chat_group: "LLZO / data curation",
        message_count: 4,
      },
      "2026-06-22T06:00:00.000Z",
    ),
    record(
      {
        id: resource.alPaper,
        project_id: theme.aluminum,
        title: "Recycled Al alloys and impurity-tolerant design",
        url: "https://doi.org/10.1016/j.jallcom.2024.174000",
        description: "スクラップ由来不純物を含む合金設計の調査候補。",
        body_markdown: "書誌情報と適用範囲を再確認してからKnowledgeへ採用する。",
        link_type: "doi",
        reference_status: "inbox",
        importance: "normal",
        resource_scope: "note",
        captured_at: "2026-07-18",
      },
      "2026-07-18T02:00:00.000Z",
    ),
    record(
      {
        id: resource.archivedChat,
        project_id: theme.llzo,
        title: "Copilot: pandas前処理の試行",
        url: "https://m365.cloud.microsoft/chat/example-tasken-pandas",
        description: "採用しなかった前処理案。",
        body_markdown: "列名変換を一括で行う案。単位情報を失うため採用せず。",
        link_type: "copilot",
        reference_status: "closed",
        importance: "low",
        resource_scope: "chat_ref",
        captured_at: "2026-06-15",
        chat_group: "LLZO / data curation",
        archived_at: "2026-07-01T00:00:00.000Z",
        message_count: 3,
      },
      "2026-06-15T03:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    ),
  );

  put(
    "capture_entry",
    record(
      {
        id: id("capture", 1),
        text: "L2407-Bだけ炉の下段だったかもしれない。焼成ログ確認",
        title: "炉位置の交絡？",
        kind: "inbox",
        content_type: "text",
        project_id: theme.llzo,
        captured_at: "2026-08-08T00:05:00.000Z",
        state: "untriaged",
      },
      "2026-08-08T00:05:00.000Z",
    ),
    record(
      {
        id: id("capture", 2),
        text: "https://matbench.materialsproject.org/",
        title: "Matbenchを評価設計の参考に",
        kind: "inbox",
        content_type: "url",
        url: "https://matbench.materialsproject.org/",
        project_id: theme.llzo,
        captured_at: "2026-07-02T01:50:00.000Z",
        state: "triaged",
        triaged_to_type: "resource",
        triaged_to_id: resource.matbench,
      },
      "2026-07-02T01:50:00.000Z",
      "2026-07-02T02:00:00.000Z",
    ),
    record(
      {
        id: id("capture", 3),
        text: "電池討論会要旨：性能向上より『不確かさ込みで実験を選ぶ』を主語にする",
        title: "要旨の主語",
        kind: "micro_memo",
        content_type: "text",
        project_id: theme.llzo,
        captured_at: "2026-08-07T07:05:00.000Z",
        state: "triaged",
        triaged_to_type: "note",
        triaged_to_id: note.conference,
      },
      "2026-08-07T07:05:00.000Z",
    ),
    record(
      {
        id: id("capture", 4),
        text: "Auターゲット残り約2週間分。見積依頼",
        title: "Auターゲット在庫",
        kind: "inbox",
        content_type: "text",
        project_id: theme.llzo,
        captured_at: "2026-08-03T01:55:00.000Z",
        state: "triaged",
        triaged_to_type: "task",
        triaged_to_id: task.electrodeOrder,
      },
      "2026-08-03T01:55:00.000Z",
    ),
    record(
      {
        id: id("capture", 5),
        text: "焼成プロセスと記録ポイントを手書き",
        title: "焼成フロー図",
        kind: "inbox",
        content_type: "ink",
        project_id: theme.llzo,
        captured_at: "2026-08-05T04:00:00.000Z",
        state: "triaged",
        triaged_to_type: "sketch",
        triaged_to_id: id("sketch", 2),
      },
      "2026-08-05T04:00:00.000Z",
    ),
    record(
      {
        id: id("capture", 6),
        text: "製造部：導電率はIACSだけでなく測定温度も資料に出してほしい",
        title: "Alレビュー資料の単位",
        kind: "inbox",
        content_type: "text",
        project_id: theme.aluminum,
        captured_at: "2026-08-02T01:30:00.000Z",
        state: "untriaged",
      },
      "2026-08-02T01:30:00.000Z",
    ),
    record(
      {
        id: id("capture", 7),
        text: "XRD装置のsample holder交換は来週水曜",
        title: "XRD装置メモ",
        kind: "inbox",
        content_type: "text",
        project_id: null,
        captured_at: "2026-08-08T00:45:00.000Z",
        state: "untriaged",
      },
      "2026-08-08T00:45:00.000Z",
    ),
    record(
      {
        id: id("capture", 8),
        text: "旧モデルのfeature importance画像",
        title: "旧RF図",
        kind: "inbox",
        content_type: "image",
        project_id: theme.aluminum,
        captured_at: "2026-06-25T00:00:00.000Z",
        state: "archived",
      },
      "2026-06-25T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
    ),
  );

  const knowledge = {
    batchQuestion: id("knowledge", 1),
    batchEvidence: id("knowledge", 2),
    coverageClaim: id("knowledge", 3),
    outsideDecision: id("knowledge", 4),
    densityInsight: id("knowledge", 5),
    phaseClaim: id("knowledge", 6),
    alQuestion: id("knowledge", 7),
    alEvidence: id("knowledge", 8),
    alClaim: id("knowledge", 9),
  };
  put(
    "knowledge_node",
    record(
      {
        id: knowledge.batchQuestion,
        theme_id: theme.llzo,
        title: "L2407-Bの予測ずれは原料差か炉位置差か？",
        body: "同ロットだけ伝導度を高めに予測する。粉末SEMと焼成炉ログを照合する。",
        node_type: "question",
        confidence: "medium",
        status: "active",
        source_type: "note",
        source_id: note.analysis,
      },
      "2026-08-04T09:30:00.000Z",
    ),
    record(
      {
        id: knowledge.batchEvidence,
        theme_id: theme.llzo,
        title: "L2407-Bの95%区間coverageは67%",
        body: "他ロットは88%以上。負側残差が連続している。",
        node_type: "evidence",
        confidence: "high",
        status: "active",
        source_type: "note",
        source_id: note.analysis,
      },
      "2026-08-04T09:35:00.000Z",
    ),
    record(
      {
        id: knowledge.coverageClaim,
        theme_id: theme.llzo,
        title: "ロットを跨ぐとGPの不確かさが過小評価される",
        body: "現在は観測事実と整合するが、L2407-Bの原因を分離できていないため暫定。",
        node_type: "claim",
        confidence: "medium",
        status: "active",
      },
      "2026-08-04T09:40:00.000Z",
    ),
    record(
      {
        id: knowledge.outsideDecision,
        theme_id: theme.llzo,
        title: "cycle 2は外挿候補を1条件に制限",
        body: "局所改善2、探索1の配分で情報獲得と成功確率を両立する。",
        node_type: "decision",
        confidence: "high",
        status: "resolved",
        source_type: "note",
        source_id: note.decision,
      },
      "2026-08-05T03:20:00.000Z",
    ),
    record(
      {
        id: knowledge.densityInsight,
        theme_id: theme.llzo,
        title: "密度5.0 g/cm³未満では組成効果より粒界抵抗が支配的",
        body: "低密度試料を同じ応答モデルへ入れるとTa量の効果を誤認しやすい。",
        node_type: "insight",
        confidence: "medium",
        status: "active",
      },
      "2026-07-20T02:00:00.000Z",
    ),
    record(
      {
        id: knowledge.phaseClaim,
        theme_id: theme.llzo,
        title: "Li過剰量を増やせば相純度が単調に上がる",
        body: "L2407-Bで反例。焼成条件との交互作用を無視していた。",
        node_type: "claim",
        confidence: "low",
        status: "rejected",
      },
      "2026-07-10T02:00:00.000Z",
      "2026-07-21T02:00:00.000Z",
    ),
    record(
      {
        id: knowledge.alQuestion,
        theme_id: theme.aluminum,
        title: "過剰Si量は高強度側Pareto frontを説明するか？",
        node_type: "question",
        confidence: "medium",
        status: "active",
        source_type: "note",
        source_id: note.alMemo,
      },
      "2026-07-29T07:20:00.000Z",
    ),
    record(
      {
        id: knowledge.alEvidence,
        theme_id: theme.aluminum,
        title: "過剰Si追加後に高強度側CV誤差が12%低下",
        node_type: "evidence",
        confidence: "medium",
        status: "active",
      },
      "2026-08-06T07:10:00.000Z",
    ),
    record(
      {
        id: knowledge.alClaim,
        theme_id: theme.aluminum,
        title: "再生材ではMg/Si比だけでなく過剰Siを分離すべき",
        node_type: "claim",
        confidence: "medium",
        status: "active",
      },
      "2026-08-06T07:15:00.000Z",
    ),
  );
  put(
    "knowledge_edge",
    record(
      {
        id: id("edge", 1),
        source_node_id: knowledge.batchEvidence,
        target_node_id: knowledge.coverageClaim,
        relation_type: "supports",
        description: "ロット別coverage低下",
      },
      "2026-08-04T09:45:00.000Z",
    ),
    record(
      {
        id: id("edge", 2),
        source_node_id: knowledge.coverageClaim,
        target_node_id: knowledge.batchQuestion,
        relation_type: "raises",
      },
      "2026-08-04T09:46:00.000Z",
    ),
    record(
      {
        id: id("edge", 3),
        source_node_id: knowledge.outsideDecision,
        target_node_id: knowledge.coverageClaim,
        relation_type: "depends_on",
      },
      "2026-08-05T03:25:00.000Z",
    ),
    record(
      {
        id: id("edge", 4),
        source_node_id: knowledge.phaseClaim,
        target_node_id: knowledge.densityInsight,
        relation_type: "contradicts",
      },
      "2026-07-21T02:10:00.000Z",
    ),
    record(
      {
        id: id("edge", 5),
        source_node_id: knowledge.alEvidence,
        target_node_id: knowledge.alClaim,
        relation_type: "supports",
      },
      "2026-08-06T07:20:00.000Z",
    ),
    record(
      {
        id: id("edge", 6),
        source_node_id: knowledge.alClaim,
        target_node_id: knowledge.alQuestion,
        relation_type: "answers",
      },
      "2026-08-06T07:21:00.000Z",
    ),
  );

  put(
    "sketch",
    record(
      {
        id: id("sketch", 1),
        project_id: theme.llzo,
        title: "ベイズ最適化の実験ループ",
        document: buildSketchDocument("loop"),
      },
      "2026-07-04T01:00:00.000Z",
      "2026-08-05T03:30:00.000Z",
    ),
    record(
      {
        id: id("sketch", 2),
        project_id: theme.llzo,
        origin_capture_id: id("capture", 5),
        title: "LLZO焼結プロセスと記録ポイント",
        document: buildSketchDocument("process"),
      },
      "2026-08-05T04:00:00.000Z",
      "2026-08-05T05:00:00.000Z",
    ),
  );

  put(
    "reference",
    record(
      {
        id: id("reference", 1),
        source_type: "note",
        source_id: note.focusEnded,
        target_type: "task",
        target_id: task.trainGp,
        relation_type: "related_to",
        note: "Focus Session",
      },
      "2026-08-04T06:10:00.000Z",
    ),
    record(
      {
        id: id("reference", 2),
        source_type: "note",
        source_id: note.focusActive,
        target_type: "task",
        target_id: task.uncertaintyCheck,
        relation_type: "related_to",
        note: "進行中Focus Session",
      },
      "2026-08-08T04:30:00.000Z",
    ),
    record(
      {
        id: id("reference", 3),
        source_type: "note",
        source_id: note.analysis,
        target_type: "resource",
        target_id: resource.chatGp,
        relation_type: "mentions",
        source_heading: "結果",
        source_excerpt: "95%予測区間の被覆率は82%",
      },
      "2026-08-07T06:40:00.000Z",
    ),
    record(
      {
        id: id("reference", 4),
        source_type: "note",
        source_id: note.experiment,
        target_type: "sketch",
        target_id: id("sketch", 2),
        relation_type: "related_to",
      },
      "2026-08-05T05:05:00.000Z",
    ),
    record(
      {
        id: id("reference", 5),
        source_type: "knowledge_node",
        source_id: knowledge.batchEvidence,
        target_type: "note",
        target_id: note.analysis,
        relation_type: "derived_from",
      },
      "2026-08-04T09:35:00.000Z",
    ),
    record(
      {
        id: id("reference", 6),
        source_type: "note",
        source_id: note.decision,
        target_type: "task",
        target_id: task.candidateReview,
        relation_type: "supports",
      },
      "2026-08-05T03:30:00.000Z",
    ),
  );

  put(
    "task_dependency",
    record(
      {
        id: id("dependency", 1),
        task_id: task.eisMeasure,
        depends_on_task_id: task.sinterCandidates,
        dependency_type: "finish_to_start",
      },
      "2026-08-06T03:30:00.000Z",
    ),
    record(
      {
        id: id("dependency", 2),
        task_id: task.xrdCandidates,
        depends_on_task_id: task.sinterCandidates,
        dependency_type: "finish_to_start",
      },
      "2026-08-06T03:31:00.000Z",
    ),
    record(
      {
        id: id("dependency", 3),
        task_id: task.updateModel,
        depends_on_task_id: task.eisMeasure,
        dependency_type: "finish_to_start",
      },
      "2026-08-06T03:32:00.000Z",
    ),
    record(
      {
        id: id("dependency", 4),
        task_id: task.updateModel,
        depends_on_task_id: task.xrdCandidates,
        dependency_type: "finish_to_start",
      },
      "2026-08-06T03:33:00.000Z",
    ),
  );
  put(
    "plan_dependency",
    record(
      {
        id: id("dependency", 11),
        plan_node_id: plan.activeLearning,
        depends_on_plan_node_id: plan.baselineComplete,
        dependency_type: "finish_to_start",
      },
      "2026-07-04T00:00:00.000Z",
    ),
    record(
      {
        id: id("dependency", 12),
        plan_node_id: plan.validation,
        depends_on_plan_node_id: plan.candidateBatch,
        dependency_type: "finish_to_start",
      },
      "2026-08-06T03:40:00.000Z",
    ),
    record(
      {
        id: id("dependency", 13),
        plan_node_id: plan.interimReport,
        depends_on_plan_node_id: plan.validation,
        dependency_type: "finish_to_start",
      },
      "2026-08-06T03:41:00.000Z",
    ),
  );

  const managedFiles = [
    ["llzo_screening_results.csv", "screening-results.csv"],
    ["candidate_batch_2026-08-08.json", "candidate-batch.json"],
    ["experiment_protocol.md", "experiment-protocol.md"],
  ];
  for (const [fixtureName, targetName] of managedFiles)
    fs.copyFileSync(path.join(fixtureRoot, fixtureName), path.join(managedDirectory, targetName));
  const fileSize = (name) => fs.statSync(path.join(managedDirectory, name)).size;
  put(
    "artifact",
    record(
      {
        id: id("artifact", 1),
        theme_id: theme.llzo,
        title: "LLZO screening results",
        filename: "screening-results.csv",
        description: "cycle 1までの代表測定値。単位は列名に保持。",
        source_type: "note",
        source_id: note.analysis,
        generated_by: "manual",
        storage_mode: "managed",
        stored_path: path.join(managedDirectory, "screening-results.csv"),
        copied_at: "2026-08-07T06:20:00.000Z",
        file_size: fileSize("screening-results.csv"),
      },
      "2026-08-07T06:20:00.000Z",
    ),
    record(
      {
        id: id("artifact", 2),
        theme_id: theme.llzo,
        title: "GP-EI v4 candidate batch",
        filename: "candidate-batch.json",
        description: "2026-08-08に固定した次実験候補。",
        source_type: "task",
        source_id: task.candidateReview,
        generated_by: "manual",
        storage_mode: "managed",
        stored_path: path.join(managedDirectory, "candidate-batch.json"),
        copied_at: "2026-08-08T00:10:00.000Z",
        file_size: fileSize("candidate-batch.json"),
      },
      "2026-08-08T00:10:00.000Z",
    ),
    record(
      {
        id: id("artifact", 3),
        theme_id: theme.llzo,
        title: "候補バッチ実験プロトコル",
        filename: "experiment-protocol.md",
        description: "Noteと同じ内容の固定版。",
        source_type: "note",
        source_id: note.experiment,
        origin_note_id: note.experiment,
        generated_by: "manual",
        storage_mode: "managed",
        stored_path: path.join(managedDirectory, "experiment-protocol.md"),
        copied_at: "2026-08-08T00:30:00.000Z",
        file_size: fileSize("experiment-protocol.md"),
        export_format: "markdown",
        exported_at: "2026-08-08T00:30:00.000Z",
      },
      "2026-08-08T00:30:00.000Z",
    ),
    record(
      {
        id: id("artifact", 4),
        theme_id: theme.llzo,
        title: "Matbench benchmark site",
        filename: "matbench.url",
        description: "外部URL参照のArtifact例。",
        source_type: "theme",
        source_id: theme.llzo,
        generated_by: "manual",
        storage_mode: "linked",
        stored_path: "",
        target: "https://matbench.materialsproject.org/",
        link_type: "url",
        link_status: "ok",
      },
      "2026-07-02T02:10:00.000Z",
    ),
    record(
      {
        id: id("artifact", 5),
        theme_id: theme.aluminum,
        title: "旧NAS上のAlロット台帳",
        filename: "al-lot-ledger.xlsx",
        description: "移設前のパス。リンク切れ状態の表示確認用。",
        source_type: "theme",
        source_id: theme.aluminum,
        generated_by: "manual",
        storage_mode: "linked",
        stored_path: "",
        target: "Z:\\Materials\\Al\\al-lot-ledger.xlsx",
        link_type: "shared_path",
        link_status: "broken",
        last_checked_at: "2026-08-06T07:30:00.000Z",
      },
      "2026-07-23T01:30:00.000Z",
      "2026-08-06T07:30:00.000Z",
    ),
  );

  put(
    "view",
    record(
      {
        id: id("view", 1),
        title: "今日の高優先度",
        view_type: "task",
        filters: {
          tab: "today",
          themeId: "all",
          state: "",
          priority: "high",
          schedule: "",
          rangeSemantics: "",
        },
        sort_order: 0,
      },
      "2026-07-15T01:00:00.000Z",
    ),
    record(
      {
        id: id("view", 2),
        title: "LLZO 未完了",
        view_type: "task",
        filters: {
          tab: "open",
          themeId: theme.llzo,
          state: "",
          priority: "",
          schedule: "",
          rangeSemantics: "",
        },
        sort_order: 1,
      },
      "2026-07-15T01:05:00.000Z",
    ),
    record(
      {
        id: id("view", 3),
        title: "期間中継続",
        view_type: "task",
        filters: {
          tab: "open",
          themeId: "all",
          state: "",
          priority: "",
          schedule: "",
          rangeSemantics: "ongoing_period",
        },
        sort_order: 2,
      },
      "2026-08-06T01:00:00.000Z",
    ),
    record(
      {
        id: id("view", 4),
        title: "予定なしバックログ",
        view_type: "task",
        filters: {
          tab: "no-schedule",
          themeId: "all",
          state: "",
          priority: "",
          schedule: "no-schedule",
          rangeSemantics: "",
        },
        sort_order: 3,
      },
      "2026-08-06T01:05:00.000Z",
    ),
  );

  put(
    "status_update",
    record(
      {
        id: id("status", 1),
        theme_id: theme.llzo,
        date: "2026-07-03",
        status: "on_track",
        summary: "Baseline dataset v1を固定。ロット分割での評価へ移行する。",
        progress: 30,
        risks: "unknown相7試料",
        next_actions: "GP baseline再学習",
      },
      "2026-07-03T08:10:00.000Z",
    ),
    record(
      {
        id: id("status", 2),
        theme_id: theme.llzo,
        date: "2026-08-04",
        status: "at_risk",
        summary: "GP-EI v4は候補生成まで完了したが、L2407-Bで予測区間のcoverageが低い。",
        progress: 56,
        risks: "ロット差と炉位置差が未分離",
        next_actions: "候補合成と並行して原因を診断",
      },
      "2026-08-04T09:50:00.000Z",
    ),
    record(
      {
        id: id("status", 3),
        theme_id: theme.llzo,
        date: "2026-08-08",
        status: "on_track",
        summary: "候補バッチ #2の秤量を開始。実験制約3/4を確認済み。",
        progress: 61,
        risks: "XRD測定枠が未確定",
        next_actions: "焼成、XRD枠確定、EIS準備",
      },
      "2026-08-08T01:10:00.000Z",
    ),
    record(
      {
        id: id("status", 4),
        theme_id: theme.aluminum,
        date: "2026-07-29",
        status: "on_track",
        summary: "派生特徴量を追加し、高強度側Pareto frontのCV誤差が改善。",
        progress: 48,
        risks: "導電率側のロット差",
        next_actions: "SHAP説明と製造部レビュー",
      },
      "2026-07-29T07:30:00.000Z",
    ),
    record(
      {
        id: id("status", 5),
        theme_id: theme.aluminum,
        date: "2026-08-06",
        status: "paused",
        summary: "LLZO候補バッチを優先するため一時保留。データと判断は保持。",
        progress: 52,
        risks: "製造部レビュー参加者未確定",
        next_actions: "8月第3週に再開判断",
      },
      "2026-08-06T07:40:00.000Z",
    ),
  );

  put(
    "ai_proposal",
    record(
      {
        id: id("proposal", 1),
        source: "ai_import",
        payload_type: "knowledge_nodes",
        status: "pending",
        payload: {
          knowledge_nodes: [
            {
              title: "焼成炉位置が粒界抵抗を変える",
              node_type: "claim",
              body: "L2407-Bの炉位置ログ確認後に採否判断する。",
            },
          ],
        },
        summary: "ChatGPTとのcoverage診断からKnowledge候補1件",
        target_theme_id: theme.llzo,
      },
      "2026-08-08T05:20:00.000Z",
      "2026-08-08T05:20:00.000Z",
      "ai_import",
    ),
    record(
      {
        id: id("proposal", 2),
        source: "manual",
        payload_type: "notes",
        status: "accepted",
        payload: { notes: [{ title: "cycle 2実験制約", note_type: "note" }] },
        summary: "候補制約メモを採用済み",
        target_theme_id: theme.llzo,
        accepted_at: "2026-08-05T03:00:00.000Z",
      },
      "2026-08-05T02:50:00.000Z",
      "2026-08-05T03:00:00.000Z",
      "manual",
    ),
  );

  put(
    "source_record",
    record(
      {
        id: id("source", 1),
        source_title: "LLZO screening workbook 2026-07",
        source_type: "xlsx",
        source_url: "https://example.invalid/tasken-demo/llzo-screening",
        imported_at: "2026-07-03T07:30:00.000Z",
      },
      "2026-07-03T07:30:00.000Z",
      undefined,
      "imported",
    ),
  );
  put(
    "import_batch",
    record(
      {
        id: id("import", 1),
        filename: "llzo_screening_2026-07.xlsx",
        imported_at: "2026-07-03T07:30:00.000Z",
        status: "applied",
        created_count: 128,
        updated_count: 0,
        conflict_count: 7,
      },
      "2026-07-03T07:30:00.000Z",
      undefined,
      "imported",
    ),
  );

  const eventValues = [
    [1, "task", task.xrdBaseline, "completed", "相ラベル再確認を完了", "2026-06-24T07:20:00.000Z"],
    [2, "task", task.cleanDataset, "completed", "25℃換算を完了", "2026-06-29T05:00:00.000Z"],
    [3, "task", task.trainGp, "completed", "LOCO-CVを固定", "2026-08-04T09:10:00.000Z"],
    [4, "note", note.decision, "created", "探索と局所改善の配分を決定", "2026-08-05T03:10:00.000Z"],
    [5, "capture_entry", id("capture", 3), "triaged", "要旨Noteへ整理", "2026-08-07T07:10:00.000Z"],
    [
      6,
      "task",
      task.sinterCandidates,
      "updated",
      "候補バッチの合成を開始",
      "2026-08-07T08:00:00.000Z",
    ],
    [
      7,
      "task",
      task.uncertaintyCheck,
      "updated",
      "Focus Sessionを開始",
      "2026-08-08T04:30:00.000Z",
    ],
    [8, "note", note.weekly, "created", "週報を作成", "2026-08-08T01:00:00.000Z"],
  ];
  put(
    "change_event",
    ...eventValues.map(([number, entityType, entityId, changeType, reason, changedAt]) =>
      record(
        {
          id: id("event", number),
          entity_type: entityType,
          entity_id: entityId,
          changed_at: changedAt,
          change_type: changeType,
          reason,
          source: "manual",
        },
        changedAt,
      ),
    ),
    activityEvent(
      1,
      "task",
      task.uncertaintyCheck,
      "task_work_recorded",
      "2026-08-28T07:55:00+09:00",
      theme.llzo,
      { sessionId: agentSession.lab, summary: "短いTasken記録" },
    ),
    activityEvent(
      2,
      "task",
      task.uncertaintyCheck,
      "task_checklist_checked",
      "2026-08-28T09:45:00+09:00",
      theme.llzo,
      { sessionId: agentSession.lab, summary: "実験確認を記録" },
    ),
    activityEvent(
      3,
      "task",
      task.alMeeting,
      "task_work_recorded",
      "2026-08-28T11:30:00+09:00",
      theme.aluminum,
      { summary: "定例会議 開始" },
    ),
    activityEvent(
      4,
      "task",
      task.alMeeting,
      "task_work_recorded",
      "2026-08-28T12:15:00+09:00",
      theme.aluminum,
      { summary: "定例会議 終了" },
    ),
    activityEvent(
      5,
      "task",
      task.alBaseline,
      "task_work_recorded",
      "2026-08-28T15:10:00+09:00",
      theme.aluminum,
      { sessionId: agentSession.plant, summary: "短いTasken記録" },
    ),
    activityEvent(
      6,
      "task",
      task.sinterCandidates,
      "task_work_recorded",
      "2026-08-28T16:30:00+09:00",
      theme.llzo,
      { summary: "短いTasken記録" },
    ),
    activityEvent(
      7,
      "task",
      task.alExplain,
      "task_work_recorded",
      "2026-08-28T18:00:00+09:00",
      theme.aluminum,
      { summary: "短いTasken記録" },
    ),
    activityEvent(
      8,
      "task",
      task.alBaseline,
      "task_work_recorded",
      "2026-08-28T15:12:00+09:00",
      theme.aluminum,
      { summary: "解析結果をNoteへ反映" },
    ),
    activityEvent(
      9,
      "task",
      task.alExplain,
      "task_work_recorded",
      "2026-08-28T15:18:00+09:00",
      theme.aluminum,
      { summary: "説明変数の候補を更新" },
    ),
    activityEvent(
      10,
      "task",
      task.alMeeting,
      "task_work_recorded",
      "2026-08-28T15:24:00+09:00",
      theme.aluminum,
      { summary: "製造部レビュー項目を更新" },
    ),
  );

  workspace.plan_revisions = [];
  workspace.meta = {};
  return workspace;
}

function parseArguments(argv) {
  const result = { target: "", applyLocal: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply-local") result.applyLocal = true;
    else if (value === "--target") result.target = path.resolve(argv[++index] || "");
    else throw new Error(`未知の引数です: ${value}`);
  }
  if (result.applyLocal && result.target)
    throw new Error("--apply-localと--targetは同時に指定できません。");
  result.target ||= result.applyLocal ? localDatabasePath : "";
  if (!result.target)
    throw new Error("--apply-local または --target <sqlite path> を指定してください。");
  return result;
}

function backupExistingDatabase(targetPath) {
  if (!fs.existsSync(targetPath)) return null;
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupDirectory = path.join(path.dirname(targetPath), "development-data-backups", stamp);
  fs.mkdirSync(backupDirectory, { recursive: true });
  const existing = new WorkspaceDatabase(targetPath);
  const snapshotPath = path.join(backupDirectory, "workspace-before-materials-demo.tasken.zip");
  createSnapshot(existing.loadWorkspace(true)).writeZip(snapshotPath);
  existing.db.pragma("wal_checkpoint(TRUNCATE)");
  existing.db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${targetPath}${suffix}`;
    if (fs.existsSync(source))
      fs.renameSync(source, path.join(backupDirectory, `${path.basename(targetPath)}${suffix}`));
  }
  return { backupDirectory, snapshotPath };
}

function seed(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const managedDirectory = path.join(path.dirname(targetPath), "materials-informatics-artifacts");
  fs.mkdirSync(managedDirectory, { recursive: true });
  // Theme folderのmarkerは1フォルダにつき1Theme。共有すると後続のThemeが保存できなくなる。
  for (const segment of ["MI-LLZO-26", "CIRC-AL-07"]) {
    fs.mkdirSync(path.join(managedDirectory, segment), { recursive: true });
  }
  const backup = backupExistingDatabase(targetPath);
  const workspace = buildWorkspace(managedDirectory);
  const repository = new WorkspaceDatabase(targetPath);
  repository.validateSnapshotWorkspace(workspace);
  const insertAll = repository.db.transaction(() => {
    for (const type of workspaceEntityTypes) {
      for (const entity of workspace[collectionKeyForEntityType(type)] || [])
        repository.insertImported(type, entity, entity.source || "development-fixture");
    }
  });
  insertAll();
  repository.setPreference("themeMode", "light");
  repository.setPreference("activeGroups", ["材料インフォマティクス", "サーキュラーマテリアル"]);
  repository.setPreference("activityLogAutoExportTime", "23:25");
  repository.setPreference("artifactDirectory", managedDirectory);
  repository.setPreference("aiVisibilityDefault", ["coding_agent"]);
  const loaded = repository.loadWorkspace();
  repository.validateSnapshotWorkspace(loaded);
  const representativeDate = "2026-08-28";
  const representativeSessions = loaded.agent_sessions
    .filter((session) => session.started_at.startsWith(representativeDate))
    .sort((left, right) => left.started_at.localeCompare(right.started_at));
  const representativeEvents = queryActivityEvents({
    events: loaded.change_events,
    workspace: loaded,
    date: representativeDate,
    timezone: "Asia/Tokyo",
  }).events;
  const sessionRanges = representativeSessions.map((session) => [
    Date.parse(session.started_at),
    Date.parse(session.ended_at),
  ]);
  const representativeActivity = {
    date: representativeDate,
    session_times: representativeSessions.map((session) => [
      session.started_at.slice(11, 16),
      session.ended_at.slice(11, 16),
    ]),
    event_times: representativeEvents.map((event) => event.local_time),
    event_kind_counts: Object.fromEntries(
      [...new Set(representativeEvents.map((event) => event.event_kind))].map((eventKind) => [
        eventKind,
        representativeEvents.filter((event) => event.event_kind === eventKind).length,
      ]),
    ),
    event_theme_counts: [...new Set(representativeEvents.map((event) => event.theme_ref?.id))]
      .filter(Boolean)
      .map(
        (projectId) =>
          representativeEvents.filter((event) => event.theme_ref?.id === projectId).length,
      )
      .sort((left, right) => left - right),
    session_event_count: representativeEvents.filter((event) => event.origin?.session_id).length,
    max_session_overlap: [...new Set(sessionRanges.flat())].reduce((maximum, timestamp) => {
      const active = sessionRanges.filter(
        ([start, end]) => start <= timestamp && timestamp < end,
      ).length;
      return Math.max(maximum, active);
    }, 0),
    session_reference_types: [
      ...new Set(
        loaded.references
          .filter(
            (reference) =>
              reference.subject?.type === "agent_session" && reference.predicate === "worked_on",
          )
          .map((reference) => reference.object?.type),
      ),
    ].filter(Boolean),
    session_reference_count: loaded.references.filter(
      (reference) =>
        reference.subject?.type === "agent_session" && reference.predicate === "worked_on",
    ).length,
  };
  const repositoryAssignments = {
    themes: Object.fromEntries(
      loaded.themes.map((theme) => [
        theme.code,
        {
          repository_context_ids: Array.isArray(theme.repository_context_ids)
            ? [...theme.repository_context_ids]
            : [],
          primary_repository_context_id: theme.primary_repository_context_id || null,
        },
      ]),
    ),
    projects: Object.fromEntries(
      loaded.projects.map((project) => [
        project.code,
        {
          repository_context_ids: Array.isArray(project.repository_context_ids)
            ? [...project.repository_context_ids]
            : [],
          primary_repository_context_id: project.primary_repository_context_id || null,
        },
      ]),
    ),
  };
  repository.validateSnapshotWorkspace(loaded);
  const snapshotDirectory = path.join(path.dirname(targetPath), "development-snapshots");
  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const snapshotPath = path.join(snapshotDirectory, "materials-informatics-workspace.tasken.zip");
  createSnapshot(loaded).writeZip(snapshotPath);
  const counts = Object.fromEntries(
    workspaceEntityTypes
      .map((type) => [type, repository.list(type).length])
      .filter(([, count]) => count > 0),
  );
  repository.db.pragma("wal_checkpoint(TRUNCATE)");
  repository.db.close();
  return {
    targetPath,
    managedDirectory,
    snapshotPath,
    backup,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    representativeActivity,
    repositoryAssignments,
  };
}

export { parseArguments, seed };

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  const result = seed(options.target);
  console.log(JSON.stringify(result, null, 2));
}
