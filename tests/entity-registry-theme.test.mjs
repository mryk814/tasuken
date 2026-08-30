import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import path from "node:path";
import { Buffer } from "node:buffer";

import {
  assertEntityPayload,
  collectionKeyForEntityType,
  domainCollectionKeyForEntityType,
  entityDefinitionForCollection,
  entityDefinitions,
  entityTypes,
  rawRecordBoundary,
  themeFieldForEntityType,
} from "../src/shared/entityRegistry.mjs";
import { diagnoseWorkspaceRawRecord } from "../src/shared/entityDiagnostics.mjs";
import {
  PERSONAL_DEFAULT_THEME_ID,
  canonicalThemeId,
  isPersonalDefaultThemeId,
  resolveThemeRef,
  themePickerOptions,
} from "../src/shared/themeRef.mjs";
import { resolveStorageLocation } from "../src/shared/storageResolver.mjs";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("Entity Registryは全typeのcollection/schema/Theme policyを一意に解決する", () => {
  assert.equal(new Set(entityTypes).size, entityTypes.length);
  assert.equal(new Set(entityDefinitions.map((definition) => definition.collectionKey)).size, entityTypes.length);
  for (const type of entityTypes) {
    const definition = entityDefinitions.find((candidate) => candidate.type === type);
    assert.ok(definition, type);
    assert.equal(collectionKeyForEntityType(type), definition.collectionKey);
    if (definition.domainCollectionKey) assert.equal(domainCollectionKeyForEntityType(type), definition.domainCollectionKey);
    assert.equal(typeof definition.label, "string");
    assert.equal(typeof definition.iconKey, "string");
    assert.ok(Array.isArray(definition.requiredFields));
    assert.ok(["none", "optional", "required"].includes(definition.themePolicy));
    assert.equal(themeFieldForEntityType(type), definition.themeField);
    assert.equal(definition.payloadKind, "record");
    assert.equal(typeof definition.parseCreate, "function");
    assert.equal(typeof definition.parseUpdate, "function");
    assert.equal(typeof definition.referencePolicy, "object");
    assert.equal(typeof definition.activityPolicy, "object");
    assert.doesNotThrow(() => definition.parseCreate({ id: `${type}-1` }));
  }
  assert.throws(() => assertEntityPayload("task", { entityType: "note" }), /一致しません/);
  assert.doesNotThrow(() => assertEntityPayload("field_value", { entity_type: "task" }));
  assert.equal(domainCollectionKeyForEntityType("legacy-unknown"), null);
  for (const definition of entityDefinitions) {
    assert.equal(entityDefinitionForCollection(definition.collectionKey)?.type, definition.type);
  }
  assert.equal(entityDefinitionForCollection("unknown_collection"), null);
  assert.deepEqual(rawRecordBoundary, {
    kind: "raw-record-boundary",
    description: "DB/importのRecordはこの境界で検証し、domainへ直接持ち込まない",
  });
});

test("RegistryのcollectionKeyはcanonical WorkspaceDataの全collectionに実在する", async () => {
  const adapter = await importBundled("src/renderer/src/features/workspace/domain-model/compat/legacyAdapter.ts");
  const data = await importBundled("src/renderer/src/data/workspace.js");
  const base = {
    ...data.emptyWorkspace(),
    resources: [], projects: [], capture_entrys: [], tasks: [], waitings: [], plan_nodes: [], schedules: [],
    task_dependencies: [], plan_dependencies: [], change_events: [], artifacts: [], sketches: [],
  };
  const domain = adapter.legacyWorkspaceToDomainMigration(base).workspace;
  const workspace = adapter.projectLegacyWorkspace(domain, base);
  for (const definition of entityDefinitions) {
    assert.ok(Object.prototype.hasOwnProperty.call(workspace, definition.collectionKey), `${definition.type}: ${definition.collectionKey}`);
    assert.ok(Array.isArray(workspace[definition.collectionKey]), `${definition.type}: ${definition.collectionKey}`);
  }
  // 現行の永続化正本は既存WorkspaceDataのこの綴りであり、別名を増やさない。
  assert.ok(Object.prototype.hasOwnProperty.call(workspace, "import_batchs"));
  assert.equal(Object.prototype.hasOwnProperty.call(workspace, "import_batches"), false);
});

