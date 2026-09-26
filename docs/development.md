# 開発者向け情報

COM3D25.DevBridge をソースから触る人向けの手順。使うだけなら [README](../README.md) で足ります。

## 構成

| 層 | 実体 | 役割 |
|---|---|---|
| BepInEx プラグイン | `plugin/`（C#, netstandard2.1） | ゲーム内に HTTP REPL を公開（既定 `127.0.0.1:24574`。ポートは BepInEx の cfg で変更可） |
| MCP サーバー | リポジトリ直下（TypeScript, stdio） | Claude Code / Codex のツール呼び出しを HTTP ブリッジへ中継 |
| 配布用プラグイン | `agent-plugin/` | Claude Code / Codex のプラグイン。MCP サーバーのバンドルと同梱スキル |

リポジトリのルートが npm パッケージ（`com3d25-devbridge-mcp`）で、C# プラグインは `plugin/` 配下にまとまっています。

配布用プラグインまわりのファイル:

| パス | 内容 |
|---|---|
| `.claude-plugin/marketplace.json` | Claude Code 用マーケットプレイス（`./agent-plugin` を指す） |
| `.agents/plugins/marketplace.json` | Codex 用マーケットプレイス（同上） |
| `agent-plugin/.claude-plugin/plugin.json` | Claude Code 用マニフェスト。データ保存先に `${CLAUDE_PLUGIN_DATA}` を渡す |
| `agent-plugin/.codex-plugin/` | Codex 用マニフェストと MCP 定義 |
| `agent-plugin/dist/server.mjs` | `npm run bundle` の生成物（依存込みの単一ファイル）。プラグインはインストール時にビルドしないため**コミット対象** |
| `agent-plugin/dist/THIRD-PARTY-NOTICES.txt` | `npm run bundle` が `server.mjs` と一緒に生成する、同梱 npm パッケージのライセンス文。これも**コミット対象** |
| `agent-plugin/skills/` | 同梱スキル |

## 初期設定: `.env`

ゲームのインストール先は開発者ごとに異なるため、リポジトリ直下の `.env` で指定します
（`.env` は gitignore 済み）。

```bash
cp .env.example .env   # GAME_DIR を自分のインストール先に書き換える
```

```ini
GAME_DIR=W:\COM3D2_5
```

`GAME_DIR` が未設定、または指すディレクトリが存在しない場合、
`plugin:build` / `plugin:release` はビルドを始める前にエラーで停止します。
シェルの環境変数に `GAME_DIR` が設定済みならそちらが優先されます。

## プラグインのビルドと配備

```bash
npm run plugin:build
```

Debug ビルドしたうえで `<GameDir>\BepInEx\plugins\COM3D25.DevBridge\` へ
`COM3D25.DevBridge.dll` と `Mono.CSharp.dll` を配備します。
配備先の DLL はゲーム起動中ロックされるため、**ゲームを終了してから**実行してください。

BepInEx 6 向けにビルドする場合は csproj を直接叩きます。
この経路は `.env` を読まないので `GameDir` を明示します:

```bash
dotnet build plugin/COM3D25.DevBridge.csproj -p:BepInExVersion=6 -p:GameDir=W:\COM3D2_5
```

ゲームを起動し、`<GameDir>\BepInEx\LogOutput.log` に次の行が出れば成功です:

```
COM3D25.DevBridge listening on http://127.0.0.1:24574/ (/ping, /eval, /reset, /capture, /imgui_windows, /dump, /watch, /profile)
```

## MCP サーバーの開発セットアップ

```bash
npm install && npm run build
```

リポジトリ直下の `.mcp.json`（Claude Code）と `.codex/config.toml`（Codex）に
ローカルビルド（`dist/index.js`）を指す設定があるため、このリポジトリを開けば
`com3d25-devbridge` サーバーとして読み込まれます。

MCP サーバーは次の環境変数を読みます（いずれも省略可）:

| 変数 | 既定 | 用途 |
|---|---|---|
| `BRIDGE_URL` | `http://127.0.0.1:24574` | 接続先のブリッジ |
| `GAME_DIR` | なし | ゲームのインストール先。通常はブリッジの `/ping` から自動解決するので不要 |
| `COM3D25_DEVBRIDGE_DATA_DIR` | パッケージのルート | スクリーンショットとゲームパスのキャッシュの保存先（絶対パスのみ有効） |

Claude Code のプラグインは `COM3D25_DEVBRIDGE_DATA_DIR` に `${CLAUDE_PLUGIN_DATA}` を渡します。

