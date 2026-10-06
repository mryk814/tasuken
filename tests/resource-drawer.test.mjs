import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual field component; only React and unrelated field widgets
// are fixtures, so candidate selection stays owned by the renderer.
function renderResourceFields(entity, data) {
  const source = readFileSync("src/renderer/src/features/workspace/components/drawer.tsx", "utf8");
  const tree = ts.createSourceFile(
    "drawer.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const field = tree.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ResourceFields",
  );
  assert.ok(field);
  const code = ts.transpileModule(field.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const sandbox = {
    React: {
      Fragment: "fragment",
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children: children.flat(Infinity),
      }),
    },
    Field: "Field",
    ThemeSelect: "ThemeSelect",
    ChatGroupPicker: "ChatGroupPicker",
    useState: (value) => [value, () => {}],
    str: (value) => (typeof value === "string" ? value : ""),
    canonicalThemeId: (value) => value,
    isChatReferenceEntity: (value) =>
      value.link_type === "chatgpt" || value.url?.startsWith("https://chatgpt.com/"),
    initialChatLinkType: () => "chatgpt",
    normalizeReferenceStatus: () => "active",
    chatDateInput: () => "",
    CHAT_SERVICE_TYPES: [],
    CHAT_SERVICE_LABELS: {},
    CHAT_REFERENCE_STATUSES: [],
    CHAT_REFERENCE_STATUS_LABELS: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nthis.render = ResourceFields;`, sandbox);
  return sandbox.render({ entity, data });
}

function nodes(root) {
  return [
    root,
    ...(root?.children || []).flatMap((child) =>
      typeof child === "object" && child ? nodes(child) : [],
    ),
  ];
}

test("元チャット候補は正本Resourceを優先し旧Linkを重複表示しない", () => {
  const resource = {
    id: "parent",
    title: "正本の会話",
    project_id: "theme",
    url: "https://chatgpt.com/c/parent",
    link_type: "chatgpt",
  };
  const legacy = {
    id: "legacy",
    title: "旧Linkだけの会話",
    theme_id: "theme",
    url: "https://chatgpt.com/c/legacy",
  };
  const root = renderResourceFields(
    { id: "self", project_id: "theme", link_type: "chatgpt" },
    {
      themes: [],
      resources: [
        resource,
        { ...resource, id: "self" },
        { ...resource, id: "other", project_id: "other-theme" },
      ],
      links: [{ ...legacy, id: "parent", title: "旧タイトル" }, legacy],
    },
  );
  const select = nodes(root).find(
    (node) => node.type === "select" && node.props.name === "parent_resource_id",
  );
  const options = nodes(select).filter((node) => node.type === "option" && node.props.value);
  assert.deepEqual(
    options.map((node) => node.props.value),
    ["parent", "legacy"],
  );
  assert.equal(options[0].children[0], "正本の会話");
  assert.equal(new Set(options.map((node) => node.props.key)).size, options.length);
});
