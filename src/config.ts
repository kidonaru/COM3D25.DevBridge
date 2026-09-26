// MCP サーバーの設定。環境変数とモジュールの配置場所から組み立てる。
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";

export type Config = { bridgeUrl: string; gameDirOverride?: string; gameDirCacheFile: string; screenshotDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, moduleUrl: string = import.meta.url): Config {
  // プラグイン配布時は更新で消えない永続ディレクトリ（${CLAUDE_PLUGIN_DATA}）が渡される。
  // 無ければ dist/ から見たパッケージルート直下に置く（npx・ローカル開発・Codex）
  // 未展開の変数（"${CLAUDE_PLUGIN_DATA}"）や相対パスは cwd＝利用者のプロジェクトに書き込んでしまうため採用しない
  const requested = env.COM3D25_DEVBRIDGE_DATA_DIR;
  const usable = requested && isAbsolute(requested) && !requested.includes("${");
  const dataDir = usable ? requested : fileURLToPath(new URL("..", moduleUrl));
  return {
    // 空文字・空白は未設定と同じ扱いにする（設定 UI などから空で渡ってきても既定に落とす）
    bridgeUrl: env.BRIDGE_URL?.trim() || "http://127.0.0.1:24574",
    gameDirOverride: env.GAME_DIR, // 通常は不要（ブリッジの /ping から自動解決する）
    gameDirCacheFile: join(dataDir, ".game-dir"),
    screenshotDir: join(dataDir, "screenshots"),
  };
}
