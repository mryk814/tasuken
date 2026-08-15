const CANONICAL_ENTITY_TYPES = ["task", "note", "waiting", "plan_node", "resource", "capture_entry", "sketch"];
const CANONICAL_TYPE_PATTERN = CANONICAL_ENTITY_TYPES.join("|");

function callArguments(source, names) {
  const pattern = new RegExp(`\\b(?:${names.join("|")})\\s*\\(`, "g");
  const argumentsList = [];
  for (const match of source.matchAll(pattern)) {
    let depth = 1;
    let quote = null;
    let escaped = false;
    const start = match.index + match[0].length;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          argumentsList.push(source.slice(start, index));
          break;
        }
      }
    }
  }
  return argumentsList;
}

function isApplicationCommandBoundary(file, source) {
  return file.endsWith("src/main/services/applicationCommandService.ts")
    || file.endsWith("src/main/repositories/workspaceRepository.mjs")
    || (file.endsWith("src/main/ipc/registerIpc.ts") && /rejectTaskPersistence/.test(source))
    || (file.endsWith("src/renderer/src/services/workspaceApi.ts") && /type === [\"']task[\"']/.test(source))
    || (file.endsWith("src/renderer/src/features/workspace/WorkspaceApp.tsx")
      && /if \(type === [\"']task[\"']\)/.test(source)
      && /executeCommand/.test(source));
}

function hasTaskPersistenceBypass(file, source) {
  if (isApplicationCommandBoundary(file, source)) return false;
  const directBatchWrite = callArguments(source, ["saveMany", "saveEntities"])
    .some((argument) => /\btype\s*:\s*["']task["']/.test(argument));
  return new RegExp(`(?:saveEntity|saveWorkspaceEntity|workspaceApi\\.save|entities\\.save)\\s*\\(\\s*[\"']task[\"']`)
    .test(source)
    || new RegExp(`(?:saveMany|saveEntities)\\s*\\(\\s*\\[[\\s\\S]{0,1400}\\btype\\s*:\\s*[\"']task[\"']`)
      .test(source) && directBatchWrite
    || /(?:repository|transaction|workspaceRepository)\.save\s*\(\s*task\b/.test(source)
    || /(?:workspaceApi|entities|repository)\.remove\s*\(\s*[\"']task[\"']/.test(source);
}

function hasCanonicalLegacyThemeWrite(file, source) {
  const directBatchScoped = new RegExp(`\\btype\\s*:\\s*["'](?:${CANONICAL_TYPE_PATTERN})["'][\\s\\S]{0,500}\\bentity\\s*:\\s*\\{[\\s\\S]{0,420}\\btheme_id\\s*:`);
  if (/(?:applicationCommandService|workspaceRepository|legacyAdapter|compat[\\/]|themeRef|entityRegistry|migration|snapshot|mcp[\\/])/.test(file)) return false;
  const directSave = new RegExp(`(?:saveEntity|saveWorkspaceEntity|workspaceApi\\.save|entities\\.save)\\s*\\(\\s*[\"'](?:${CANONICAL_TYPE_PATTERN})[\"']\\s*,[\\s\\S]{0,900}\\btheme_id\\s*:`);
  const directBatch = new RegExp(`(?:saveMany|saveEntities)\\s*\\(\\s*\\[[\\s\\S]{0,1400}\\btype\\s*:\\s*[\"'](?:${CANONICAL_TYPE_PATTERN})[\"'][\\s\\S]{0,500}\\bentity\\s*:\\s*\\{[\\s\\S]{0,420}\\btheme_id\\s*:`);
  return directSave.test(source) || callArguments(source, ["saveMany", "saveEntities"]).some((argument) => directBatchScoped.test(argument));
}

export function scanSource({ file, source, allowlist = {}, strict = false }) {
  const findings = [];
  function add(ruleId, message, match, pending = true) {
    const reason = allowlist[ruleId]?.[file] || null;
    findings.push({
      ruleId,
      severity: strict && pending && !reason ? "error" : "report-only",
      category: strict && pending && !reason ? "error" : "report",
      file,
      match,
      message,
      allowlisted: Boolean(reason),
      reason,
    });
  }

  if (/ipc(?:Renderer|Main)\.(?:invoke|send|handle|on)\(\s*["'\`]/.test(source)
      || /webContents\.(?:send|sendTo|sendToFrame)\(\s*["'\`]/.test(source)
      || /ipcRenderer\[\s*["'](?:invoke|send)["']\s*\]\(\s*["'\`]/.test(source)) {
    add("raw-auxiliary-ipc", "IPC sender/handler uses a channel literal outside the shared IPC contract.", "channel literal");
  }

  if (hasCanonicalLegacyThemeWrite(file, source)) {
    add("legacy-theme-field", "Canonical entity persistence still writes legacy theme_id instead of project_id.", "canonical theme_id write");
  }

  if (/\b(?:collections|workspace|workspaceData)\s*\[\s*(?:type|entityType)\s*\]/.test(source)
      && !/(entityRegistry|workspaceRepository|migration|compat)/.test(file)) {
    add("entity-registry-external-mapping", "Entity type is mapped to a collection outside Entity Registry.", "type-indexed collection");
  }

  const usesSemanticAiIcon = /semanticIcons/.test(source);
  const rawAiIcon = /\b(?:IconSparkles|IconWand|IconRobot)\b/.test(source)
    || (/\bAI_ICON\b/.test(source) && !usesSemanticAiIcon);
  const rawDangerVariant = /(?:btn|button|action)[-_]danger\b|danger-variant/.test(source)
    && !/semantic-button-(?:danger|ai)/.test(source);
  if ((rawAiIcon || rawDangerVariant) && !/semanticActions|semanticIcons|routes|tests[\\/]/.test(file)) {
    add("raw-danger-or-ai-icon", "AI icon or danger styling appears outside the semantic registry; review role and state-color intent.", "AI/danger marker");
  }

  if (/src[\\/]renderer[\\/]|src[\\/]main[\\/]/.test(file) && hasTaskPersistenceBypass(file, source)) {
    add("application-command-write", "Task persistence bypasses the Application Command boundary.", "Task direct persistence");
  }

  return findings;
}

export function scanTokenUsage({ file, source, declaredTokens, strict = false }) {
  const findings = [];
  const localDeclaredTokens = new Set([...source.matchAll(/--([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\s*:/gi)].map((match) => match[1]));
  for (const match of source.matchAll(/var\(--([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\s*[,)]/gi)) {
    if (declaredTokens.has(match[1]) || localDeclaredTokens.has(match[1])) continue;
    findings.push({
      ruleId: "standalone-token",
      severity: strict ? "error" : "report-only",
      category: strict ? "error" : "report",
      file,
      match: "--" + match[1],
      message: "Token --" + match[1] + " is not declared in a CSS token source.",
      allowlisted: false,
      reason: null,
    });
  }
  return findings;
}

/** CSS declarations, inline style object keys, and setProperty assignments form the token contract. */
export function declaredTokensFromSource(source) {
  const tokens = new Set([...source.matchAll(/--([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\s*:/gi)].map((match) => match[1]));
  for (const match of source.matchAll(/["'](--[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)["']\s*:/gi)) tokens.add(match[1].slice(2));
  for (const match of source.matchAll(/setProperty\(\s*["'](--[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)["']/gi)) tokens.add(match[1].slice(2));
  return tokens;
}
