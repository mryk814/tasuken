const DEFAULT_MAX_DIAGNOSTIC_CHARS = 16 * 1024;

export function sanitizePackageSmokeDiagnostic(value, redactions = []) {
  let sanitized = String(value || "");
  for (const redaction of redactions.filter(Boolean)) {
    sanitized = sanitized.split(String(redaction)).join("<redacted>");
  }
  return sanitized
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer <credential>")
    .replace(/\b[A-Za-z0-9_-]{43}\b/g, "<credential>");
}

export function monitorPackagedProcess(child, options = {}) {
  const maxChars = options.maxDiagnosticChars || DEFAULT_MAX_DIAGNOSTIC_CHARS;
  const redactions = options.redactions || [];
  const boundaryGuard = Math.max(512, ...redactions.map((value) => String(value).length + 16));
  let output = "";
  const append = (source, chunk) => {
    output += `[${source}] ${String(chunk)}`;
    if (output.length > maxChars + boundaryGuard) output = output.slice(-(maxChars + boundaryGuard));
  };
  child.stdout?.on("data", (chunk) => append("stdout", chunk));
  child.stderr?.on("data", (chunk) => append("stderr", chunk));
  const termination = new Promise((resolve) => {
    child.once("error", (error) => resolve({ kind: "spawn_error", error }));
    child.once("exit", (code, signal) => resolve({ kind: "exit", code, signal }));
  });
  return {
    child,
    termination,
    diagnostic: () => sanitizePackageSmokeDiagnostic(output.trim(), redactions).slice(-maxChars),
    sanitize: (value) => sanitizePackageSmokeDiagnostic(value, redactions),
  };
}

export async function waitForPackagedReadiness(options) {
  const {
    monitor,
    probe,
    timeoutMs = 90_000,
    pollMs = 250,
    now = Date.now,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    label = "Packaged Tasken Core",
  } = options;
  const deadline = now() + timeoutMs;
  let lastError;
  while (now() < deadline) {
    if (monitor.child.exitCode !== null || monitor.child.signalCode !== null) {
      throw processTerminationError(label, {
        kind: "exit",
        code: monitor.child.exitCode,
        signal: monitor.child.signalCode,
      }, monitor);
    }
    try {
      return await probe();
    } catch (error) {
      lastError = error;
    }
    const termination = await Promise.race([
      sleep(pollMs).then(() => null),
      monitor.termination,
    ]);
    if (termination) throw processTerminationError(label, termination, monitor);
  }
  const diagnostic = monitor.diagnostic();
  const lastProbe = monitor.sanitize(lastError?.message || "readiness probe failed");
  throw new Error(
    `${label} did not become ready within ${timeoutMs}ms. Last probe: ${lastProbe}`
      + (diagnostic ? `\nPackaged process diagnostic:\n${diagnostic}` : ""),
  );
}

function processTerminationError(label, termination, monitor) {
  const reason = termination.kind === "spawn_error"
    ? `spawn error: ${monitor.sanitize(termination.error?.message || "unknown")}`
    : `exit code ${termination.code ?? "null"}${termination.signal ? `, signal ${termination.signal}` : ""}`;
  const diagnostic = monitor.diagnostic();
  return new Error(
    `${label} terminated before readiness (${reason}).`
      + (diagnostic ? `\nPackaged process diagnostic:\n${diagnostic}` : ""),
  );
}
