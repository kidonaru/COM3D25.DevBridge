import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerModFileTools } from "../src/tools/mod-files.js";
import { collectTools } from "./helpers.js";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "devbridge-mod-test-"));
  temporary.push(root);
  const directory = join(root, "Mod", "author", "item");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "item.model"), "検証済みモデル");
  const files = { "item.model": createHash("sha256").update("検証済みモデル").digest("hex") };
  const bridge = {
    pingRaw: vi.fn().mockResolvedValue(JSON.stringify({ mainThreadAlive: true, gameDir: root })),
    evalCs: vi.fn().mockResolvedValue({ ok: true, result: "registered" }),
  };
  const { server, tools } = collectTools();
  registerModFileTools(server, bridge as never);
  return { root, directory, files, bridge, refresh: tools.get("refresh_mod_files")! };
}

describe("導入済みModのファイル検索登録", () => {
  it("全ハッシュ一致後に登録し、コピー・通常ロードは未実施と返す", async () => {
    const s = setup();
    const result = await s.refresh(s);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text!)).toMatchObject({ status: "registered", copied: false, normalLoadCompleted: false, visualVerified: false });
    expect(s.bridge.evalCs).toHaveBeenCalledTimes(1);
    expect(s.bridge.evalCs.mock.calls[0][0]).toContain("AddFolder");
  });

  it("SHA-256不一致ならゲームに触れない", async () => {
    const s = setup();
    writeFileSync(join(s.directory, "item.model"), "古いモデル");
    const result = await s.refresh(s);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("SHA-256");
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it.each(["../item.model", "other/item.model", "C:item.model", "source.blend"])("許可外ファイル %s を拒否する", async (name) => {
    const s = setup();
    expect((await s.refresh({ ...s, files: { [name]: Object.values(s.files)[0] } })).isError).toBe(true);
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("Mod外とModルートそのものを拒否する", async () => {
    const s = setup();
    for (const directory of [s.root, join(s.root, "Mod")]) {
      expect((await s.refresh({ ...s, directory })).isError).toBe(true);
    }
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("Mod外を指すジャンクションを拒否する", async () => {
    const s = setup();
    const outside = join(s.root, "outside");
    mkdirSync(outside);
    const link = join(s.root, "Mod", "link");
    symlinkSync(outside, link, "junction");
    expect((await s.refresh({ ...s, directory: link })).isError).toBe(true);
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("検査中にメインスレッドが停止したら登録しない", async () => {
    const s = setup();
    s.bridge.pingRaw.mockResolvedValueOnce(JSON.stringify({ mainThreadAlive: true, gameDir: s.root })).mockResolvedValue('{"mainThreadAlive":false}');
    expect((await s.refresh(s)).isError).toBe(true);
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it.each([
    ["相対パスの導入先", (s: ReturnType<typeof setup>) => ({ ...s, directory: "Mod/author/item" })],
    ["gameDir を返さない ping", (s: ReturnType<typeof setup>) => {
      s.bridge.pingRaw.mockResolvedValue(JSON.stringify({ mainThreadAlive: true }));
      return s;
    }],
  ])("%s を拒否する", async (_name, mutate) => {
    const s = setup();
    expect((await s.refresh(mutate(s))).isError).toBe(true);
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("Mod配下に同名menuが複数あれば登録しない", async () => {
    const s = setup();
    writeFileSync(join(s.directory, "item.menu"), "メニュー");
    const other = join(s.root, "Mod", "other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "item.menu"), "メニュー");
    const files = { "item.menu": createHash("sha256").update("メニュー").digest("hex") };
    const result = await s.refresh({ ...s, files });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("item.menu");
    expect(s.bridge.evalCs).not.toHaveBeenCalled();
  });

  it("同名menuが1つだけなら登録する", async () => {
    const s = setup();
    writeFileSync(join(s.directory, "item.menu"), "メニュー");
    const files = { "item.menu": createHash("sha256").update("メニュー").digest("hex") };
    expect((await s.refresh({ ...s, files })).isError).toBeUndefined();
    expect(s.bridge.evalCs).toHaveBeenCalledTimes(1);
  });

  it("登録失敗を成功にしない", async () => {
    const s = setup();
    s.bridge.evalCs.mockResolvedValue({ ok: false, result: "", error: "未認識" } as never);
    const result = await s.refresh(s);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("一部実行");
  });
});