プラグイン経由の動作は、このリポジトリのローカルパスをマーケットプレイスとして登録すると push せずに確認できます。
Claude Code は既存の user スコープ登録を壊さないよう local スコープで入れます。

```bash
npm run bundle   # 手元のコードをバンドルへ反映する
claude plugin marketplace add ./ --scope local
claude plugin install com3d25-devbridge@com3d25-devbridge --scope local
claude mcp list   # plugin:com3d25-devbridge:com3d25-devbridge が Connected になる

# 後片付け
claude plugin uninstall com3d25-devbridge@com3d25-devbridge --scope local
claude plugin marketplace remove com3d25-devbridge
```

Codex は `codex plugin marketplace add <リポジトリの絶対パス>` → `codex plugin add com3d25-devbridge@com3d25-devbridge` で入ります。
ただし `[mcp_servers.com3d25-devbridge]`（user 設定や このリポジトリの `.codex/config.toml`）があるとそちらが優先されます。
プラグインの MCP を確かめるには、一時ディレクトリを `CODEX_HOME` に指定して隔離した環境で試してください。

## テスト

```bash
npm test                                           # MCP サーバー（TypeScript）
cd plugin && dotnet test COM3D25.DevBridge.Tests   # C# 側の純関数テスト
```

## リリース手順

バージョンは csproj の `<Version>` を基準に、MCP サーバー（`package.json`）と配布用プラグイン（`plugin.json`）を常に同じ値に揃えます。

```bash
npm run plugin:bump minor            # major / minor / patch。省略時は patch
npm run plugin:release -- --dry-run  # zip の内容を確認
npm run plugin:release               # tag push → GitHub Release まで
```

- `plugin:bump` は次の version をまとめて上げます。
  - csproj の `<Version>`
  - MCP サーバの `package.json` / `package-lock.json` と、initialize で名乗る `src/version.ts` の `SERVER_VERSION`
  - 配布用プラグインの 2 つの `plugin.json`
  
  さらにバンドル（`agent-plugin/dist/server.mjs` と `THIRD-PARTY-NOTICES.txt`）を再生成し、**これらのファイルだけ**を `chore: v<新Version>` でコミットします。
  - 開始時点で csproj と `package.json` の版が揃っていないとエラーで停止します。
  - バンドルは HEAD のコードから作るため、`src/` などに未コミットの変更があると停止します。
  - バンドル生成やコミットに失敗した場合は、書き換えたファイルを元に戻します。
- `plugin:release` は Release ビルド → zip 作成 → `git tag` / push → `gh release create` を行います。
  - 前提: working tree が clean で、`gh auth status` が通っていること
  - ビルド前にバンドルを再生成し、コミット済みのものと一致しなければ停止します
  - `--dry-run` でもバンドルを再生成するため、古いバンドルはこの時点で書き換わります
- zip の構成は次のとおりで、これ以外は入れません。
  - `BepInEx/plugins/COM3D25.DevBridge/` に `COM3D25.DevBridge.dll` と `Mono.CSharp.dll`（ゲームフォルダ直下へそのままコピーできる階層）
  - ルートに `README.md` / `LICENSE` / `THIRD-PARTY-NOTICES.md`

  ゲーム由来 DLL（`Assembly-CSharp.dll` 等）は再配布不可のため決して含めません。
- 既存の tag / Release の状態に応じて動作が変わります:
  - tag と Release が両方ある: バージョン上げ忘れとしてエラー
  - tag だけあって Release が無い: 途中失敗からの再実行とみなし、tag push をスキップして続行
- 配布用プラグインはマーケットプレイス（既定ブランチ）の `plugin.json` の version で更新が判定されます。
  bump のコミットを既定ブランチへ push した時点で利用者に更新が届きます。

CI ではプラグインをビルドしません。csproj がゲーム本体の `Assembly-CSharp.dll` を
インストール先から直接参照しており、GitHub Actions 上にそのアセンブリが存在しないためです。
リリースはローカルビルドした成果物を上記スクリプトで配布します。

## `src/snippets.ts` の運用

高水準ツール（`list_maids` / `scene_info` など）のゲーム側ロジックは
`src/snippets.ts` の C# テンプレートに置いてあります（衣装系ツールは `src/clothing.ts`）。
ゲームの更新で API 名がずれた場合の対処:

1. `eval_csharp` で正しいメンバー名を探索する
2. `src/snippets.ts` の該当テンプレートを修正する

この経路ならプラグインの再ビルド・再配備は不要です。