test("新規Note/Task/Resourceのpersonal Themeはstable IDを保存し、nullへ戻さない", async () => {
  const drawer = await importBundled("src/renderer/src/features/workspace/lib/drawerFormPlans.ts");
  const data = { views: [], artifacts: [] };
  const domain = { tasks: [], waitings: [], plan_nodes: [] };
  const plan = (type, fields) => drawer.buildDomainDrawerFormPlan({
    type,
    values: Object.entries(fields).reduce((form, [key, value]) => { form.append(key, value); return form; }, new FormData()),
    base: {},
    data,
    domain,
    hasField: (name) => Object.prototype.hasOwnProperty.call(fields, name),
  });
  const task = plan("task", { title: "Personal task", theme_id: "" });
  const resource = plan("resource", { title: "Personal resource", url: "https://example.test", project_id: "" });
  assert.equal(task.operations.find((operation) => operation.type === "task").entity.project_id, PERSONAL_DEFAULT_THEME_ID);
  assert.equal(resource.operations.find((operation) => operation.type === "resource").entity.project_id, PERSONAL_DEFAULT_THEME_ID);
  // Noteの作成入口はNotesPageからcanonicalThemeId(...defaultPersonal)を通す。
  const notesPage = (await build({
    entryPoints: [path.resolve("src/renderer/src/features/workspace/pages/NotesPage.tsx")],
    bundle: false,
    write: false,
    logLevel: "silent",
  })).outputFiles[0].text;
  assert.match(notesPage, /canonicalThemeId\(activeTheme\?\.id, \{ defaultPersonal: true \}\)/);
});

test("ThemeRefはpersonal defaultとThemeなしを別のcanonical値として扱う", () => {
  assert.equal(canonicalThemeId(null), null);
  assert.equal(canonicalThemeId(""), null);
  assert.equal(canonicalThemeId(null, { defaultPersonal: true }), PERSONAL_DEFAULT_THEME_ID);
  assert.equal(isPersonalDefaultThemeId(PERSONAL_DEFAULT_THEME_ID), true);
  assert.equal(isPersonalDefaultThemeId("theme-a"), false);
  assert.equal(resolveThemeRef([], null, { legacyNullMeansPersonal: true }).id, PERSONAL_DEFAULT_THEME_ID);
  assert.equal(resolveThemeRef([], null).id, null);
  assert.deepEqual(themePickerOptions([{ id: PERSONAL_DEFAULT_THEME_ID, name: "個人業務" }, { id: "theme-a", name: "A" }], { allowNone: true }), [
    { value: PERSONAL_DEFAULT_THEME_ID, label: "個人業務", kind: "personal", colorToken: "chart-6" },
    { value: "", label: "Themeなし", kind: "none" },
    { value: "theme-a", label: "A", kind: "theme", colorToken: "chart-2" },
  ]);
  assert.equal(resolveStorageLocation({ syncRoot: "C:/sync", themeRef: { kind: "theme", id: PERSONAL_DEFAULT_THEME_ID } }).segments[0], "Inbox");
});

test("raw boundary診断はtype/collection/Theme異常を本文を変更せず報告する", () => {
  const note = { id: "note-1", title: "本文", body_markdown: "NOTE_A_ONLY", theme_id: "missing-theme", entityType: "task" };
  const workspace = { notes: [note], themes: [{ id: PERSONAL_DEFAULT_THEME_ID, name: "個人業務" }], unexpected: [] };
  const result = diagnoseWorkspaceRawRecord(workspace, { knownThemeIds: [PERSONAL_DEFAULT_THEME_ID] });
  assert.deepEqual(note.body_markdown, "NOTE_A_ONLY");
  assert.deepEqual(result.issues.map((issue) => issue.kind).sort(), ["invalid_theme_ref", "type_payload_mismatch", "unknown_collection"]);
});

test("legacy Theme migrationはpersonal IDへ収束し、未知参照と本文を保持して再実行できる", async () => {
  const adapter = await importBundled("src/renderer/src/features/workspace/domain-model/compat/legacyAdapter.ts");
  const legacy = {
    themes: [],
    items: [{ id: "item-a", title: "A", status: "todo", body_markdown: "NOTE_A_ONLY", file_path: "C:/A.md" }, { id: "item-b", title: "B", status: "todo", theme_id: "missing-theme" }],
    notes: [{ id: "note-a", title: "Note A", body_markdown: "NOTE_A_ONLY", theme_id: "" }],
    links: [],
    knowledge_nodes: [],
    status_updates: [],
  };
  const first = adapter.legacyWorkspaceToDomainMigration(legacy);
  const second = adapter.legacyWorkspaceToDomainMigration(legacy);
  assert.equal(first.workspace.tasks.find((task) => task.legacy_item_id === "item-a")?.project_id, PERSONAL_DEFAULT_THEME_ID);
  assert.equal(first.workspace.notes[0].project_id, PERSONAL_DEFAULT_THEME_ID);
  assert.equal(first.report.warningCounts.invalidThemeRef, 1);
  assert.equal(first.report.invalidThemeRefs[0].themeId, "missing-theme");
  assert.equal(first.workspace.tasks.find((task) => task.legacy_item_id === "item-a")?.body_markdown, "NOTE_A_ONLY");
  assert.equal(first.workspace.tasks.find((task) => task.legacy_item_id === "item-a")?.file_path, "C:/A.md");
  assert.deepEqual(second.workspace, first.workspace);
});
