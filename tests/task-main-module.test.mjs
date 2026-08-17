import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createTaskModule } from "../src/main/modules/task/public.ts";

class MemoryPersistence {
  constructor(entities = []) {
    this.records = new Map(entities.map((entity) => [`${entity.type}:${entity.id}`, { ...entity }]));
    this.removedTypes = [];
  }

  list(type, includeDeleted = false) {
    return [...this.records.values()].filter((entity) => entity.type === type && (includeDeleted || !entity.deleted_at));
  }

  get(type, id, includeDeleted = false) {
    const entity = this.records.get(`${type}:${id}`) || null;
    return entity && (includeDeleted || !entity.deleted_at) ? { ...entity } : null;
  }

  save(type, entity) {
    const saved = { ...entity, type };
    this.records.set(`${type}:${entity.id}`, saved);
    return { ...saved };
  }

  saveMany(operations) {
    return operations.map((operation) => this.save(operation.type, operation.entity));
  }

  remove(type, id) {
    this.removedTypes.push(type);
    const current = this.get(type, id, true);
    if (!current) return null;
    return this.save(type, { ...current, deleted_at: "2026-08-17T00:00:00.000Z" });
  }
}

const unusedRuntime = {
  hasExpectedVersion: () => false,
  assertExpectedVersion: () => {},
  createEvent: () => { throw new Error("unused"); },
  annotateEvent: (_command, event) => event,
  persist: () => { throw new Error("unused"); },
  persistNoChange: () => { throw new Error("unused"); },
  now: () => "2026-08-17T00:00:00.000Z",
};

test("Task module owns the five core commands and exposes Task queries", () => {
  const persistence = new MemoryPersistence([
    { type: "task", id: "active", title: "Active", state: "todo", priority: "normal", version: 1 },
    { type: "task", id: "deleted", title: "Deleted", state: "todo", priority: "normal", version: 2, deleted_at: "2026-08-16T00:00:00.000Z" },
  ]);
  const task = createTaskModule(persistence, unusedRuntime);
  for (const name of ["CreateTask", "UpdateTask", "DeleteTask", "CompleteTask", "ReopenTask"]) assert.equal(task.commands.handles(name), true, name);
  assert.equal(task.commands.handles("CreateTaskFromCapture"), false);
  assert.equal(task.queries.getTask("active")?.title, "Active");
  assert.equal(task.queries.getTask("deleted"), null);
  assert.equal(task.queries.listTasks().length, 1);
  assert.equal(task.queries.listTasks(true).length, 2);
});

test("legacy ApplicationCommandService delegates core Task logic through the public module", () => {
  const source = readFileSync("src/main/services/applicationCommandService.ts", "utf8");
  assert.match(source, /createTaskModule\(this\.repository, taskCommandRuntime\(this\.repository\)\)/);
  assert.doesNotMatch(source, /private\s+(?:saveTask|transitionTask|deleteTask)\s*\(/);
});
