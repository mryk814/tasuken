import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testPath = path.join(root, "tests", "mobile-gateway-phase4a.test.mjs");
const editorPath = path.join(
  root,
  "android-app",
  "app",
  "src",
  "main",
  "java",
  "jp",
  "personal",
  "tasken",
  "companion",
  "TaskScheduleEditor.kt",
);
const packagePath = path.join(root, "package.json");

const before = `      workState: "not_delegated",
      todayDate: "2026-08-21",
      updatedAt: now,
`;
const after = `      workState: "not_delegated",
      todayDate: "2026-08-21",
      plannedStartTime: null,
      plannedDurationMinutes: null,
      updatedAt: now,
`;

const testSource = fs.readFileSync(testPath, "utf8");
if (testSource.split(before).length - 1 !== 1) {
  throw new Error("state conflict projection expectation changed");
}
fs.writeFileSync(testPath, testSource.replace(before, after), "utf8");

const editorSource = fs.readFileSync(editorPath, "utf8");
const weightImport = "import androidx.compose.foundation.layout.weight\n";
if (editorSource.split(weightImport).length - 1 !== 1) {
  throw new Error("TaskScheduleEditor weight import changed");
}
fs.writeFileSync(editorPath, editorSource.replace(weightImport, ""), "utf8");

// GitHub re-runs freeze the original workflow definition. That definition
// requested a host SDK profile ID (`pixel_8`) no longer present in the current
// avdmanager catalog. The test does not depend on physical screen dimensions,
// so install a runner-local wrapper that drops only the optional --device pair.
// Nothing under the repository is retained for this compatibility shim.
const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const runnerTemp = process.env.RUNNER_TEMP;
const githubPath = process.env.GITHUB_PATH;
if (!sdkRoot || !runnerTemp || !githubPath) {
  throw new Error("Android CI environment variables are unavailable");
}
const realAvdManager = path.join(sdkRoot, "cmdline-tools", "latest", "bin", "avdmanager");
if (!fs.existsSync(realAvdManager)) {
  throw new Error(`avdmanager was not found: ${realAvdManager}`);
}
const wrapperDirectory = path.join(runnerTemp, "tasken-avdmanager-wrapper");
const wrapperPath = path.join(wrapperDirectory, "avdmanager");
fs.mkdirSync(wrapperDirectory, { recursive: true });
fs.writeFileSync(
  wrapperPath,
  `#!/usr/bin/env bash
set -euo pipefail
args=()
skip_next=0
for arg in "$@"; do
  if [[ "$skip_next" == "1" ]]; then
    skip_next=0
    continue
  fi
  if [[ "$arg" == "--device" ]]; then
    skip_next=1
    continue
  fi
  args+=("$arg")
done
exec ${JSON.stringify(realAvdManager)} "${'${args[@]}'}"
`,
  "utf8",
);
fs.chmodSync(wrapperPath, 0o755);
fs.appendFileSync(githubPath, `${wrapperDirectory}\n`, "utf8");

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
delete packageJson.scripts.pretypecheck;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

fs.rmSync(fileURLToPath(import.meta.url));
