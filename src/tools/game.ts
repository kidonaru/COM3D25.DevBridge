// COM3D2.5 固有の高水準ツール。ロジックは eval テンプレート（snippets.ts）に置き、
// ゲーム再起動なしで改修できるようにする。
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeClient, EvalResponse } from "../bridge.js";
import type { GameDirResolver } from "../game-dir.js";
import { errorResult, textResult, wrap, type ToolResult } from "./types.js";
import { LIST_MAIDS_CS, SCENE_INFO_CS } from "../snippets.js";

/** eval 結果の共通ガード: 失敗はエラーメッセージをそのままツール結果に載せる。 */
function evalValueOrError(res: EvalResponse): { value: string } | { error: ToolResult } {
  if (!res.ok) return { error: errorResult(`eval 失敗: ${res.error ?? "unknown"}`) };
  return { value: String(res.result ?? "") };
}

export function registerGameTools(server: McpServer, bridge: BridgeClient, gameDirResolver: GameDirResolver): void {
  server.registerTool(
    "screenshot",
    {
      description:
        "ゲーム画面のスクリーンショットを撮り、画像で返す。画面を見たいときの既定手段（capture target=screen の別名だが、こちらはファイル保存せず画像だけ返す）。",
      inputSchema: {
        maxSize: z.number().int().min(16).max(4096).default(1280).describe("出力画像の長辺ピクセル数"),
        window: z
          .string()
          .optional()
          .describe("IMGUI ウィンドウのタイトル（完全一致→部分一致、#<id> も可）。指定するとそのウィンドウだけを切り抜く。rect とは併用不可"),
        rect: z
          .string()
          .regex(/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/)
          .optional()
          .describe("切り抜き矩形 \"x,y,w,h\"（左上原点・px）"),
      },
    },
    wrap(async (args) => {
      const window = args.window as string | undefined;
      if (window && args.rect) throw new Error("window と rect は同時に指定できません");
      const target = window ? `imgui:${window}` : "screen";
      const buf = await bridge.captureRaw(target, (args.maxSize as number) ?? 1280, args.rect as string | undefined);
      return { content: [{ type: "image", data: buf.toString("base64"), mimeType: "image/png" }] };
    }),
  );

  server.registerTool(
    "list_imgui_windows",
    {
      description:
        "表示中の IMGUI（OnGUI）ウィンドウ一覧を JSON で返す（id・title・x/y/w/h、左上原点 px）。" +
        "screenshot の window= や capture の imgui:/rect= に渡す値を決めるのに使う。title が空のウィンドウは #<id> で指定する。",
    },
    wrap(async () => {
      const res = await bridge.listImGuiWindows();
      if (!res.ok) return errorResult(res.error ?? "unknown error");
      return textResult(JSON.stringify({ windows: res.result ?? [] }, null, 2));
    }),
  );

  server.registerTool(
    "list_maids",
    {
      description:
        "ストック中のメイド一覧を JSON で返す（index・名前・visible・busy）。" +
        "index は他のメイド操作で対象を指すのに使う。ここに無い情報が要るときは eval_csharp で掘る。",
    },
    wrap(async () => {
      const g = evalValueOrError(await bridge.evalCs(LIST_MAIDS_CS));
      if ("error" in g) return g.error;
      const maids = g.value
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          const [index, name, vis, busy] = l.split("|");
          return { index: Number(index), name, visible: vis === "visible", busy: busy === "busy" };
        });
      return textResult(JSON.stringify({ maids }, null, 2));
    }),
  );

  server.registerTool(
    "scene_info",
    {
      description:
        "現在のシーン名とルート GameObject の要約を返す。ゲームが今どの画面にいるかを掴む起点で、" +
        "個別の GameObject を深掘りするにはここで得た名前を eval_csharp に渡す。",
    },
    wrap(async () => {
      const g = evalValueOrError(await bridge.evalCs(SCENE_INFO_CS));
      return "error" in g ? g.error : textResult(g.value);
    }),
  );

  server.registerTool(
    "tail_log",
    {
      description:
        "BepInEx/LogOutput.log の末尾 N 行を返す。パスはブリッジの /ping から自動解決してキャッシュするため、" +
        "一度でも接続していればゲームが落ちている最中でも読める。ゲーム未起動時に唯一使えるツールで、クラッシュ調査の起点になる。",
      inputSchema: { lines: z.number().int().min(1).max(2000).default(100).describe("取得する行数") },
    },
    wrap(async (args) => {
      const n = (args.lines as number) ?? 100;
      let gameDir: string;
      try {
        gameDir = await gameDirResolver.resolve();
      } catch (e) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
      const path = join(gameDir, "BepInEx", "LogOutput.log");
      let all: string[];
      try {
        all = readFileSync(path, "utf8").split(/\r?\n/);
      } catch (e) {
        return errorResult(`LogOutput.log を読めません: ${path}（${e instanceof Error ? e.message : String(e)}）`);
      }
      while (all.length > 0 && all[all.length - 1] === "") all.pop();
      return textResult(all.slice(-n).join("\n"));
    }),
  );
}
