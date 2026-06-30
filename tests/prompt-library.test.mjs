import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(relativePath)],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const prompts = await importBundled("src/renderer/src/features/workspace/lib/prompts.ts");

test("prompt helpers classify report prompts and reusable prompt notes", () => {
  const reportPrompt = { note_type: "report_prompt", properties_json: {} };
  const knowledgePrompt = { note_type: "prompt", properties_json: { prompt_purpose: "knowledge", prompt_variables: "themeName", is_default: true } };
  const memo = { note_type: "memo", properties_json: {} };

  assert.equal(prompts.isPromptNote(reportPrompt), true);
  assert.equal(prompts.promptPurpose(reportPrompt), "report");
  assert.equal(prompts.isPromptNote(knowledgePrompt), true);
  assert.equal(prompts.promptPurpose(knowledgePrompt), "knowledge");
  assert.equal(prompts.promptVariables(knowledgePrompt), "themeName");
  assert.equal(prompts.isDefaultPrompt(knowledgePrompt), true);
  assert.equal(prompts.isPromptNote(memo), false);
});
