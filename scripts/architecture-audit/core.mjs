import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "out", "release", "mcp-dist"]);

export function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function filesUnder(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!statSync(absoluteRoot, { throwIfNoEntry: false })) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) files.push(normalizePath(path.relative(root, absolute)));
    }
  };
  visit(absoluteRoot);
  return files.sort();
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function collectImports(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const imports = [];
  const add = (specifier, node, kind) => {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    imports.push({ specifier, kind, line: location.line + 1 });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.moduleSpecifier, "import");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.moduleSpecifier, node.exportClause ? "re-export" : "export-all");
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])) {
      add(node.arguments[0].text, node.arguments[0], "dynamic-import");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function loadTsconfigAliases(root, tsconfigPaths) {
  const aliases = [];
  for (const configPath of tsconfigPaths || []) {
    const absolute = path.join(root, configPath);
    if (!statSync(absolute, { throwIfNoEntry: false })) continue;
    const parsed = ts.parseConfigFileTextToJson(absolute, readFileSync(absolute, "utf8"));
    const compilerOptions = parsed.config?.compilerOptions || {};
    const baseUrl = normalizePath(path.join(path.dirname(configPath), compilerOptions.baseUrl || "."));
    for (const [pattern, targets] of Object.entries(compilerOptions.paths || {})) {
      for (const target of targets) aliases.push({ pattern, target: normalizePath(path.join(baseUrl, target)) });
    }
  }
  return aliases;
}

function aliasCandidate(specifier, alias) {
  const star = alias.pattern.indexOf("*");
  if (star < 0) return specifier === alias.pattern ? alias.target : null;
  const prefix = alias.pattern.slice(0, star);
  const suffix = alias.pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
  return alias.target.replace("*", captured);
}

function resolveSourcePath(candidate, fileSet) {
  const normalized = normalizePath(path.normalize(candidate));
  const candidates = [normalized];
  if (!SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    for (const extension of SOURCE_EXTENSIONS) candidates.push(normalized + extension);
    for (const extension of SOURCE_EXTENSIONS) candidates.push(normalized + "/index" + extension);
  }
  return candidates.find((entry) => fileSet.has(entry)) || null;
}

export function resolveImport({ sourceFile, specifier, fileSet, aliases = [] }) {
  if (/\.(?:css|html|svg|png|jpe?g|gif|woff2?|wasm)$/i.test(specifier)) return `asset:${specifier}`;
  if (specifier.startsWith(".")) {
    return resolveSourcePath(path.join(path.dirname(sourceFile), specifier), fileSet) || `unresolved:${specifier}`;
  }
  for (const alias of aliases) {
    const candidate = aliasCandidate(specifier, alias);
    if (candidate) return resolveSourcePath(candidate, fileSet) || `unresolved:${specifier}`;
  }
  return `external:${specifier}`;
}

function moduleFor(file, modules) {
  if (!file || file.startsWith("external:") || file.startsWith("unresolved:")) return null;
  return [...modules]
    .sort((left, right) => right.root.length - left.root.length)
    .find((module) => file === module.root || file.startsWith(module.root + "/")) || null;
}

function isPublicTarget(target, module) {
  return (module.publicEntrypoints || []).includes(target);
}

function matchesExternal(target, names) {
  return names.some((name) => target === `external:${name}` || target.startsWith(`external:${name}/`));
}

function fingerprint(finding) {
  return [finding.ruleId, finding.source, finding.target || ""].join("|");
}

function finding(ruleId, source, line, target, reason, alternative) {
  return { ruleId, source: normalizePath(source), line, target: normalizePath(target || ""), reason, alternative };
}

function inspectImport(edge, sourceModule, targetModule, policy) {
  const findings = [];
  const rendererSource = edge.source.startsWith("src/renderer/");
  const sharedSource = sourceModule?.kind === "shared-contract";
  if (rendererSource && (edge.target.startsWith("src/main/") || edge.target.startsWith("src/preload/")
      || matchesExternal(edge.target, ["electron", "node:fs", "node:path", "better-sqlite3"]))) {
    findings.push(finding(
      "runtime.renderer_isolation",
      edge.source,
      edge.line,
      edge.target,
      "Renderer source depends on a Main, Preload, Electron, Node filesystem, or SQLite runtime.",
      "Call a typed renderer client backed by a Preload capability.",
    ));
  }
  if (sharedSource && (edge.target.startsWith("src/main/") || edge.target.startsWith("src/preload/")
      || edge.target.startsWith("src/renderer/") || matchesExternal(edge.target, ["electron", "react", "zustand", "node:fs", "node:path", "better-sqlite3"]))) {
    findings.push(finding(
      "runtime.shared_neutrality",
      edge.source,
      edge.line,
      edge.target,
      "Shared source depends on a feature, platform, UI, filesystem, or database runtime.",
      "Move the dependency behind a Main/Renderer adapter and keep the shared contract runtime-neutral.",
    ));
  }
  if (sourceModule?.kind === "renderer-feature" && targetModule?.kind === "renderer-feature" && sourceModule.id !== targetModule.id) {
    if (!isPublicTarget(edge.target, targetModule)) {
      findings.push(finding(
        "renderer.cross_feature_deep_import",
        edge.source,
        edge.line,
        edge.target,
        `Renderer feature '${sourceModule.id}' imports internal source from '${targetModule.id}'.`,
        targetModule.publicEntrypoints?.length
          ? `Import '${targetModule.publicEntrypoints[0]}' or define a contribution at the app composition layer.`
          : `Define a public entrypoint for '${targetModule.id}' or move the interaction to the app composition layer.`,
      ));
    }
  }
  if (sourceModule && targetModule && sourceModule.id !== targetModule.id
      && Array.isArray(sourceModule.allowedDependencies)
      && !sourceModule.allowedDependencies.includes(targetModule.id)) {
    findings.push(finding(
      "module.undeclared_dependency",
      edge.source,
      edge.line,
      edge.target,
      `Module '${sourceModule.id}' depends on undeclared module '${targetModule.id}'.`,
      "Use an allowed public contract or record the reviewed edge in architecture/modules.json.",
    ));
  }
  if (sourceModule && targetModule && sourceModule.id !== targetModule.id
      && targetModule.publicEntrypoints?.length && !isPublicTarget(edge.target, targetModule)
      && (targetModule.enforcePublicApi === true || sourceModule.kind === "renderer-feature")) {
    findings.push(finding(
      "module.public_api_bypass",
      edge.source,
      edge.line,
      edge.target,
      `Module '${sourceModule.id}' bypasses the public API of '${targetModule.id}'.`,
      `Import '${targetModule.publicEntrypoints[0]}'.`,
    ));
  }
  if (edge.source.startsWith("tests/") && targetModule?.publicEntrypoints?.length && !isPublicTarget(edge.target, targetModule)) {
    const owner = (policy.testOwnership || []).find((entry) => normalizePath(entry.source) === edge.source)?.module;
    if (owner !== targetModule.id) {
      findings.push(finding(
        "test.cross_module_internal_import",
        edge.source,
        edge.line,
        edge.target,
        `Test imports internal source from module '${targetModule.id}' without same-module ownership.`,
        `Import '${targetModule.publicEntrypoints[0]}' or declare exact same-module test ownership in architecture/modules.json.`,
      ));
    }
  }
  if (sourceModule?.kind === "main-application" && matchesExternal(edge.target, ["electron"])) {
    findings.push(finding(
      "main.application_platform_import",
      edge.source,
      edge.line,
      edge.target,
      "Main application code imports Electron directly.",
      "Depend on a port and provide its Electron implementation from the composition root.",
    ));
  }
  if (sourceModule?.kind === "main-transport" && targetModule?.kind === "main-infrastructure") {
    findings.push(finding(
      "main.transport_repository_import",
      edge.source,
      edge.line,
      edge.target,
      "A transport adapter imports repository implementation details.",
      "Call an application capability exposed by the feature public registration.",
    ));
  }
  if (sourceModule?.kind === "main-infrastructure" && (edge.target.startsWith("src/renderer/") || edge.target.startsWith("src/preload/"))) {
    findings.push(finding(
      "main.infrastructure_reverse_dependency",
      edge.source,
      edge.line,
      edge.target,
      "Main infrastructure depends on Renderer or Preload source.",
      "Keep the repository behind an application port and return shared contract values.",
    ));
  }
  if (targetModule?.kind === "composition-root" && sourceModule && sourceModule.id !== targetModule.id
      && sourceModule.kind !== "composition-root") {
    findings.push(finding(
      "bootstrap.internal_import",
      edge.source,
      edge.line,
      edge.target,
      "Feature or platform code imports composition-root internals.",
      "Expose a feature public registration or move wiring into the composition root.",
    ));
  }
  if (edge.kind === "export-all" && targetModule && sourceModule?.id !== targetModule.id) {
    findings.push(finding(
      "module.cross_module_export_all",
      edge.source,
      edge.line,
      edge.target,
      "A cross-module export-all can expose internal symbols through a barrel.",
      "Re-export only the explicit public contract symbols.",
    ));
  }
  if (edge.target.startsWith("unresolved:") && !policy.ignoreUnresolved?.includes(edge.specifier)) {
    findings.push(finding(
      "resolver.unresolved_import",
      edge.source,
      edge.line,
      edge.target,
      `Import '${edge.specifier}' did not resolve to a known source file.`,
      "Fix the import or declare the applicable tsconfig path mapping in architecture/modules.json.",
    ));
  }
  return findings;
}

function importCountFor(file, importsByFile) {
  return importsByFile.get(file)?.length || 0;
}

function lineCount(source) {
  if (source === "") return 0;
  const lines = source.split(/\r?\n/);
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

function scanTextRules(file, source, policy) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  const addMatches = (ruleId, pattern, reason, alternative, allowedPaths = []) => {
    if (allowedPaths.some((allowed) => file === allowed || file.startsWith(allowed.endsWith("/") ? allowed : allowed + "/"))) return;
    lines.forEach((text, index) => {
      if (pattern.test(text)) findings.push(finding(ruleId, file, index + 1, "", reason, alternative));
      pattern.lastIndex = 0;
    });
  };
  if (file.startsWith("src/renderer/")) {
    addMatches(
      "capability.renderer_direct_window_api",
      /\bwindow\.(?:api|researchDesk)\b/,
      "Renderer source calls the aggregate Preload API outside a declared adapter.",
      "Call a typed feature client in src/renderer/src/services or the feature public API.",
      policy.capabilities?.rendererAdapterPaths || [],
    );
  }
  if (file.startsWith("src/main/")) {
    addMatches(
      "capability.ipc_registration_outside_manifest",
      /\bipcMain\.(?:handle|on)\s*\(/,
      "IPC is registered outside a declared transport registrar.",
      "Register the capability through a manifest-declared feature registrar.",
      policy.capabilities?.ipcRegistrarPaths || [],
    );
  }
  if (/src\/shared\/(?:kernel|contracts)\//.test(file)) {
    addMatches(
      "contract.unsafe_boundary_cast",
      /\bas\s+unknown\s+as\b|:\s*any\b|\bas\s+any\b/,
      "A shared public contract boundary contains a blanket any or double assertion.",
      "Parse unknown input into the canonical contract type before forwarding it.",
    );
  }
  return findings;
}

function pairedDeclarations(files) {
  const set = new Set(files);
  return files
    .filter((file) => file.endsWith(".mjs") && set.has(file.slice(0, -4) + ".d.mts"))
    .map((file) => ({ implementation: file, declaration: file.slice(0, -4) + ".d.mts" }));
}

function importedNames(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const names = new Set();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    if (node.importClause.name) names.add(node.importClause.name.text);
    const bindings = node.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  });
  return names;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText();
}

