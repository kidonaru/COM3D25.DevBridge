import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../scripts/plugin-common.mjs";
import { SERVER_VERSION } from "../src/version.js";

const readJson = (p: string) => JSON.parse(readFileSync(join(repoRoot, p), "utf8"));
const pkg = readJson("package.json");
const claudePlugin = readJson("agent-plugin/.claude-plugin/plugin.json");
const codexPlugin = readJson("agent-plugin/.codex-plugin/plugin.json");
const claudeMarket = readJson(".claude-plugin/marketplace.json");
const codexMarket = readJson(".agents/plugins/marketplace.json");

describe("プラグインマニフェスト", () => {
  it("version は package.json と一致する（ずれると利用者に更新が届かない）", () => {
    expect(claudePlugin.version).toBe(pkg.version);
    expect(codexPlugin.version).toBe(pkg.version);
  });

  it("MCP サーバーが名乗る version は package.json と一致する（ずれるとクライアントに古い版として見える）", () => {
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it("プラグイン名と MCP サーバー名は com3d25-devbridge", () => {
    expect(claudePlugin.name).toBe("com3d25-devbridge");
    expect(codexPlugin.name).toBe("com3d25-devbridge");
    expect(Object.keys(claudePlugin.mcpServers)).toEqual(["com3d25-devbridge"]);
    const codexMcp = readJson(join("agent-plugin", codexPlugin.mcpServers));
    expect(Object.keys(codexMcp.mcpServers)).toEqual(["com3d25-devbridge"]);
  });

  it("両マーケットプレイスが agent-plugin を指す", () => {
    expect(claudeMarket.plugins).toEqual([
      expect.objectContaining({ name: "com3d25-devbridge", source: "./agent-plugin" }),
    ]);
    expect(codexMarket.plugins).toEqual([
      expect.objectContaining({ name: "com3d25-devbridge", source: { source: "local", path: "./agent-plugin" } }),
    ]);
  });

  it("marketplace 側に version を書かない（plugin.json と二重管理になる）", () => {
    expect(claudeMarket.plugins[0].version).toBeUndefined();
  });

  it("起動対象のバンドルが存在する", () => {
    expect(existsSync(join(repoRoot, "agent-plugin/dist/server.mjs"))).toBe(true);
  });
});
