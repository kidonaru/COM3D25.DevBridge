#!/usr/bin/env node
// COM3D25.DevBridge MCP サーバー（stdio）。HTTP ブリッジへ中継する。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./bridge.js";
import { loadConfig } from "./config.js";
import { SERVER_VERSION } from "./version.js";
import { GameDirResolver } from "./game-dir.js";
import { registerBasicTools } from "./tools/basic.js";
import { registerGameTools } from "./tools/game.js";
import { registerClothingTools } from "./tools/clothing.js";
import { registerModFileTools } from "./tools/mod-files.js";

// セッション開始時に常時ロードされるため、ツール横断の知識だけを簡潔に置く。
// ツール個別の仕様は各 registerTool の description 側（ツール使用時にのみロード）に書く。
const INSTRUCTIONS = `稼働中の COM3D2.5（Unity/BepInEx）へ C# REPL を通す dev 専用ブリッジ。ゲームを再起動せずに状態を調べる・画面を撮る・値を毎フレーム監視できる。

典型的な進め方:
1. ping で死活確認する
2. scene_info / list_maids で今の状態の当たりをつける
3. eval_csharp で実際のメンバー名を探索する。ゲームのバージョン差で API 名がずれるため、推測せず実物を確認すること

全ツール共通の注意:
- ゲーム側アセンブリの同名識別子を REPL の名前解決が型より先に拾うため、Unity 型は完全修飾名で書くこと。UnityEngine.Time.frameCount は動くが、Time.frameCount と短縮すると null や "CS0023 ... method group" になる
- ゲームが起動していないと使えるのは tail_log だけ。クラッシュ調査はここから始める`;

const config = loadConfig();
const server = new McpServer({ name: "com3d25-devbridge", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
const bridge = new BridgeClient(config.bridgeUrl);
const gameDirResolver = new GameDirResolver(bridge, config.gameDirCacheFile, config.gameDirOverride);
registerBasicTools(server, bridge, config);
registerGameTools(server, bridge, gameDirResolver);
registerClothingTools(server, bridge);
registerModFileTools(server, bridge);
await server.connect(new StdioServerTransport());
