import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(
  fs.readFileSync(
    process.env.TASKEN_ANDROID_PUBLICATION_WORKFLOW ||
      ".github/workflows/android-release-signing.yml",
    "utf8",
  ),
);
const steps = workflow.jobs["build-permanent-release"].steps;
const verify = steps.find((step) => step.name === "Verify direct publication target")?.run;
const publish = steps.find(
  (step) => step.name === "Publish permanent signed APK to existing Release",
)?.run;
const powershell = ["pwsh", ...(process.platform === "win32" ? ["powershell"] : [])].find(
  (command) =>
    spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
    }).status === 0,
);
const windowsLines = [
  `${"a".repeat(64)}  Tasken-Setup-0.1.76-x64.exe`,
  `${"b".repeat(64)}  Tasken-Portable-0.1.76-x64.exe`,
];
const apkName = "Tasken-Android-0.1.76.apk";
const apk = Buffer.from("isolated permanent signed APK fixture");

function run(scenario = "ok") {
  assert.equal(typeof verify, "string", "workflow must verify the direct publication target");
  assert.equal(
    typeof publish,
    "string",
    "workflow must publish the APK directly to the existing Release",
  );
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tasken-android-publication-"));
  try {
    fs.mkdirSync(path.join(directory, "android-app/app/build/outputs/apk/release"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(directory, "runner"));
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version: "0.1.76" }));
    fs.writeFileSync(
      path.join(directory, "android-app/app/build/outputs/apk/release/app-release.apk"),
      apk,
    );
    fs.writeFileSync(
      path.join(directory, "windows-checksums.txt"),
      [...windowsLines, `${"c".repeat(64)}  ${apkName}`].join("\n") + "\n",
    );
    const script = path.join(directory, "publication.ps1");
    fs.writeFileSync(
      script,
      `
$ErrorActionPreference = "Stop"
function git {
  Add-Content -LiteralPath commands.log -Value ("git " + ($args -join " "))
  $global:LASTEXITCODE = 0
  if ($args[0] -eq "rev-parse") {
    if ($env:MOCK_SCENARIO -eq "wrong-head" -and $args[1] -eq "HEAD") { "other-commit" } else { "release-commit" }
  }
  if ($args[0] -eq "merge-base" -and $env:MOCK_SCENARIO -eq "not-main") { $global:LASTEXITCODE = 1 }
}
function gh {
  Add-Content -LiteralPath commands.log -Value ("gh " + ($args -join " "))
  $global:LASTEXITCODE = 0
  if ($args[1] -eq "download") {
    if ($env:MOCK_SCENARIO -eq "download-failed") { $global:LASTEXITCODE = 2; return }
    $destination = $args[[array]::IndexOf($args, "--dir") + 1]
    Copy-Item -LiteralPath windows-checksums.txt -Destination (Join-Path $destination "SHA256SUMS.txt")
  }
  if ($args[1] -eq "upload") {
    if ($env:MOCK_SCENARIO -eq "upload-failed") { $global:LASTEXITCODE = 3; return }
    New-Item -ItemType Directory -Path published -Force | Out-Null
    Copy-Item -LiteralPath $args[3] -Destination published
    Copy-Item -LiteralPath $args[4] -Destination published
  }
}
${verify}
${publish}
`,
      "utf8",
    );
    const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-File", script], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GH_TOKEN: "",
        RELEASE_TAG: scenario === "wrong-tag" ? "v0.1.75" : "v0.1.76",
        GITHUB_REPOSITORY: "fixture/tasken",
        RUNNER_TEMP: path.join(directory, "runner"),
        MOCK_SCENARIO: scenario,
      },
    });
    const checksum = path.join(directory, "published/SHA256SUMS.txt");
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      commands: fs.existsSync(path.join(directory, "commands.log"))
        ? fs.readFileSync(path.join(directory, "commands.log"), "utf8")
        : "",
      checksums: fs.existsSync(checksum) ? fs.readFileSync(checksum, "utf8") : null,
      apk: fs.existsSync(path.join(directory, "published", apkName))
        ? fs.readFileSync(path.join(directory, "published", apkName))
        : null,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "Android direct publication preserves Windows checksums and replaces only its own APK hash",
  { skip: !powershell },
  () => {
    const result = run();
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.apk, apk);
    assert.deepEqual(result.checksums.trim().split(/\r?\n/), [
      ...windowsLines,
      `${createHash("sha256").update(apk).digest("hex")}  ${apkName}`,
    ]);
  },
);

for (const [scenario, error] of [
  ["wrong-tag", /Release tag must match/],
  ["wrong-head", /Release tag must point/],
  ["not-main", /Release commit must be on main/],
]) {
  test(
    `Android publication rejects ${scenario} before any Release access`,
    { skip: !powershell },
    () => {
      const result = run(scenario);
      assert.notEqual(result.status, 0);
      assert.match(result.output, error);
      assert.doesNotMatch(result.commands, /gh release/);
      assert.equal(result.apk, null);
    },
  );
}

test(
  "Android publication stops on failed Windows checksum download without upload",
  { skip: !powershell },
  () => {
    const result = run("download-failed");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Windows Release checksums are required/);
    assert.match(result.commands, /gh release download/);
    assert.doesNotMatch(result.commands, /gh release upload/);
    assert.equal(result.apk, null);
  },
);

test(
  "Android publication reports a nonzero Release upload as failure",
  { skip: !powershell },
  () => {
    const result = run("upload-failed");
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Android Release asset publication failed/);
    assert.match(result.commands, /gh release upload/);
    assert.equal(result.apk, null);
  },
);