function capabilitySurfaces(files, contents) {
  const surfaces = [];
  for (const file of files.filter((entry) => entry.startsWith("src/preload/"))) {
    const source = contents.get(file);
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
    const objects = new Map();
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        objects.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    const visit = (node) => {
      if (ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(sourceFile) === "contextBridge"
          && node.expression.name.text === "exposeInMainWorld"
          && node.arguments.length >= 2
          && ts.isStringLiteralLike(node.arguments[0])) {
        const value = node.arguments[1];
        const object = ts.isObjectLiteralExpression(value) ? value : ts.isIdentifier(value) ? objects.get(value.text) : null;
        const properties = object
          ? object.properties
            .filter((property) => property.name)
            .map((property) => propertyName(property.name))
            .sort()
          : [];
        surfaces.push({ file, global: node.arguments[0].text, properties, propertyCount: properties.length });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return surfaces.sort((left, right) => `${left.file}|${left.global}`.localeCompare(`${right.file}|${right.global}`));
}

function compareCapabilitySurfaces(current, baseline) {
  return current.map((surface) => {
    const previous = (baseline.surfaces || []).find((entry) => entry.file === surface.file && entry.global === surface.global);
    const baselineProperties = previous?.properties || [];
    return {
      ...surface,
      baselineProperties,
      added: surface.properties.filter((property) => !baselineProperties.includes(property)),
      removed: baselineProperties.filter((property) => !surface.properties.includes(property)),
    };
  });
}

function compatibilityInventory(files, contents, importsByFile, pairs) {
  const categories = new Map([
    ["generic-entity-api", new Set()],
    ["workspace-service", new Set()],
    ["workspace-repository", new Set()],
    ["global-workspace-snapshot", new Set()],
    ["research-desk-api", new Set()],
    ["legacy-workspace-data", new Set()],
    ["mjs-dmts-pair", new Set(pairs.map((pair) => pair.implementation))],
    ["renderer-workspace-internals", new Set()],
  ]);
  for (const file of files) {
    const source = contents.get(file);
    if (/\b(?:entities|workspaceApi)\.(?:get|save|saveMany|remove|restore)\s*\(/.test(source)) categories.get("generic-entity-api").add(file);
    if (importsByFile.get(file)?.some((entry) => /(?:^|\/)workspaceService$/.test(entry.specifier.replace(/\.(?:ts|js|mjs)$/, "")))) categories.get("workspace-service").add(file);
    if (importsByFile.get(file)?.some((entry) => /(?:^|\/)workspaceRepository(?:\.mjs)?$/.test(entry.specifier))) categories.get("workspace-repository").add(file);
    if (/\b(?:workspaceApi\.load|window\.(?:api|researchDesk)\.workspace\.load|desktopApi\(\)\.workspace\.load)\s*\(/.test(source)) categories.get("global-workspace-snapshot").add(file);
    const names = importedNames(source, file);
    if (names.has("ResearchDeskApi") || /interface\s+ResearchDeskApi\b/.test(source)) categories.get("research-desk-api").add(file);
    if (names.has("WorkspaceData") || /interface\s+WorkspaceData\b/.test(source)) categories.get("legacy-workspace-data").add(file);
    if (importsByFile.get(file)?.some((entry) => /features\/workspace\/(?:lib|types)(?:\/|$)/.test(entry.target || ""))) categories.get("renderer-workspace-internals").add(file);
  }
  return Object.fromEntries([...categories].map(([id, entries]) => [id, [...entries].sort()]));
}

function compareCompatibility(current, baseline) {
  return Object.keys(current).sort().map((id) => {
    const currentPaths = current[id] || [];
    const baselinePaths = baseline.categories?.[id]?.consumerPaths || [];
    return {
      id,
      currentPaths,
      baselinePaths,
      added: currentPaths.filter((file) => !baselinePaths.includes(file)),
      removed: baselinePaths.filter((file) => !currentPaths.includes(file)),
    };
  });
}

function validateGeneratedSources(root, files, generatedPolicy) {
  const findings = [];
  const inventory = (generatedPolicy.entries || []).map((entry) => ({ ...entry, path: normalizePath(entry.path) }));
  for (const entry of inventory) {
    const missing = ["path", "kind", "source", "version", "regenerationCommand", "owner"].filter((key) => !entry[key]);
    if (missing.length) {
      findings.push(finding("generated.invalid_manifest_entry", entry.path || "architecture/generated-sources.json", 1, "", `Generated/vendor entry is missing: ${missing.join(", ")}.`, "Record path, kind, source, version, regeneration command, and owner."));
    } else if (!files.includes(entry.path) && !statSync(path.join(root, entry.path), { throwIfNoEntry: false })) {
      findings.push(finding("generated.missing_source", entry.path, 1, "", "Generated/vendor manifest points to a missing file.", "Regenerate the file or remove the stale manifest entry."));
    }
  }
  const registered = new Set(inventory.map((entry) => entry.path));
  for (const file of files) {
    const header = readFileSync(path.join(root, file), "utf8").slice(0, 2000);
    if (/\b(?:auto-generated|generated file|do not edit)\b/i.test(header) && !registered.has(file)) {
      findings.push(finding("generated.unregistered_source", file, 1, "", "A generated-source marker exists outside the generated/vendor manifest.", "Record provenance and the regeneration command in architecture/generated-sources.json."));
    }
  }
  return { inventory, findings };
}

function suppressionPolicyFindings(suppressions, today) {
  const findings = [];
  for (const entry of suppressions.entries || []) {
    const source = normalizePath(entry.source || "architecture/suppressions.json");
    const missing = ["rule", "source", "reason", "owner", "issue"].filter((key) => !entry[key]);
    if (entry.issue && !Number.isInteger(entry.issue)) missing.push("integer issue");
    if (!entry.expiresAt && !entry.removalCondition) missing.push("expiresAt or removalCondition");
    if (entry.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresAt)) missing.push("ISO expiresAt");
    if (missing.length || source.includes("*") || String(entry.target || "").includes("*")) {
      findings.push(finding(
        "suppression.invalid_debt_record",
        source,
        1,
        normalizePath(entry.target || ""),
        `Suppression is not narrowly tracked (${missing.join(", ") || "wildcard source/target"}).`,
        "Record an exact source/target, reason, owner, tracking issue, and expiry or removal condition.",
      ));
    }
    if (entry.expiresAt && entry.expiresAt < today) {
      findings.push(finding(
        "suppression.expired",
        source,
        1,
        normalizePath(entry.target || ""),
        `Suppression expired on ${entry.expiresAt}.`,
        "Remove the debt, renew it with explicit review, or complete the tracked migration.",
      ));
    }
  }
  return findings;
}

function applySuppression(findingEntry, suppressions, today) {
  const matching = (suppressions.entries || []).find((entry) => entry.rule === findingEntry.ruleId
    && normalizePath(entry.source) === findingEntry.source
    && normalizePath(entry.target || "") === findingEntry.target);
  if (!matching) return { ...findingEntry, suppressed: false, suppression: null };
  const validDebt = matching.reason && matching.owner && Number.isInteger(matching.issue)
    && (matching.expiresAt || matching.removalCondition);
  const expired = Boolean(matching.expiresAt && matching.expiresAt < today);
  return { ...findingEntry, suppressed: validDebt && !expired, suppression: { ...matching, validDebt: Boolean(validDebt), expired } };
}

export function analyzeArchitecture({ root, policy, compatibilityBaseline, violationBaseline, compositionBaseline, capabilityBaseline = { surfaces: [] }, generatedPolicy, suppressions, today = new Date().toISOString().slice(0, 10) }) {
  const sourceRoots = policy.sourceRoots || ["src"];
  const fixtureRoots = (policy.fixtureRoots || []).map(normalizePath);
  const files = [...new Set(sourceRoots.flatMap((sourceRoot) => filesUnder(root, sourceRoot)))]
    .filter((file) => !fixtureRoots.some((fixtureRoot) => file === fixtureRoot || file.startsWith(fixtureRoot + "/")))
    .sort();
  const fileSet = new Set(files);
  const aliases = loadTsconfigAliases(root, policy.tsconfigPaths || []);
  const contents = new Map(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
  const importsByFile = new Map();
  const edges = [];
  for (const file of files) {
    const imports = collectImports(file, contents.get(file));
    const resolved = imports.map((entry) => ({
      ...entry,
      source: file,
      target: resolveImport({ sourceFile: file, specifier: entry.specifier, fileSet, aliases }),
    }));
    importsByFile.set(file, resolved);
    edges.push(...resolved);
  }
  const modules = (policy.modules || []).map((module) => ({
    ...module,
    root: normalizePath(module.root),
    publicEntrypoints: (module.publicEntrypoints || []).map(normalizePath),
    allowedDependencies: module.allowedDependencies || policy.allowedEdges?.[module.id],
  }));
  const findings = [];
  for (const edge of edges) findings.push(...inspectImport(edge, moduleFor(edge.source, modules), moduleFor(edge.target, modules), policy));
  for (const file of files) findings.push(...scanTextRules(file, contents.get(file), policy));
  for (const module of modules) {
    if (module.kind === "renderer-feature" && module.publicEntrypoints.length === 0) {
      findings.push(finding("module.missing_public_entrypoint", module.root, 1, "", `Renderer feature '${module.id}' has no declared public entrypoint.`, `Create '${module.root}/public.ts' when the feature boundary is migrated.`));
    }
  }
  const pairs = pairedDeclarations(files);
  for (const pair of pairs) {
    findings.push(finding("contract.parallel_mjs_declaration", pair.implementation, 1, pair.declaration, "Runtime .mjs and hand-maintained .d.mts declarations form a parallel type boundary.", "Move the public contract to checked TypeScript or register the pair as compatibility debt until migration."));
  }
  const generated = validateGeneratedSources(root, files, generatedPolicy);
  findings.push(...generated.findings);
  findings.push(...suppressionPolicyFindings(suppressions, today));
  const capabilities = compareCapabilitySurfaces(capabilitySurfaces(files, contents), capabilityBaseline);
  for (const surface of capabilities) {
    for (const property of surface.added) {
      findings.push(finding(
        "capability.surface_expansion",
        surface.file,
        1,
        `${surface.global}.${property}`,
        `Preload surface '${surface.global}' exposes a capability absent from the Phase 0 baseline.`,
        "Expose the capability only on the window that needs it and update the reviewed surface contract after #405.",
      ));
    }
  }
  const compatibilityCurrent = compatibilityInventory(files, contents, importsByFile, pairs);
  const compatibility = compareCompatibility(compatibilityCurrent, compatibilityBaseline);
  const compositionRoots = (policy.compositionRoots || []).map((file) => {
    const source = contents.get(file) || "";
    const moduleDependencies = [...new Set((importsByFile.get(file) || []).map((edge) => moduleFor(edge.target, modules)?.id).filter(Boolean))].sort();
    const current = { file, lines: lineCount(source), imports: importCountFor(file, importsByFile), moduleDependencies: moduleDependencies.length };
    const baseline = compositionBaseline.roots?.find((entry) => entry.file === file) || null;
    return { ...current, baseline, increased: baseline ? current.lines > baseline.lines || current.imports > baseline.imports || current.moduleDependencies > baseline.moduleDependencies : true };
  });
  for (const entry of compatibility) {
    for (const source of entry.added) {
      findings.push(finding(
        "compatibility.consumer_added",
        source,
        1,
        entry.id,
        `Compatibility surface '${entry.id}' has a consumer absent from the Phase 0 baseline.`,
        "Use the feature capability/public contract, or add a time-bounded suppression tied to a tracking issue.",
      ));
    }
  }
  for (const entry of compositionRoots.filter((rootEntry) => rootEntry.increased && rootEntry.baseline)) {
    findings.push(finding(
      "composition.baseline_increase",
      entry.file,
      1,
      "",
      `Composition-root signals increased from ${entry.baseline.lines}/${entry.baseline.imports}/${entry.baseline.moduleDependencies} to ${entry.lines}/${entry.imports}/${entry.moduleDependencies} (lines/imports/module dependencies).`,
      "Move feature policy behind a public registration and keep this file focused on lifecycle and wiring.",
    ));
  }
  const baselineKeys = new Set(violationBaseline.findings || []);
  const uniqueFindings = [...new Map(findings.map((entry) => [fingerprint(entry), entry])).values()]
    .sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)))
    .map((entry) => {
      const withSuppression = applySuppression(entry, suppressions, today);
      return { ...withSuppression, fingerprint: fingerprint(entry), baseline: baselineKeys.has(fingerprint(entry)), rollout: "report-only" };
    });
  const moduleInventory = modules.map((module) => ({
    id: module.id,
    root: module.root,
    kind: module.kind,
    status: module.status || "inventory",
    publicEntrypoints: module.publicEntrypoints,
    allowedDependencies: module.allowedDependencies || [],
    files: files.filter((file) => moduleFor(file, modules)?.id === module.id).length,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const dependencies = edges.filter((edge) => !edge.target.startsWith("unresolved:"))
    .map((edge) => {
      const sourceModule = moduleFor(edge.source, modules);
      const targetModule = moduleFor(edge.target, modules);
      return {
        source: edge.source,
        sourceModule: sourceModule?.id || null,
        target: edge.target,
        targetModule: targetModule?.id || null,
        allowed: !sourceModule || !targetModule || sourceModule.id === targetModule.id
          || !Array.isArray(sourceModule.allowedDependencies)
          || sourceModule.allowedDependencies.includes(targetModule.id),
        kind: edge.kind,
        line: edge.line,
      };
    })
    .sort((left, right) => [left.source, left.line, left.target].join("|").localeCompare([right.source, right.line, right.target].join("|")));
  return {
    schemaVersion: 1,
    mode: "report-only",
    modules: moduleInventory,
    dependencies,
    compatibility,
    compositionRoots,
    capabilitySurfaces: capabilities,
    generatedSources: generated.inventory,
    findings: uniqueFindings,
    summary: {
      sourceFiles: files.length,
      modules: moduleInventory.length,
      dependencyEdges: dependencies.length,
      findings: uniqueFindings.length,
      baselineFindings: uniqueFindings.filter((entry) => entry.baseline).length,
      newFindings: uniqueFindings.filter((entry) => !entry.baseline).length,
      suppressedFindings: uniqueFindings.filter((entry) => entry.suppressed).length,
      compatibilityConsumers: compatibility.reduce((total, entry) => total + entry.currentPaths.length, 0),
      newCompatibilityConsumers: compatibility.reduce((total, entry) => total + entry.added.length, 0),
      newCapabilities: capabilities.reduce((total, entry) => total + entry.added.length, 0),
    },
  };
}

export function loadArchitectureConfig(root) {
  return {
    policy: readJson(root, "architecture/modules.json"),
    compatibilityBaseline: readJson(root, "architecture/compatibility-baseline.json"),
    violationBaseline: readJson(root, "architecture/violations-baseline.json"),
    compositionBaseline: readJson(root, "architecture/composition-baseline.json"),
    capabilityBaseline: readJson(root, "architecture/capability-baseline.json"),
    generatedPolicy: readJson(root, "architecture/generated-sources.json"),
    suppressions: readJson(root, "architecture/suppressions.json"),
  };
}

export function baselineDocuments(report) {
  return {
    compatibility: {
      schemaVersion: 1,
      issue: 408,
      categories: Object.fromEntries(report.compatibility.map((entry) => [entry.id, { consumerPaths: entry.currentPaths }])),
    },
    violations: { schemaVersion: 1, issue: 408, findings: report.findings.map((entry) => entry.fingerprint).sort() },
    composition: {
      schemaVersion: 1,
      issue: 408,
      roots: report.compositionRoots.map(({ file, lines, imports, moduleDependencies }) => ({ file, lines, imports, moduleDependencies })),
    },
    capabilities: {
      schemaVersion: 1,
      issue: 408,
      surfaces: report.capabilitySurfaces.map(({ file, global, properties }) => ({ file, global, properties })),
    },
  };
}

export function markdownReport(report) {
  const lines = [
    "# Architecture audit",
    "",
    "> Rollout: report-only. Findings do not fail CI during #408 Phase 1.",
    "",
    "## Summary",
    "",
    `- Source files: ${report.summary.sourceFiles}`,
    `- Modules: ${report.summary.modules}`,
    `- Dependency edges: ${report.summary.dependencyEdges}`,
    `- Findings: ${report.summary.findings} (${report.summary.newFindings} new candidates, ${report.summary.baselineFindings} baseline)`,
    `- Compatibility consumers: ${report.summary.compatibilityConsumers} (${report.summary.newCompatibilityConsumers} new candidates)`,
    `- Preload capabilities: ${report.capabilitySurfaces.reduce((total, entry) => total + entry.propertyCount, 0)} (${report.summary.newCapabilities} new candidates)`,
    "",
    "## Modules",
    "",
    "| Module | Kind | Status | Files | Public entrypoint |",
    "|---|---|---|---:|---|",
    ...report.modules.map((module) => `| ${module.id} | ${module.kind} | ${module.status} | ${module.files} | ${module.publicEntrypoints.join("<br>") || "not declared"} |`),
    "",
    "## Compatibility debt",
    "",
    "| Category | Current | Baseline | Added | Removed |",
    "|---|---:|---:|---:|---:|",
    ...report.compatibility.map((entry) => `| ${entry.id} | ${entry.currentPaths.length} | ${entry.baselinePaths.length} | ${entry.added.length} | ${entry.removed.length} |`),
    "",
    "## Composition roots",
    "",
    "| File | Lines | Imports | Module dependencies | Baseline increased |",
    "|---|---:|---:|---:|---|",
    ...report.compositionRoots.map((entry) => `| ${entry.file} | ${entry.lines} | ${entry.imports} | ${entry.moduleDependencies} | ${entry.increased ? "yes" : "no"} |`),
    "",
    "## Preload capability surfaces",
    "",
    "| File | Global | Properties | Added | Removed |",
    "|---|---|---:|---:|---:|",
    ...report.capabilitySurfaces.map((entry) => `| ${entry.file} | ${entry.global} | ${entry.propertyCount} | ${entry.added.length} | ${entry.removed.length} |`),
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("No findings.");
  for (const entry of report.findings) {
    lines.push(
      `### ${entry.baseline ? "BASELINE" : "NEW"} ${entry.ruleId}`,
      "",
      `- Source: \`${entry.source}:${entry.line}\``,
      `- Target: ${entry.target ? `\`${entry.target}\`` : "n/a"}`,
      `- Reason: ${entry.reason}`,
      `- Canonical alternative: ${entry.alternative}`,
      `- Suppression: ${entry.suppressed ? `${entry.suppression.issue} (${entry.suppression.owner})` : "none"}`,
      "",
    );
  }
  return lines.join("\n") + "\n";
}
