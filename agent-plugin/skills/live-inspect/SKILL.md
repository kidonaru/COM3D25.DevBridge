---
name: live-inspect
description: Use when a com3d25-devbridge investigation needs more than a single eval — waiting for an asynchronous game change (costume apply, scene load) before reading state, dumping a menu file, narrowing down a slow method with profile_add or a hand-written Harmony patch. Also use when asked to "重い原因を計測", "menu の中身を見て".
---

# 稼働中の COM3D2.5 を調べる

静的解析で結論が出ないことは実機で裏を取る。ゲームのバージョン差で API 名がずれるため、メンバー名は推測せず REPL で実物を確かめてから使う。

## eval の積み上げ方

- REPL の変数は呼び出しをまたいで残るので、取得したオブジェクトを変数に置いて小さく刻んで積み上げる。メンバー一覧は `typeof(Maid).GetMethods()` などのリフレクションで引く
- 状態を変える eval と読む eval を分ける。反映が次フレーム以降や非同期のことが多い

## 非同期の変化を待つ

- 衣装の適用 `maid.AllProcPropSeqStart()` は非同期。直後ではなく `maid.IsAllProcPropBusy == false` になってから状態を読む
- 完了を待つ・変化の瞬間を捉えるには `watch_add`（`mode=diff`）で式を監視し、`watch_read` で読む。watch は単一式のみ

## menu ファイルの中身を見る

`GameUty.FileOpen(fn).ReadAll()` で得たバイト列を `System.IO.BinaryReader` で読む。
構造はヘッダ（string, int32, string×4, int32）の後にコマンドブロック列が続く。

## 性能を測る

- `profile_add` は描画エントリポイントのような粗い粒度から測り、`profile_read` の結果を見て重い呼び出し先へ 1 段ずつ絞り込む
- 同名型が複数アセンブリにあると `profile_add` は失敗する。その場合は `eval_csharp` で計測用 static クラスを定義し、`HarmonyLib.Harmony.Patch` で自前の prefix を当てる。計測後は `HarmonyLib.Harmony.UnpatchID(id)` で必ず解除する（`UnpatchAll(string)` は obsolete でコンパイルエラー）

## 落とし穴

- ゲーム起動直後にプラグインの型が見つからないなら `reset_evaluator`。評価器はプラグインより先に作られる
- 調査で変えた状態は最後に戻す
