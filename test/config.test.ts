import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.js";

// dist/config.js 相当の位置を与え、その 1 つ上が既定のデータ置き場になることを確かめる
const root = join("W:", "pkg");
const moduleUrl = pathToFileURL(join(root, "dist", "config.js")).href;

describe("loadConfig", () => {
  it("COM3D25_DEVBRIDGE_DATA_DIR が無ければモジュールの 1 つ上に保存する", () => {
    const c = loadConfig({}, moduleUrl);
    expect(c.screenshotDir).toBe(join(root, "screenshots"));
    expect(c.gameDirCacheFile).toBe(join(root, ".game-dir"));
  });

  it("COM3D25_DEVBRIDGE_DATA_DIR があればそこへ保存する（プラグイン更新で消えない場所）", () => {
    const data = join("X:", "data");
    const c = loadConfig({ COM3D25_DEVBRIDGE_DATA_DIR: data }, moduleUrl);
    expect(c.screenshotDir).toBe(join(data, "screenshots"));
    expect(c.gameDirCacheFile).toBe(join(data, ".game-dir"));
  });

  it("空文字の COM3D25_DEVBRIDGE_DATA_DIR は未指定扱い（未展開の変数対策）", () => {
    expect(loadConfig({ COM3D25_DEVBRIDGE_DATA_DIR: "" }, moduleUrl).screenshotDir).toBe(join(root, "screenshots"));
  });

  it("未展開の変数や相対パスは未指定扱い（利用者のプロジェクト直下に書き込まない）", () => {
    expect(loadConfig({ COM3D25_DEVBRIDGE_DATA_DIR: "${CLAUDE_PLUGIN_DATA}" }, moduleUrl).screenshotDir).toBe(
      join(root, "screenshots"),
    );
    expect(loadConfig({ COM3D25_DEVBRIDGE_DATA_DIR: "data" }, moduleUrl).screenshotDir).toBe(join(root, "screenshots"));
  });

  it("BRIDGE_URL / GAME_DIR は従来どおり env から読む", () => {
    const c = loadConfig({ BRIDGE_URL: "http://127.0.0.1:1", GAME_DIR: "Y:\\Game" }, moduleUrl);
    expect(c.bridgeUrl).toBe("http://127.0.0.1:1");
    expect(c.gameDirOverride).toBe("Y:\\Game");
    expect(loadConfig({}, moduleUrl).bridgeUrl).toBe("http://127.0.0.1:18650");
  });
});
