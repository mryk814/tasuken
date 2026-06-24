# Release

Taskenの配布版はGitHub Releaseで管理する。
タグは`vX.Y.Z`、`package.json`の`version`は`X.Y.Z`で一致させる。

## 通常手順

1. `main`を最新化する。

```powershell
git fetch --prune --tags origin
git switch main
git pull --ff-only origin main
```

2. バージョンを更新する。

```powershell
npm version patch --no-git-tag-version
```

必要に応じて`patch`を`minor`または`major`に変える。

3. 手元で検証する。

```powershell
npm ci
npm run release:check
npm run smoke:desktop
```

4. 変更をcommitしてpushする。

```powershell
git add package.json package-lock.json
git commit -m "chore: release vX.Y.Z"
git push origin main
```

5. annotated tagを作ってpushする。

```powershell
git tag -a vX.Y.Z -m "Tasken vX.Y.Z"
git push origin vX.Y.Z
```

`vX.Y.Z`タグがpushされると、GitHub ActionsがWindows版をpackageし、GitHub Releaseを作成する。

## Release assets

GitHub Releaseには通常、以下が添付される。

- `Tasken-Setup-X.Y.Z-x64.exe`
- `Tasken-Portable-X.Y.Z-x64.exe`

ローカルの生成先は`release/`だが、このディレクトリはGit管理しない。

## 失敗時

- tag名と`package.json`のversionが違う場合はworkflowが止まる。tagを作り直す前に、どちらが正しいversionか確認する。
- packageに失敗した場合は、同じcommitで手元の`npm run release:check`を実行して再現性を確認する。
- すでに公開したtagを動かす必要がある場合は、配布済みの利用者に影響するため、force pushせず別versionを切る。
