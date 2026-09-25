import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameDirResolver } from "../src/game-dir.js";

const cacheFile = () => join(mkdtempSync(join(tmpdir(), "mcp-gamedir-")), ".game-dir");

describe("GameDirResolver", () => {
  it("GAME_DIR 上書きが最優先（ブリッジに問い合わせない）", async () => {
    const source = { pingGameDir: vi.fn() };
    const r = new GameDirResolver(source, cacheFile(), "X:\\Override");
    expect(await r.resolve()).toBe("X:\\Override");
    expect(source.pingGameDir).not.toHaveBeenCalled();
  });

  it("ブリッジの gameDir を返し、キャッシュへ保存する", async () => {
    const file = cacheFile();
    const source = { pingGameDir: vi.fn().mockResolvedValue("W:\\Game") };
    const r = new GameDirResolver(source, file);
    expect(await r.resolve()).toBe("W:\\Game");
    expect(readFileSync(file, "utf8")).toBe("W:\\Game");
  });

  it("ブリッジ接続不可ならキャッシュへフォールバックする（クラッシュ検死）", async () => {
    const file = cacheFile();
    writeFileSync(file, "W:\\Cached");
    const source = { pingGameDir: vi.fn().mockRejectedValue(new Error("unreachable")) };
    const r = new GameDirResolver(source, file);
    expect(await r.resolve()).toBe("W:\\Cached");
  });

  it("ブリッジ不可かつキャッシュ無しならエラーで案内する", async () => {
    const source = { pingGameDir: vi.fn().mockRejectedValue(new Error("unreachable")) };
    const r = new GameDirResolver(source, cacheFile());
    await expect(r.resolve()).rejects.toThrow("GAME_DIR");
  });

  it("旧ブリッジ（gameDir 無し）でもキャッシュがあれば動く", async () => {
    const file = cacheFile();
    writeFileSync(file, "W:\\Cached");
    const source = { pingGameDir: vi.fn().mockResolvedValue(undefined) };
    const r = new GameDirResolver(source, file);
    expect(await r.resolve()).toBe("W:\\Cached");
  });
});
