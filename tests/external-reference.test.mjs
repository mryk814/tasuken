import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { normalizeExternalReference } from "../src/shared/externalReference.mjs";
import { validateMcpProposalEnvelope } from "./fixtures/legacyProposalInbox.mjs";

test("GitLab Merge Request external reference is provider-neutral, HTTPS-only, and credential-free", () => {
  const reference = normalizeExternalReference({
    kind: "merge_request",
    provider: "gitlab",
    display_label: "!42",
    url: "https://gitlab.example/group/project/-/merge_requests/42?utm_source=agent#discussion",
    external_id: "42",
    unknown_secret: "drop",
  });
  assert.deepEqual(reference, {
    kind: "merge_request",
    provider: "gitlab",
    display_label: "!42",
    url: "https://gitlab.example/group/project/-/merge_requests/42",
    external_id: "42",
  });
  assert.throws(
    () =>
      normalizeExternalReference({
        kind: "merge_request",
        provider: "gitlab",
        display_label: "!42",
        url: "https://user:password@gitlab.example/group/project/-/merge_requests/42",
      }),
    /credential/,
  );
  assert.throws(
    () =>
      normalizeExternalReference({
        kind: "merge_request",
        provider: "gitlab",
        display_label: "!42",
        url: "http://gitlab.example/group/project/-/merge_requests/42",
      }),
    /HTTPS/,
  );
});

test("MCP task_work Proposal normalizes external references before Inbox persistence", () => {
  const envelope = validateMcpProposalEnvelope({
    schema_version: 1,
    id: "12345678-1234-1234-1234-123456789abc",
    created_at: "2026-08-09T00:00:00.000Z",
    source_app: "gitlab-agent",
    payload_type: "task_work",
    payload: {
      task_work: [
        {
          action: "report_done",
          task_id: "task-1",
          expected_version: 3,
          caller: "gitlab-agent",
          executor_kind: "ai_agent",
          executor_label: "GitLab agent",
          summary: "MRを作成しました",
          external_references: [
            {
              kind: "merge_request",
              provider: "gitlab",
              display_label: "!42",
              url: "https://gitlab.example/group/project/-/merge_requests/42?utm_source=agent#changes",
              external_id: "42",
            },
          ],
        },
      ],
    },
  });
  assert.deepEqual(envelope.payload.task_work[0].external_references, [
    {
      kind: "merge_request",
      provider: "gitlab",
      display_label: "!42",
      url: "https://gitlab.example/group/project/-/merge_requests/42",
      external_id: "42",
    },
  ]);
  assert.throws(
    () =>
      validateMcpProposalEnvelope({
        ...envelope,
        id: "12345678-1234-1234-1234-123456789abd",
        payload: {
          task_work: [
            {
              ...envelope.payload.task_work[0],
              external_references: [
                {
                  kind: "merge_request",
                  provider: "gitlab",
                  display_label: "!42",
                  url: "https://gitlab.example/group/project/-/merge_requests/42?access_token=secret",
                },
              ],
            },
          ],
        },
      }),
    /credential\/token/,
  );
});

test("Receipt UI keeps external references compact and delegates task_work application to Main", () => {
  const drawer = fs.readFileSync(
    "src/renderer/src/features/workspace/components/drawer.tsx",
    "utf8",
  );
  const panel = fs.readFileSync(
    "src/renderer/src/features/workspace/components/AiProposalPanel.tsx",
    "utf8",
  );
  const command = fs.readFileSync("src/main/services/applicationCommandService.ts", "utf8");
  assert.match(drawer, /task-work-external-references/);
  assert.match(drawer, /target="_blank" rel="noreferrer"/);
  assert.doesNotMatch(panel, /external_references: normalizeExternalReferences/);
  assert.match(panel, /name: "ApplyTaskWorkProposal"/);
  assert.match(
    panel,
    /payload:\s*\{\s*proposalId: proposal\.id,\s*decision: "accept",\s*coveredProposalIds:/,
  );
  assert.match(command, /normalizeExternalReferences\(entry\.external_references\)/);
  assert.match(command, /normalizeExternalReferences\(payload\.receipt\.external_references\)/);
});
