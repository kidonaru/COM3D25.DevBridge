---
name: restart-verify
description: Use when a COM3D2.5 plugin change must be verified on the real game while the running game holds the old DLL — quit the game, update the DLL, relaunch, load a save, and test through the com3d25-devbridge tools. Also use when asked to "ゲーム再起動して", "DLL を反映して実機で確認", "セーブをロードして".
---

# COM3D2.5 を再起動して実機検証する

稼働中のゲームはプラグイン DLL をロックしているため、変更を実機で通すには
「終了 → DLL 更新 → 起動 → セーブロード → テスト」を順に行う。

## 手順

| 段 | やること | 判定 |
|---|---|---|
| 0. 下調べ | ゲーム停止中は REPL が使えないので、終了させる前に次を控える。`ping` の `gameDir`（以下 `<GameDir>`）と、ロードするセーブのスロット（選び方は表の下） | 両方の値が取れている |
| 1. 終了 | `eval_csharp` で `UnityEngine.Application.Quit();` | `tasklist` に `COM3D2x64.exe` が出ない（通常 1〜2 秒）。10 秒待って残るなら `taskkill /IM COM3D2x64.exe /F` |
| 2. DLL 更新 | 対象プラグインをビルドし、成果物 DLL をゲームが読み込む場所（`<GameDir>\BepInEx\plugins\` 配下、`<GameDir>\Sybaris\UnityInjector\` など、そのプラグインの配置方式に従う）へコピーする。プロジェクトにビルド・配備用のスクリプトがあればそれを使う | 成果物と配備先の DLL のハッシュが一致 |
| 3. 起動 | PowerShell で `Start-Process -FilePath '<GameDir>\COM3D2x64.exe' -WorkingDirectory '<GameDir>'` | `Get-Process COM3D2x64` に出る |
| 4. 待つ | `<GameDir>\BepInEx\LogOutput.log` のサイズが 2 秒間隔で 3 回変わらなくなるまで `until` ループをバックグラウンドで回す（上限 2 分） | `ping` が `mainThreadAlive: true`（起動直後は false で正常。2 分超なら `tail_log` で例外を見る） |
| 5. ロード | `eval_csharp` で `GameMain.Instance.Deserialize(<slot>);` | 4 と同じ待ち方のあと `UnityEngine.SceneManagement.SceneManager.GetActiveScene().name` が `SceneTitle` 以外 |
| 6. REPL 準備 | `reset_evaluator`。検証対象プラグインに有効化や初期化の操作が要るならここで行う | 対象プラグインの型を完全修飾名で参照する eval がコンパイルエラーにならない |
| 7. テスト | プラグインの公開 API を完全修飾名で直接呼ぶ | 期待値どおり、かつ `tail_log` に対象プラグイン由来の例外が無い（見分け方は落とし穴を参照） |

スロットは `GameMain.Instance.GetSaveDataHeader(i)`（0〜99、null は空き）の `strSaveTime`
（`yyyyMMddHHmmss` の文字列。文字列比較で最大を取れる）が最大のものを選ぶ。
ユーザーが指定していなければ最新を使い、報告でスロット番号と日付を明示する。

## 落とし穴

- **`cmd //c start` はアクセス拒否になる**。起動は PowerShell の `Start-Process` を使う
- **評価器はプラグインのロード前に作られる**ので、再起動直後はプラグインの名前空間が「存在しない」とコンパイルエラーになる。`reset_evaluator` で直る。REPL に `using` は無いので常に完全修飾名で書く
- `sleep N; cmd` のチェーンはブロックされる。待ちは `until` ループをバックグラウンドで回す
- `Deserialize` の戻り値 true はロード開始を意味するだけ。完了はログの静止とシーン名で判定する
- ビルドスクリプトの出力をパイプに繋ぐと終了コードがパイプ側になる。成否はログ文言と DLL ハッシュで判定する
- **MOD やアセット由来のエラーは普段から出る**（AssetBundle の読み込み失敗、背景切替時の `NullReferenceException`、GUIStyle の警告など）。例外の有無ではなく、スタックトレースに対象プラグインの名前空間・型が含まれるかで判定する。`LogOutput.log` は起動のたびに中身が上書きされるので、再起動前のログとは比べられない

## テストの書き方

- 状態を変える eval と読む eval を分ける（反映が次フレーム以降や非同期のことが多い。衣装なら `maid.IsAllProcPropBusy == false` を確認してから読む）
- 終わったら変更した状態を戻し、報告には eval の戻り値・`tail_log` 抜粋・DLL ハッシュ一致を添える
