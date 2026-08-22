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

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
delete packageJson.scripts.pretypecheck;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

fs.rmSync(fileURLToPath(import.meta.url));
