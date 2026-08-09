import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLegacyRelationAlias,
  decideRelationProposal,
  normalizeReferenceAssertion,
} from "../src/shared/relationAssertion.mjs";

test("legacy Reference reads as a canonical assertion without mutating the row", () => {
  const legacy = {
    id: "ref-legacy",
    source_type: "note",
    source_id: "note-1",
    target_type: "resource",
    target_id: "chat-1",
    relation_type: "derived_from",
    source: "legacy",
  };
  const before = structuredClone(legacy);
  const assertion = normalizeReferenceAssertion(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(assertion.assertion_id, "ref-legacy");
  assert.deepEqual(assertion.subject, { type: "note", id: "note-1" });
  assert.deepEqual(assertion.object, { type: "resource", id: "chat-1" });
  assert.equal(assertion.layer, "operational");
  assert.equal(assertion.status, "asserted");
  assert.equal(assertion.origin, "migration");
});

test("legacy-only predicates remain projection-readable but cannot be written", () => {
  const legacy = {
    id: "ref-context",
    source_type: "task",
    source_id: "task-1",
    target_type: "note",
    target_id: "note-1",
    relation_type: "context",
  };
  assert.equal(normalizeReferenceAssertion(legacy, { legacyRead: true }).predicate, "context");
  assert.throws(() => normalizeReferenceAssertion(legacy, { writeBoundary: true }), /predicate/);
});

test("canonical writes keep typed identity, provenance metadata, and compatibility aliases", () => {
  const assertion = normalizeReferenceAssertion({
    id: "assertion-1",
    assertion_id: "assertion-1",
    subject: { type: "note", id: "note-1" },
    predicate: "links_to",
    object: { type: "task", id: "task-1" },
    layer: "provenance",
    status: "asserted",
    origin: "user",
    evidence_refs: [{ type: "note", id: "note:1" }, { type: "note", id: "note:1" }, { type: "resource", id: "chat-1" }],
    confidence: 0.8,
    metadata: { raw_alias: "Task One", source_span: { start: 12, end: 22 } },
  }, { writeBoundary: true });
  assert.deepEqual(assertion.evidence_refs, [{ type: "note", id: "note:1" }, { type: "resource", id: "chat-1" }]);
  assert.equal(assertion.source_type, "note");
  assert.equal(assertion.target_id, "task-1");
  assert.equal(assertion.relation_type, "links_to");
});

test("canonical write boundary keeps suggestions and rejections in Proposal records", () => {
  const relation = {
    id: "suggestion-1",
    subject: { type: "note", id: "note-1" },
    predicate: "links_to",
    object: { type: "task", id: "task-1" },
    layer: "operational",
    origin: "ai_suggested",
  };
  assert.throws(() => normalizeReferenceAssertion({ ...relation, status: "suggested" }, { writeBoundary: true }), /Proposal decision/);
  assert.throws(() => normalizeReferenceAssertion({ ...relation, status: "rejected" }, { writeBoundary: true }), /Proposal decision/);
  assert.throws(() => normalizeReferenceAssertion({ ...relation, status: "asserted", layer: "semantic" }, { writeBoundary: true }), /accepted Proposal/);
  assert.throws(() => normalizeReferenceAssertion({ ...relation, status: "asserted", layer: "semantic", origin: "user" }, { writeBoundary: true }), /accepted Proposal/);

  const facts = [normalizeReferenceAssertion({ ...relation, id: "fact-1", status: "asserted", origin: "user" }, { writeBoundary: true })];
  const proposal = { id: "proposal-1", status: "pending", assertion: { ...relation, status: "asserted" } };
  for (const decision of ["reject", "dismiss"]) {
    const result = decideRelationProposal(facts, proposal, decision);
    assert.deepEqual(result.assertions, facts);
    assert.notStrictEqual(result.assertions, facts);
    assert.equal(facts[0].status, "asserted");
  }
  const accepted = decideRelationProposal(facts, {
    ...proposal,
    id: "proposal-semantic",
    decided_at: "2026-08-09T00:00:00.000Z",
    assertion: { ...relation, layer: "semantic", status: "suggested" },
  }, "accept");
  assert.equal(accepted.assertions.at(-1).status, "asserted");
  assert.equal(accepted.assertions.at(-1).layer, "semantic");
  assert.equal(accepted.assertions.at(-1).metadata.accepted_from_proposal_id, "proposal-semantic");
});

test("superseded assertions remain valid durable history", () => {
  assert.throws(() => normalizeReferenceAssertion({
    id: "assertion-missing-successor",
    subject: { type: "note", id: "note-1" },
    predicate: "links_to",
    object: { type: "task", id: "task-1" },
    layer: "operational",
    status: "superseded",
    origin: "user",
  }, { writeBoundary: true }), /置き換え先/);
  const assertion = normalizeReferenceAssertion({
    id: "assertion-old",
    subject: { type: "note", id: "note-1" },
    predicate: "links_to",
    object: { type: "task", id: "task-1" },
    layer: "operational",
    status: "superseded",
    origin: "user",
    superseded_by_assertion_id: "assertion-new",
  }, { writeBoundary: true });
  assert.equal(assertion.status, "superseded");
  assert.equal(assertion.superseded_by_assertion_id, "assertion-new");
});

test("legacy title aliases are classified without an implicit rewrite", () => {
  const candidates = [
    { type: "note", id: "n-1", title: "Exact" },
    { type: "task", id: "t-1", title: "Duplicate" },
    { type: "note", id: "n-2", title: "Duplicate" },
  ];
  assert.deepEqual(classifyLegacyRelationAlias("Exact", candidates), {
    raw_alias: "Exact",
    resolution: "migration_candidate",
    candidates: [{ type: "note", id: "n-1" }],
  });
  assert.equal(classifyLegacyRelationAlias("Duplicate", candidates).resolution, "ambiguous");
  assert.equal(classifyLegacyRelationAlias("Missing", candidates).resolution, "unresolved");
});
