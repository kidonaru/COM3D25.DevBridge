// 導入済みファイルを照合してゲーム内の検索一覧へ登録する。コピーは行わない。
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pingInfo, type BridgeClient } from "../bridge.js";
import { csharpString, expression } from "../csharp.js";
import { textResult, wrap } from "./types.js";

const schema = z.object({
  directory: z.string().min(1).describe("導入済みの正規Modフォルダーの絶対パス。作業・退避フォルダーは禁止"),
  files: z.record(
    z.string().regex(/^[^/\\:\r\n\0]+\.(model|mate|menu|tex)$/i),
    z.string().regex(/^[a-f0-9]{64}$/i),
  ).refine((files) => Object.keys(files).length > 0, "ファイル一覧は空にできません")
    .describe("manifest の files 辞書（短いファイル名→出力SHA-256）"),
});

function isChild(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function validateInstalledFiles(gameDir: string, directory: string, files: Record<string, string>): Promise<string> {
  if (!isAbsolute(directory)) throw new Error("導入先には絶対パスを指定してください");
  const modRoot = await realpath(join(gameDir, "Mod"));
  const resolved = await realpath(directory);
  if (!isChild(modRoot, resolved) || !(await stat(resolved)).isDirectory()) throw new Error("導入先はゲームのMod配下のフォルダーに限ります");
  const names = Object.keys(files);
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error("大文字小文字だけ異なるファイル名が重複しています");
  for (const [name, expected] of Object.entries(files)) {
    const path = await realpath(join(resolved, name));
    if (!isChild(resolved, path) || !(await stat(path)).isFile()) throw new Error(`許可された導入先のファイルではありません: ${name}`);
    const actual = createHash("sha256").update(await readFile(path)).digest("hex");
    if (actual !== expected.toLowerCase()) throw new Error(`導入済みファイルのSHA-256が一致しません: ${name}`);
  }
  return resolved;
}

/**
 * Mod 配下に同名の menu が複数あると AddFolder の登録で検索順が変わるため、
 * 重複があれば登録せずに中止する（ModItemExplorer の RefreshSearchPath と同じ方針）。
 */
export async function assertNoDuplicateMenu(gameDir: string, names: string[]): Promise<void> {
  const menus = names.filter((name) => name.toLowerCase().endsWith(".menu")).map((name) => name.toLowerCase());
  if (!menus.length) return;
  const counts = new Map<string, number>(menus.map((name) => [name, 0]));
  const stack = [await realpath(join(gameDir, "Mod"))];
  while (stack.length) {
    const directory = stack.pop()!;
    // Dirent.parentPath は Node 20.12 以降のため、package.json の engines(>=18) に合わせて自前で組み立てる。
    // ディレクトリのジャンクション／シンボリックリンクは辿らない（Mod 外へ抜けうるため）。
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) { stack.push(join(directory, entry.name)); continue; }
      const found = counts.get(entry.name.toLowerCase());
      if (found !== undefined) counts.set(entry.name.toLowerCase(), found + 1);
    }
  }
  const duplicated = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicated.length) {
    throw new Error(`同名のmenuが複数のMODフォルダーにあります。重複を解消してください: ${duplicated.join(", ")}`);
  }
}

export function refreshModFilesCode(directory: string, names: string[]): string {
  return expression(`
var fs = GameUty.FileSystemMod as FileSystemWindows;
if (fs == null) throw new System.Exception("FileSystemWindows ではないため登録できません");
fs.AddFolder(${csharpString(directory)});
fs.AddAutoPathForAllFolder(false);
fs.existedCache.Clear();
foreach (var name in new string[] { ${names.map(csharpString).join(", ")} }) {
  if (!fs.IsExistentFile(name)) throw new System.Exception("ゲームがファイルを認識していません: " + name);
}
return "registered";
`);
}

export function registerModFileTools(server: McpServer, bridge: BridgeClient): void {
  server.registerTool("refresh_mod_files", {
    description:
      "導入済みmodel/mate/menu/texのSHA-256をmanifestと照合し、ゲームのMod検索一覧を更新する。" +
      "新規材質等の追加後、reload_clothingの前に使う。pingのgameDir配下のModのみ許可。" +
      "既存ファイルの上書き更新はいつでも反映されるが、同じフォルダーへ新しく追加したファイルは" +
      "そのフォルダーの初回登録時しか検索対象へ入らない（ゲーム本体が登録済みフォルダーを再走査しないため）。" +
      "同一セッションで2回目以降に追加したファイルはゲーム再起動が必要で、その場合は認識確認で失敗する。" +
      "Mod配下に同名menuが複数ある場合は検索順を変えないよう中止する。" +
      "ファイルコピー・権限昇格・バックアップ・表示確認は行わない。" +
      "権限外の導入は許可されたシェルで先に行い、このツールで制約を回避しない。",
    inputSchema: schema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, wrap(async (args) => {
    const input = schema.parse(args);
    const ping = await pingInfo(bridge);
    if (ping.mainThreadAlive !== true || typeof ping.gameDir !== "string" || !isAbsolute(ping.gameDir)) throw new Error("ゲームの導入先とメインスレッドの生存を確認できません");
    const directory = await validateInstalledFiles(ping.gameDir, input.directory, input.files);
    await assertNoDuplicateMenu(ping.gameDir, Object.keys(input.files));
    // ハッシュ検査中にゲームが停止していた場合は評価キューへ操作を追加しない。
    const current = await pingInfo(bridge);
    if (current.mainThreadAlive !== true || current.gameDir !== ping.gameDir) throw new Error("検査中にゲームの状態が変わりました");
    const result = await bridge.evalCs(refreshModFilesCode(directory, Object.keys(input.files)));
    if (!result.ok || result.result !== "registered") throw new Error(`ファイル検索一覧の更新を確認できません: ${result.error ?? "応答不正"}。登録は一部実行された可能性があります`);
    return textResult(JSON.stringify({ status: "registered", directory, files: input.files, copied: false, normalLoadCompleted: false, visualVerified: false }, null, 2));
  }));
}
