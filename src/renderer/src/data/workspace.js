import {
  initialMilestones,
  initialNotes,
  initialPhases,
  initialTasks,
  initialThemes,
  initialWaiting,
} from "./initialData.js";

const isoNow = () => new Date().toISOString();
const id = (prefix, value) => `${prefix}-${value}`;

function metadata(source = "seed") {
  const timestamp = isoNow();
  return {
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    device_id: "bootstrap",
    source,
    version: 1,
  };
}

export function buildBootstrapWorkspace() {
  const themes = initialThemes.map((theme) => ({
    id: String(theme.id),
    name: theme.name,
    description: theme.description ?? theme.subtitle ?? "",
    status: theme.status || "計画中",
    color: theme.color || "",
    ...metadata(theme.source || "legacy"),
  }));

  const taskItems = initialTasks.map((task, index) => ({
    id: id("task", task.id),
    title: task.title,
    kind: task.kind === "inbox" ? "idea" : task.kind || "task",
    theme_id: task.theme || null,
    status: task.status || "todo",
    priority: task.priority || "normal",
    parent_item_id: null,
    sort_order: index,
    depth: 0,
    baseline_start: task.baseline_start || null,
    baseline_end: task.baseline_end || task.due || null,
    planned_start: task.planned_start || null,
    planned_end: task.planned_end || task.due || null,
    actual_start: task.actual_start || null,
    actual_end: task.actual_end || null,
    due_date: task.due || null,
    progress: task.status === "done" ? 100 : 0,
    is_personal_task: !task.theme,
    description: task.description || "",
    ...metadata(task.source || "legacy"),
  }));

  const waitingItems = initialWaiting.map((item, index) => ({
    id: id("waiting", item.id),
    title: item.title,
    kind: "waiting",
    theme_id: item.theme || null,
    status: item.status || "waiting",
    priority: "normal",
    parent_item_id: null,
    sort_order: taskItems.length + index,
    depth: 0,
    planned_start: null,
    planned_end: item.due || null,
    due_date: item.due || null,
    progress: item.status === "done" ? 100 : 0,
    waiting_for: item.waitingFor || "",
    next_action: item.next || "",
    description: item.note || "",
    is_personal_task: false,
    ...metadata(item.source || "legacy"),
  }));

  const periodItems = initialPhases.map((phase, index) => ({
    id: id("period", phase.id),
    title: phase.label,
    kind: "period",
    theme_id: phase.theme || null,
    status: "todo",
    priority: "normal",
    parent_item_id: null,
    sort_order: taskItems.length + waitingItems.length + index,
    depth: 0,
    baseline_start: phase.start,
    baseline_end: phase.end,
    planned_start: phase.start,
    planned_end: phase.end,
    due_date: phase.end,
    progress: 0,
    tone: phase.tone || "accent",
    description: "",
    is_personal_task: false,
    ...metadata(phase.source || "legacy"),
  }));

  const milestoneItems = initialMilestones.map((milestone, index) => ({
    id: id("milestone", milestone.id),
    title: milestone.label,
    kind: "milestone",
    theme_id: milestone.theme || null,
    status: "todo",
    priority: "high",
    parent_item_id: null,
    sort_order: taskItems.length + waitingItems.length + periodItems.length + index,
    depth: 0,
    baseline_start: milestone.date,
    baseline_end: milestone.date,
    planned_start: milestone.date,
    planned_end: milestone.date,
    due_date: milestone.date,
    progress: 0,
    description: "",
    is_personal_task: false,
    ...metadata(milestone.source || "legacy"),
  }));

  const notes = initialNotes.map((note) => ({
    id: id("note", note.id),
    title: note.title,
    body_markdown: note.body || "",
    note_type: note.type || "memo",
    theme_id: note.theme || null,
    item_id: note.item_id || null,
    source_url: note.url || "",
    properties_json: {},
    comments: note.comments || [],
    ...metadata(note.source || "legacy"),
  }));

  const links = initialNotes.filter((note) => note.url).map((note) => ({
    id: id("link", note.id),
    title: note.title,
    url: note.url,
    link_type: "other",
    theme_id: note.theme || null,
    item_id: null,
    note_id: id("note", note.id),
    description: note.body || "",
    ...metadata("legacy"),
  }));

  return {
    themes,
    items: [...taskItems, ...waitingItems, ...periodItems, ...milestoneItems],
    notes,
    links,
    dependencys: [],
    views: [],
    status_updates: [],
    source_records: [],
    entity_sources: [],
    relations: [],
    field_definitions: [],
    field_values: [],
    log_entries: [],
    import_batchs: [],
    knowledge_nodes: [],
    knowledge_relations: [],
    ai_proposals: [],
  };
}

export function emptyWorkspace() {
  return {
    themes: [],
    items: [],
    notes: [],
    links: [],
    dependencys: [],
    views: [],
    status_updates: [],
    source_records: [],
    entity_sources: [],
    relations: [],
    field_definitions: [],
    field_values: [],
    log_entries: [],
    import_batchs: [],
    knowledge_nodes: [],
    knowledge_relations: [],
    ai_proposals: [],
    plan_revisions: [],
    meta: {},
  };
}
