import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const file = "src/renderer/src/features/workspace/components/MarkdownRichEditor.tsx";
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let onChange, getMarkdown;
function visit(node) {
  if (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    node.tagName.getText(ast) === "MDXEditor"
  ) {
    const attr = node.attributes.properties.find((a) => a.name?.getText(ast) === "onChange");
    onChange = attr.initializer.expression.getText(ast);
  }
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "getMarkdown")
    getMarkdown = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function harness() {
  const body = "    # shell comment\n    echo ok";
  const changes = [];
  const context = vm.createContext({
    markdown: body,
    editedRef: { current: false },
    lastInternalMarkdown: { current: body },
    editorRef: { current: { getMarkdown: () => "# shell comment\n\necho ok" } },
    normalizeRichEditorMarkdown: (v) => v,
    restoreAmbiguousMarkdownComparisons: (v) => v,
    onChange: (v) => changes.push(v),
  });
  vm.runInContext(`globalThis.changed = ${onChange}; globalThis.read = ${getMarkdown}`, context);
  return { context, changes, body };
}
test("initial Rich Editor normalization is not an edit and does not replace imported Markdown", () => {
  const h = harness();
  h.context.changed("# shell comment\n\necho ok", true);
  assert.deepEqual(h.changes, []);
  assert.equal(h.context.read(), h.body);
});
test("an actual Rich Editor change makes its latest Markdown available to the save flush", () => {
  const h = harness();
  h.context.changed("# shell comment\n\necho ok", false);
  assert.deepEqual(h.changes, ["# shell comment\n\necho ok"]);
  assert.equal(h.context.read(), "# shell comment\n\necho ok");
});
test("MDXEditor initial import respects trim=false for leading indented code", () => {
  const core = readFileSync("node_modules/@mdxeditor/editor/dist/plugins/core/index.js", "utf8");
  const statement = core.split("\n").find((line) => line.includes("const markdown = (params"));
  const context = vm.createContext({
    params: { trim: false, initialMarkdown: "    # shell comment\n    echo ok" },
  });
  vm.runInContext(`${statement};globalThis.body=markdown`, context);
  assert.equal(context.body, context.params.initialMarkdown);
});
