if (process.platform !== "win32") {
  console.error([
    "Windows配布物はWindows runner上で作成してください。",
    "WSLでの開発検証は npm run ci を使い、Windows向けのpackageは vX.Y.Z タグをpushしてGitHub Actionsで実行します。",
    `現在の実行環境: ${process.platform}`,
  ].join("\n"));
  process.exit(1);
}

if (process.arch !== "x64") {
  console.error(`Windows x64向けの配布設定ですが、現在のCPUアーキテクチャは ${process.arch} です。`);
  process.exit(1);
}

console.log("Windows x64 release host: OK");
