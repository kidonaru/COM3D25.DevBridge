import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "../scripts/bundle.mjs";
import { packageJsonPath } from "../scripts/plugin-common.mjs";

const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

// バンドル単体（node_modules 無し）で MCP の initialize に応答できることを確かめる
describe("bundle", () => {
  it("生成した server.mjs が initialize に応答する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-bundle-"));
    const outfile = join(dir, "dist", "server.mjs");
    await bundle(outfile);

    const child = spawn(process.execPath, [outfile], {
      cwd: dir, // node_modules を解決できない場所で起動する
      env: { ...process.env, COM3D25_DEVBRIDGE_DATA_DIR: dir, BRIDGE_URL: "http://127.0.0.1:1" },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const exited = new Promise((resolve) => child.on("exit", resolve));
    const response = new Promise<string>((resolve, reject) => {
      let buf = "";
      child.stdout.on("data", (d) => {
        buf += d;
        const line = buf.split("\n").find((l) => l.includes('"id":1'));
        if (line) resolve(line);
      });
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`exit ${code}: ${stderr}`)));
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      }) + "\n",
    );
    try {
      const msg = JSON.parse(await response);
      expect(msg.result.serverInfo.name).toBe("com3d25-devbridge");
      expect(msg.result.serverInfo.version).toBe(pkg.version);
    } finally {
      child.kill();
      // Windows では起動中のファイルを消せないため、終了を待ってから一時ディレクトリを片付ける
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("同梱した npm パッケージのライセンス文をバンドルの隣に書き出す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-bundle-"));
    try {
      await bundle(join(dir, "dist", "server.mjs"));
      const notices = readFileSync(join(dir, "dist", "THIRD-PARTY-NOTICES.txt"), "utf8");
      expect(notices).toContain("@modelcontextprotocol/sdk@");
      expect(notices).toContain("zod@");
      // MIT 以外のライセンスも本文ごと入る。fast-uri は ajv 経由の間接依存で、依存更新で消えたら別の非 MIT パッケージに差し替える
      expect(notices).toMatch(/fast-uri@\S+ \(BSD-3-Clause\)/);
      expect(notices).toContain("Redistribution and use in source and binary forms");
      // 開発依存はバンドルに入らないので載せない
      expect(notices).not.toContain("vitest@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
