// 薄ラップツール群: ブリッジ HTTP API をほぼ 1:1 で MCP ツール化する。
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BridgeClient } from "../bridge.js";
import { bridgeResult, textResult, wrap } from "./types.js";

export function registerBasicTools(server: McpServer, bridge: BridgeClient, config: { screenshotDir: string }): void {
  server.registerTool(
    "ping",
    {
      description:
        "ブリッジの死活確認。version・mainThreadAlive・stalledSecs・gameDir を返す。" +
        "mainThreadAlive=false はメインスレッド停止で、この状態では eval_csharp も reset_evaluator も同じキューで詰まる（復旧はゲーム再起動）。",
    },
    wrap(async () => textResult(await bridge.pingRaw())),
  );

  server.registerTool(
    "eval_csharp",
    {
      description:
        "稼働中の COM3D2.5 内で C# コードを評価する（メインスレッド実行）。式なら値を返し、複数文・変数宣言も書ける。" +
        "REPL 状態（変数・using）は呼び出しをまたいで保持されるので、探索は小さく刻んで積み上げられる。" +
        "compile error が続くなら評価器の状態破損を疑い reset_evaluator を使う。",
      inputSchema: { code: z.string().describe("評価する C# コード") },
    },
    wrap(async (args) => bridgeResult(await bridge.evalCs(args.code as string))),
  );

  server.registerTool(
    "reset_evaluator",
    { description: "評価器を作り直す（REPL の変数/using は失われる）。評価器破損時の復旧用。" },
    wrap(async () => bridgeResult(await bridge.reset())),
  );

  server.registerTool(
    "capture",
    {
      description:
        "画面や RenderTexture を PNG でキャプチャし、ファイル保存したうえで画像としても返す。" +
        "ゲーム画面を撮るだけなら screenshot の方が簡単（capture は rt:/camera: 指定が要るときに使う）。",
      inputSchema: {
        target: z
          .string()
          .default("screen")
          .describe(
            "screen（ゲーム画面）/ rt:<name>（RenderTexture 名）/ rt:<W>x<H>（サイズ指定。VR の eye RT のように同名が並んで名前で絞れないとき）/ camera:<name>（Camera 名）" +
              "/ imgui:<title>（IMGUI ウィンドウのタイトル。完全一致→部分一致。#<id> で id 指定も可。見つからないと表示中の一覧をエラーで返す）",
          ),
        maxSize: z.number().int().min(16).max(4096).optional().describe("出力画像の長辺ピクセル数。省略すると原寸"),
        rect: z
          .string()
          .regex(/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/)
          .optional()
          .describe("切り抜き矩形 \"x,y,w,h\"（左上原点・px）。imgui: とは併用不可"),
      },
    },
    wrap(async (args) => {
      const buf = await bridge.captureRaw(
        (args.target as string) ?? "screen",
        args.maxSize as number | undefined,
        args.rect as string | undefined,
      );
      mkdirSync(config.screenshotDir, { recursive: true });
      // ミリ秒だけでは連続キャプチャで衝突し、既存ファイルを無警告で上書きしてしまう
      const file = join(config.screenshotDir, `capture-${Date.now()}-${randomBytes(3).toString("hex")}.png`);
      writeFileSync(file, buf);
      return {
        content: [
          { type: "text", text: `保存先: ${file}（${buf.length} bytes）` },
          { type: "image", data: buf.toString("base64"), mimeType: "image/png" },
        ],
      };
    }),
  );

  server.registerTool(
    "watch_add",
    {
      description:
        "毎フレーム評価する watch 式を登録し、watch id を返す。結果は watch_read で読み出す。" +
        "フレーム間で変化する値を追うためのもので、1 回だけ調べたいなら eval_csharp で足りる。" +
        "式は単一式のみ（複数文・変数宣言は不可。それらは eval_csharp を使う）。",
      inputSchema: {
        expr: z.string().describe("毎フレーム評価する C# 式"),
        frames: z.number().int().min(1).optional().describe("監視するフレーム数（既定 600）"),
        mode: z.enum(["log", "diff"]).optional().describe("log=毎フレーム記録 / diff=値が変化したときだけ記録"),
      },
    },
    wrap(async (args) =>
      bridgeResult(
        await bridge.watchAdd(args.expr as string, {
          frames: args.frames as number | undefined,
          mode: args.mode as "log" | "diff" | undefined,
        }),
      ),
    ),
  );

  server.registerTool(
    "watch_read",
    {
      description:
        "watch の収集結果を読み出す。指定フレーム数の収集が終わっていればブリッジ側で自動解除されるので watch_remove は不要。" +
        "収集途中でも呼べて、その時点までの結果が返る。",
      inputSchema: { id: z.number().int().describe("watch_add が返した id") },
    },
    wrap(async (args) => bridgeResult(await bridge.watchRead(args.id as number))),
  );

  server.registerTool(
    "watch_remove",
    {
      description:
        "watch を解除する。完了まで待たずに止めたいときだけ使う（完了済みの watch は watch_read が自動解除する）。",
      inputSchema: { id: z.number().int().describe("watch_add が返した id") },
    },
    wrap(async (args) => bridgeResult(await bridge.watchRemove(args.id as number))),
  );

  server.registerTool(
    "profile_add",
    {
      description:
        "指定メソッドを Harmony パッチで計測開始し、profile id を返す。結果は profile_read で読み出す。" +
        "呼び出し回数/フレーム・ms（合計/平均/最大）・GC アロケーション増分・Event.current.type 別内訳が取れる。" +
        '対象は "Full.Type.Name:MethodName" 形式（ネスト型は + 区切り）。同名オーバーロードは全件まとめて計測される。' +
        "注意: 超高頻度メソッド（数千回/フレーム）はパッチ自体のオーバーヘッドで値が汚れるため、粗い粒度のメソッドで測ること。",
      inputSchema: {
        target: z
          .string()
          .describe('計測対象 "Full.Type.Name:MethodName"（例: "COM3D2.SceneEditor.Plugin.HierarchyWindow:DrawContent"）'),
        frames: z.number().int().min(1).optional().describe("計測するフレーム数（既定 600）"),
      },
    },
    wrap(async (args) => bridgeResult(await bridge.profileAdd(args.target as string, args.frames as number | undefined))),
  );

  server.registerTool(
    "profile_read",
    {
      description:
        "プロファイルの集計結果を読み出す。指定フレーム数の計測が終わっていればパッチ解除済みで、読み出しと同時に自動解除されるので profile_remove は不要。" +
        "計測途中でも呼べて、その時点までの集計が返る（この場合パッチは残る）。",
      inputSchema: { id: z.number().int().describe("profile_add が返した id") },
    },
    wrap(async (args) => bridgeResult(await bridge.profileRead(args.id as number))),
  );

  server.registerTool(
    "profile_remove",
    {
      description:
        "プロファイルを解除する（Harmony パッチも即時解除される）。完了まで待たずに止めたいときだけ使う（完了済みは profile_read が自動解除する）。",
      inputSchema: { id: z.number().int().describe("profile_add が返した id") },
    },
    wrap(async (args) => bridgeResult(await bridge.profileRemove(args.id as number))),
  );
}
