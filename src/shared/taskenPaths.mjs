import os from "node:os";
import path from "node:path";

export const TASKEN_APP_NAME = "tasken";

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
