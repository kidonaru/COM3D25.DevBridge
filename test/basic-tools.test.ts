import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerBasicTools } from "../src/tools/basic.js";
import { BridgeUnreachableError } from "../src/bridge.js";
import { collectTools } from "./helpers.js";

describe("basic tools", () => {
  it("eval_csharp はブリッジの結果 JSON をテキストで返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockResolvedValue({ ok: true, result: "2" }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    const res = await tools.get("eval_csharp")!({ code: "1+1" });
    expect(bridge.evalCs).toHaveBeenCalledWith("1+1");
    expect(res.content[0].text).toContain('"result": "2"');
  });

  // ブリッジは失敗時も HTTP 200 で ok:false を返すため、isError への伝搬が必要
  it("eval_csharp は ok:false（コンパイルエラー等）を isError で返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockResolvedValue({ ok: false, error: "compile error" }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    const res = await tools.get("eval_csharp")!({ code: "int x =" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("compile error");
  });

  it("watch_read は watch 未検出（ok:false）を isError で返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { watchRead: vi.fn().mockResolvedValue({ ok: false, error: "watch が見つかりません: 9" }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    const res = await tools.get("watch_read")!({ id: 9 });
    expect(res.isError).toBe(true);
  });

  it("成功応答（ok:true）は isError を立てない", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockResolvedValue({ ok: true, result: "2" }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    const res = await tools.get("eval_csharp")!({ code: "1+1" });
    expect(res.isError).toBe(false);
  });

  it("ブリッジ接続不可は isError 付きの案内メッセージになる", async () => {
    const { server, tools } = collectTools();
    const bridge = { evalCs: vi.fn().mockRejectedValue(new BridgeUnreachableError("http://x")) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    const res = await tools.get("eval_csharp")!({ code: "1+1" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/ゲーム未起動かプラグイン未ロード/);
  });

  it("capture は PNG をファイルに保存し、保存先テキストと画像を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-capture-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { server, tools } = collectTools();
    const bridge = { captureRaw: vi.fn().mockResolvedValue(png) };
    registerBasicTools(server, bridge as never, { screenshotDir: dir });
    const res = await tools.get("capture")!({ target: "screen", maxSize: 1280 });

    expect(bridge.captureRaw).toHaveBeenCalledWith("screen", 1280, undefined);
    const saved = /保存先: (.+?)（/.exec(res.content[0].text!)![1];
    expect(readFileSync(saved)).toEqual(png);
    expect(res.content[1]).toEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  });

  it("capture を連続実行しても保存先が衝突しない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-capture-dup-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { server, tools } = collectTools();
    const bridge = { captureRaw: vi.fn().mockResolvedValue(png) };
    registerBasicTools(server, bridge as never, { screenshotDir: dir });
    const paths = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await tools.get("capture")!({ target: "screen" });
      paths.add(/保存先: (.+?)（/.exec(res.content[0].text!)![1]);
    }
    expect(paths.size).toBe(5);
  });

  it("watch_add は frames/mode をブリッジへ渡す", async () => {
    const { server, tools } = collectTools();
    const bridge = { watchAdd: vi.fn().mockResolvedValue({ ok: true, result: { id: 1 } }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    await tools.get("watch_add")!({ expr: "Time.frameCount", frames: 120, mode: "diff" });
    expect(bridge.watchAdd).toHaveBeenCalledWith("Time.frameCount", { frames: 120, mode: "diff" });
  });

  it("watch_read / watch_remove は id をブリッジへ渡す", async () => {
    const { server, tools } = collectTools();
    const bridge = {
      watchRead: vi.fn().mockResolvedValue({ ok: true }),
      watchRemove: vi.fn().mockResolvedValue({ ok: true }),
    };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    await tools.get("watch_read")!({ id: 3 });
    await tools.get("watch_remove")!({ id: 3 });
    expect(bridge.watchRead).toHaveBeenCalledWith(3);
    expect(bridge.watchRemove).toHaveBeenCalledWith(3);
  });

  it("profile_add は target/frames をブリッジへ渡す", async () => {
    const { server, tools } = collectTools();
    const bridge = { profileAdd: vi.fn().mockResolvedValue({ ok: true, result: { id: 1 } }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    await tools.get("profile_add")!({ target: "Ns.Type:Method", frames: 300 });
    expect(bridge.profileAdd).toHaveBeenCalledWith("Ns.Type:Method", 300);
  });

  it("profile_read / profile_remove は id をブリッジへ渡す", async () => {
    const { server, tools } = collectTools();
    const bridge = {
      profileRead: vi.fn().mockResolvedValue({ ok: true }),
      profileRemove: vi.fn().mockResolvedValue({ ok: true }),
    };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    await tools.get("profile_read")!({ id: 3 });
    await tools.get("profile_remove")!({ id: 3 });
    expect(bridge.profileRead).toHaveBeenCalledWith(3);
    expect(bridge.profileRemove).toHaveBeenCalledWith(3);
  });

  it("profile_read は profile 未検出（ok:false）を isError で返す", async () => {
    const { server, tools } = collectTools();
    const bridge = { profileRead: vi.fn().mockResolvedValue({ ok: false, error: "profile が見つかりません: 9" }) };
    registerBasicTools(server, bridge as never, { screenshotDir: "/tmp" });
    const res = await tools.get("profile_read")!({ id: 9 });
    expect(res.isError).toBe(true);
  });
});
