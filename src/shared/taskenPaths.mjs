import os from "node:os";
import path from "node:path";

export const TASKEN_APP_NAME = "tasken";

/**
 * Electronのapp.getPath("userData")を、Electronを起動しないNodeスクリプトから解決する。
 *
 * `APPDATA`はWSLへ引き継がれることがあるが、Linux版ElectronのuserDataではないため、
 * Windows以外では参照しない。テスト・別環境からの明示指定は環境変数で上書きできる。
 */
export function resolveTaskenUserDataPath({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.TASKEN_USER_DATA_DIR) return path.resolve(env.TASKEN_USER_DATA_DIR);

  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), TASKEN_APP_NAME);
  }
  if (platform === "darwin") {
    return path.join(env.HOME || home, "Library", "Application Support", TASKEN_APP_NAME);
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), TASKEN_APP_NAME);
}

export function resolveTaskenDatabasePath(options = {}) {
  const env = options.env || process.env;
  if (env.TASKEN_DB_PATH) return path.resolve(env.TASKEN_DB_PATH);
  return path.join(resolveTaskenUserDataPath(options), "research-desk.sqlite");
}
