import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerGameTools } from "../src/tools/game.js";
import type { GameDirResolver } from "../src/game-dir.js";
import { collectTools } from "./helpers.js";

/** 固定パスを返すリゾルバのスタブ。 */
const resolverOf = (dir: string) => ({ resolve: vi.fn().mockResolvedValue(dir) }) as unknown as GameDirResolver;
const RESOLVER = resolverOf("W:\\COM3D2_5");

describe("game tools", () => {
  it("list_maids は行指向テキストを構造化して返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockResolvedValue({ ok: true, result: "0|前野 うい|visible|idle\n1|双葉 舞|hidden|busy\n" }) };
    registerGameTools(server, bridge as never, RESOLVER);
    const res = await tools.get("list_maids")!({});
    const parsed = JSON.parse(res.content[0].text!);
    expect(parsed.maids).toHaveLength(2);
    expect(parsed.maids[0]).toEqual({ index: 0, name: "前野 うい", visible: true, busy: false });
    expect(parsed.maids[1]).toEqual({ index: 1, name: "双葉 舞", visible: false, busy: true });
  });

  it("list_maids は eval エラーを isError で返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockResolvedValue({ ok: false, error: "CS0103: ..." }) };
    registerGameTools(server, bridge as never, RESOLVER);
    const res = await tools.get("list_maids")!({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("CS0103");
  });

  it("scene_info は eval の戻り値をそのまま返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockResolvedValue({ ok: true, result: "scene|SceneTitle\nrootCount|3\n" }) };
    registerGameTools(server, bridge as never, RESOLVER);
    const res = await tools.get("scene_info")!({});
    expect(res.content[0].text).toContain("scene|SceneTitle");
  });

  it("screenshot は PNG を画像コンテンツとして返す", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { server, tools } = collectTools();
    const bridge = { captureRaw: vi.fn().mockResolvedValue(png) };
    registerGameTools(server, bridge as never, RESOLVER);
    const res = await tools.get("screenshot")!({ maxSize: 1280 });
    expect(bridge.captureRaw).toHaveBeenCalledWith("screen", 1280, undefined);
    expect(res.content[0]).toEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  });

  it("screenshot は window 指定を imgui: target に、rect をそのまま渡す", async () => {
    const png = Buffer.from([0x89]);
    const { server, tools } = collectTools();
    const bridge = { captureRaw: vi.fn().mockResolvedValue(png) };
    registerGameTools(server, bridge as never, RESOLVER);
    await tools.get("screenshot")!({ maxSize: 800, window: "Mod Item Explorer" });
    expect(bridge.captureRaw).toHaveBeenCalledWith("imgui:Mod Item Explorer", 800, undefined);
    await tools.get("screenshot")!({ maxSize: 800, rect: "0,0,100,50" });
    expect(bridge.captureRaw).toHaveBeenCalledWith("screen", 800, "0,0,100,50");
  });

  it("list_imgui_windows は一覧を JSON で返し、失敗は isError にする", async () => {
    const { server, tools } = collectTools();
    const win = { id: 1, title: "タイムライン操作", x: 2, y: 775, w: 806, h: 154 };
    const bridge = { listImGuiWindows: vi.fn().mockResolvedValue({ ok: true, result: [win] }) };
    registerGameTools(server, bridge as never, RESOLVER);
    const res = await tools.get("list_imgui_windows")!({});
    expect(JSON.parse(res.content[0].text!)).toEqual({ windows: [win] });

    bridge.listImGuiWindows.mockResolvedValue({ ok: false, error: "timeout" });
    const err = await tools.get("list_imgui_windows")!({});
    expect(err.isError).toBe(true);
    expect(err.content[0].text).toContain("timeout");
  });

  it("screenshot は window と rect の併用をエラーにする", async () => {
    const { server, tools } = collectTools();
    const bridge = { captureRaw: vi.fn() };
    registerGameTools(server, bridge as never, RESOLVER);
    const res = await tools.get("screenshot")!({ maxSize: 800, window: "x", rect: "0,0,1,1" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/同時に指定できません/);
    expect(bridge.captureRaw).not.toHaveBeenCalled();
  });

  it("tail_log はログ末尾 N 行を返す（ゲーム非依存）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    const bepinex = join(dir, "BepInEx");
    mkdirSync(bepinex, { recursive: true });
    writeFileSync(join(bepinex, "LogOutput.log"), ["l1", "l2", "l3", "l4"].join("\n"));
    const { server, tools } = collectTools();
    registerGameTools(server, {} as never, resolverOf(dir));
    const res = await tools.get("tail_log")!({ lines: 2 });
    expect(res.content[0].text).toBe("l3\nl4");
  });

  it("tail_log はログが無ければ isError で案内する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-test-"));
    const { server, tools } = collectTools();
    registerGameTools(server, {} as never, resolverOf(dir));
    const res = await tools.get("tail_log")!({ lines: 2 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("LogOutput.log");
  });
});
