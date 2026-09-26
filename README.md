# COM3D25.DevBridge

カスタムオーダーメイド 3D2.5 (COM3D2.5) の **dev 専用** live introspection bridge と、その MCP サーバー。

稼働中のゲームプロセスに localhost 限定の C# REPL を公開し、Claude Code や Codex から
「ゲームを再起動せずに」状態を調べる・画面をキャプチャする・値を毎フレーム監視する、といった操作を行う。

> **dev 専用ツールです。** 製品モッド等への同梱は禁止です（本リポジトリの Releases は開発者向け配布）。
> 認証は無く、`127.0.0.1` にのみバインドすることでアクセスを制限しています。

## インストール

### 1. プラグイン

[Releases](https://github.com/kidonaru/COM3D25.DevBridge/releases) から
`COM3D25.DevBridge-v<version>.zip` をダウンロードし、`<GameDir>\BepInEx\plugins\` に展開します。
展開後は次の配置になります:

```
<GameDir>\BepInEx\plugins\COM3D25.DevBridge\
    COM3D25.DevBridge.dll
    Mono.CSharp.dll
```

ゲームを起動し、`<GameDir>\BepInEx\LogOutput.log` に次の行が出れば成功です:

```
COM3D25.DevBridge listening on http://127.0.0.1:18650/ (/ping, /eval, /reset, /capture, /imgui_windows, /dump, /watch, /profile)
```

### 2. MCP サーバーとスキル（Claude Code / Codex）

このリポジトリをプラグインのマーケットプレイスとして登録し、`com3d25-devbridge` プラグインを入れます。
MCP サーバー `com3d25-devbridge` と、次のスキルが入ります。

| スキル | 用途 |
|---|---|
| `live-inspect` | 稼働中のゲームを調べる定石（非同期の待ち方、menu のダンプ、性能計測の進め方） |
| `restart-verify` | ゲームを再起動し、プラグイン DLL の変更を実機で検証する |
| `model-deploy` | 作った model / mate / menu / tex を Mod フォルダへ導入し、実行中のゲームで再読み込みして確認する（manifest 照合スクリプトに Python 3 を使う） |

Claude Code:

```bash
claude plugin marketplace add kidonaru/COM3D25.DevBridge
claude plugin install com3d25-devbridge@com3d25-devbridge
```

Codex CLI:

```bash
codex plugin marketplace add kidonaru/COM3D25.DevBridge
codex plugin add com3d25-devbridge@com3d25-devbridge
```

プラグイン DLL と MCP サーバーは同じバージョンで公開しています。DLL を更新したらプラグインも更新してください。

#### 更新

Claude Code（反映にはセッションの再起動が必要です）:

```bash
claude plugin marketplace update com3d25-devbridge
claude plugin update com3d25-devbridge@com3d25-devbridge
```

Codex CLI:

```bash
codex plugin marketplace upgrade com3d25-devbridge
codex plugin add com3d25-devbridge@com3d25-devbridge
```

#### 補足

Claude Code ではスクリーンショットとゲームパスのキャッシュを `~/.claude/plugins/data/` 配下に保存します（プラグインを更新しても残ります）。
Codex ではプラグインのインストール先に保存するため、更新すると消えます。ゲームパスは次回 `/ping` で再取得されるため実害はありません。

ゲームのインストール先はブリッジの `/ping` から自動解決されます（`GAME_DIR` 環境変数での上書きも可能）。
一度接続するとパスがキャッシュされるため、ゲームクラッシュ中でも `tail_log` でログを確認できます。

## ツール一覧

### 薄ラップ（ブリッジ API と 1:1）

| ツール | 説明 |
|---|---|
| `ping` | ブリッジの死活確認。`version`・`mainThreadAlive`・`stalledSecs`・`gameDir` を返す |
| `eval_csharp` | ゲーム内で C# を評価する（メインスレッド実行）。REPL 状態（変数・using）は保持される |
| `reset_evaluator` | 評価器を作り直す。REPL 状態は失われる（評価器破損時の復旧用） |
| `capture` | `screen` / `rt:<name>` / `camera:<name>` / `imgui:<title>` を PNG 保存し画像で返す。`maxSize` は**長辺のピクセル数**（縮小率ではない。省略で原寸）。`rect="x,y,w,h"`（左上原点）で切り抜き |
| `watch_add` | 毎フレーム評価する式を登録し watch id を返す（単一式のみ） |
| `watch_read` | watch の収集結果を読み出す（完了済みなら自動解除される） |
| `watch_remove` | watch を解除する |
| `profile_add` | 指定メソッドを Harmony パッチで計測開始し profile id を返す（[計測の限界](#profile_add--profile_read--profile_remove)を必ず確認） |
| `profile_read` | プロファイルの集計結果を読み出す（完了済みなら自動解除される） |
| `profile_remove` | プロファイルを解除する（Harmony パッチも即時解除される） |

### profile_add / profile_read / profile_remove

指定メソッドを Harmony パッチで計測する（呼び出し回数/フレーム、ms 合計/平均/最大、GC アロケーション増分、`Event.current.type` 別内訳）。

    profile_add target="COM3D2.SceneEditor.Plugin.HierarchyWindow:DrawContent" frames=300

計測の限界（値を読むときの前提）:

- **再帰・超高頻度メソッドは正確に測れない。** 数千回/フレーム走るメソッドはパッチ自体のオーバーヘッドが測定値を汚す。粗い粒度（描画エントリポイント等）で測り、内側は呼び出し回数だけ見る。
- 再帰メソッドは深度カウンタで**最外周のみ**計測する（内側の呼び出しは回数にも時間にも入らない）。
- パッチはインライン化を阻害するため、極小メソッドの絶対値は信用しない。
- GC アロケーション増分は `GC.GetTotalMemory` の前後差分で、計測中に GC が走った呼び出しは 0 扱いになる（その呼び出しの割り当ては計上されないため実測より少なめに出る。傾向を見る用途）。
- 計測はメインスレッド実行のメソッドを前提とする。ワーカースレッドから呼ばれるメソッドの値は保証しない（再帰判定の深度カウンタが食い違うと、そのプロファイルは以降の記録が完全に止まることがある）。
- 型は完全名で一意に解決できる必要がある。同名型が複数アセンブリに存在する場合はエラーになる（アセンブリ修飾指定は未対応）。
- メソッドは指定型に宣言が無ければ基底クラスを遡って探す。見つかった宣言階層のオーバーロード全件がまとめて 1 エントリで計測される。

パッチは「frames 消化（Done 遷移）・profile_remove・reset_evaluator・プラグイン破棄」のいずれでも確実に解除される。

### 高水準（COM3D2.5 固有）

| ツール | 説明 |
|---|---|
| `screenshot` | ゲーム画面を撮って画像で返す（`capture target=screen` の別名。`maxSize` 既定 1280）。`window="<title>"` で IMGUI ウィンドウだけ、`rect="x,y,w,h"` で矩形だけを切り抜ける |
| `list_imgui_windows` | 表示中の IMGUI ウィンドウ一覧（id・title・x/y/w/h）。`screenshot window=` や `capture imgui:` に渡す値を決めるのに使う |
| `list_maids` | ストック中のメイド一覧（index・名前・表示状態・busy 状態） |
| `scene_info` | 現在のシーン名とルート GameObject の要約 |
| `refresh_mod_files` | 導入済みModのSHA-256照合とゲーム内ファイル検索への登録 |
| `inspect_clothing` | 衣装のメイドID・menu・Mesh・材質・テクスチャ・装備状態の取得 |
| `reload_clothing` | 現在有効な衣装menuの再読み込み（SetPropを使わずboDut/boTempDut）と完了待機・前後比較（[手順と制限](docs/clothing-reload.md)） |
| `tail_log` | `BepInEx/LogOutput.log` の末尾 N 行（パスは自動解決。**クラッシュ中もキャッシュ済みパスで動く**） |

## トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| 「ブリッジに接続できません」 | ゲームが起動していないか、プラグインが未ロード。`LogOutput.log` に `COM3D25.DevBridge listening` があるか確認する。`tail_log` はゲーム未起動でも使えます |
| `eval_csharp` が `compile error` を返し続ける | 評価器の内部状態が壊れている可能性。`reset_evaluator` を実行する（REPL 変数は失われます） |
| `ping` の `mainThreadAlive` が `false` | ゲームのメインスレッドが固まっている。この状態では `/eval` も `/reset` も同じキューで詰まるため、復旧はゲーム再起動 |
| `watch_add` が「単一式のみ対応」で失敗 | watch は式のみ対応。複数文・変数宣言は `eval_csharp` を使う |
| `Time.frameCount` が `null` を返す / watch で `CS0023 ... method group` になる | ゲーム側アセンブリに同名の識別子があり、REPL の名前解決が型より先にそちらを拾うため。**完全修飾名**（`UnityEngine.Time.frameCount`）を使う。Unity 型全般でこの回避策が有効 |

## 開発

ソースからのビルド、テスト、リリース手順は [docs/development.md](docs/development.md) を参照してください。
