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

  if (/\btheme_id\b/.test(source) && !/(compat|migration|entityRegistry|themeRef|workspaceRepository|tests[\\/])/.test(file)) {
    add("legacy-theme-field", "Legacy theme_id appears outside an explicit migration/registry boundary.", "theme_id");
  }

  if (/\b(?:collections|workspace|workspaceData)\s*\[\s*(?:type|entityType)\s*\]/.test(source)
      && !/(entityRegistry|workspaceRepository|migration|compat)/.test(file)) {
    add("entity-registry-external-mapping", "Entity type is mapped to a collection outside Entity Registry.", "type-indexed collection");
  }

  if (/\b(?:IconSparkles|IconWand|IconRobot)\b|\bAI_ICON\b|(?:btn|button|action)[-_]danger\b|danger-variant/.test(source)
      && !/(semanticActions|semanticIcons|routes|tests[\\/])/.test(file)) {
    add("raw-danger-or-ai-icon", "AI icon or danger styling appears outside the semantic registry; review role and state-color intent.", "AI/danger marker");
  }

  if (/src[\\/]renderer[\\/]|src[\\/]main[\\/]/.test(file)
      && /\b(?:saveEntity|deleteEntity|saveMany|\.save|\.delete)\s*\(/.test(source)
      && !/(repositories[\\/]|migration|compat|fixtures?)/.test(file)) {
    add("application-command-write", "Task/entity write-looking call is not yet proven to cross the Application Command boundary (#336 pending).", "write-looking call");
  }

  return findings;
}

export function scanTokenUsage({ file, source, declaredTokens, strict = false }) {
  const findings = [];
  for (const match of source.matchAll(/var\(--([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\s*[,)]/gi)) {
    if (declaredTokens.has(match[1])) continue;
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
