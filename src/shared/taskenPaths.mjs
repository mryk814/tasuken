import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TASKEN_APP_NAME = "tasken";
export const TASKEN_MCP_PACKAGE_SMOKE_MARKER_FILE = ".tasken-mcp-package-smoke";

function pathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Electronのapp.getPath("userData")を、Electronを起動しないNodeスクリプトから解決する。
 *
 * `APPDATA`はWSLへ引き継がれることがあるが、Linux版ElectronのuserDataではないため、
 * Windows以外では参照しない。テスト・別環境からの明示指定は環境変数で上書きできる。
 */
export function resolveTaskenUserDataPath({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const platformPath = pathForPlatform(platform);
  if (env.TASKEN_USER_DATA_DIR) return platformPath.resolve(env.TASKEN_USER_DATA_DIR);

  if (platform === "win32") {
    return platformPath.join(env.APPDATA || platformPath.join(home, "AppData", "Roaming"), TASKEN_APP_NAME);
  }
  if (platform === "darwin") {
    return platformPath.join(env.HOME || home, "Library", "Application Support", TASKEN_APP_NAME);
  }
  return platformPath.join(env.XDG_CONFIG_HOME || platformPath.join(home, ".config"), TASKEN_APP_NAME);
}

export function resolveTaskenDatabasePath(options = {}) {
  const env = options.env || process.env;
  const platformPath = pathForPlatform(options.platform || process.platform);
  if (env.TASKEN_DB_PATH) return platformPath.resolve(env.TASKEN_DB_PATH);
  return platformPath.join(resolveTaskenUserDataPath(options), "research-desk.sqlite");
}

/**
 * @param {{
 *   userDataPath?: string,
 *   markerToken?: string,
 *   environmentMarker?: string,
 *   tempRoot?: string,
 *   platform?: NodeJS.Platform,
 * }} options
 */
export function validateMcpPackageSmokeRoot({
  userDataPath,
  markerToken,
  environmentMarker,
  tempRoot = os.tmpdir(),
  platform = process.platform,
} = {}) {
  if (!userDataPath || typeof userDataPath !== "string") throw new Error("MCP package smokeには専用userDataが必要です。");
  if (typeof markerToken !== "string" || !/^[0-9a-f]{64}$/.test(markerToken)) throw new Error("MCP package smoke markerが不正です。");
  if (environmentMarker !== markerToken) throw new Error("MCP package smoke markerが一致しません。");
  const platformPath = pathForPlatform(platform);
  const requested = platformPath.resolve(userDataPath);
  const canonicalRoot = fs.realpathSync(userDataPath);
  const canonicalTemp = fs.realpathSync(tempRoot);
  const comparable = (value) => platform === "win32" ? value.toLowerCase() : value;
  if (comparable(requested) !== comparable(canonicalRoot)
    || comparable(platformPath.dirname(canonicalRoot)) !== comparable(canonicalTemp)
    || !platformPath.basename(canonicalRoot).startsWith("tasken-packaged-mcp-")) {
    throw new Error("MCP package smoke userDataは一時領域直下の専用rootである必要があります。");
  }
  const markerPath = platformPath.join(canonicalRoot, TASKEN_MCP_PACKAGE_SMOKE_MARKER_FILE);
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size !== 64) {
    throw new Error("MCP package smoke marker fileが不正です。");
  }
  if (typeof process.getuid === "function" && (markerStat.uid !== process.getuid() || (markerStat.mode & 0o077) !== 0)) {
    throw new Error("MCP package smoke marker fileの権限が安全ではありません。");
  }
  if (fs.readFileSync(markerPath, "utf8") !== markerToken) throw new Error("MCP package smoke marker fileが一致しません。");
  return canonicalRoot;
}
