# 衣装の再読み込みと反映確認

同梱スキル `model-deploy` の実行中ゲーム向け手順を、MCP の専用ツールで呼び出せるようにした。
MCP の TypeScript 側で既存の `/eval` を利用するため、この機能の追加にゲーム側 DLL の更新は不要。
`npm run build` 後に MCP サーバーを再接続すると、新しいツールが利用できる。

## ツール

| ツール | 用途 |
| --- | --- |
| `refresh_mod_files` | 導入済み model / mate / menu / tex の SHA-256 照合と、ゲーム内ファイル検索への登録 |
| `inspect_clothing` | 対象メイド・通常／一時 menu・モデル名・全 Renderer の Mesh／材質／テクスチャと装備の取得 |
| `reload_clothing` | 現在有効な menu のままの再読み込み、完了待機、変更前後の状態確認 |

## 利用手順

1. スキルの導入手順で出力の鮮度・参照・重複導入を確認し、既存ファイルを Mod 検索対象外へ退避する。許可リストのファイルだけをコピーし、SHA-256 を照合する。書き込み範囲外へのコピーは権限昇格できるシェルで行う。MCP で権限制約を回避しない。
2. 新規の mate / tex 等がある場合、`refresh_mod_files` に正規の導入先 `directory` と manifest の `files` 辞書を渡す。ファイル名はサブフォルダーを含まない短い名前、値は SHA-256。ゲームの `ping.gameDir/Mod` 配下だけを許可し、全件照合してから `AddFolder`、`AddAutoPathForAllFolder(false)`、存在確認キャッシュの更新、各ファイルの認識確認を行う。
3. `list_maids` と現在の装備から、対象のストック番号・MPN・TBody スロットを確定する。表示中番号とストック番号を混同しない。
4. `inspect_clothing` に `maidIndex`、`mpn`、`slot` を渡す。返された `maidId` と `menu` を確認する。
5. `reload_clothing` に同じ3項目と `expectedMaidId`、`expectedMenu` を渡す。`expectedMenu` は現在有効な menu 名で、一時装備があればそちらを指定する。`timeoutMs` は省略時10秒、500～30000ミリ秒。`SetProp` は使わず、`boDut`（一時装備なら `boTempDut`）を立てて `AllProcPropSeqStart` を回すため、menu 名・RID・スケール設定は書き換えない。送信前に menu が参照する model と子 menu の存在を確認する。
6. `before` / `after` の Mesh ID・頂点数・subMesh 数・材質順・shader・テクスチャ情報を出力検証と照合する。`screenshot` または `capture` で見た目を確認し、ツール結果と画像をプロジェクトの検証記録に保存する。

対象の不一致、非表示、busy、ファイル指定でない装備、MPN とスロットの不一致、未処理の装備変更、参照先ファイルの欠落があれば、再読み込み要求を送らない。ゲーム内でも実行直前に再確認する。待機中のメイド変更・非表示化・装備変更・対象外 menu の変更・Mesh 欠落はエラーにする。メインスレッドの停止や評価エラーでは中断し、同じ操作を自動再送しない。

## 結果の意味と制限

- `refresh_mod_files` はファイルのコピーを行わない。`status=registered` はファイル検索への登録であり、通常ロードや表示確認の完了ではない。重複導入と検索順は事前にスキルの手順で確認する。
- 既存ファイルの上書き更新はいつでも反映される。一方、同じフォルダーへ**新しく追加した** mate や tex は、そのフォルダーを登録する初回だけ検索対象へ入る。同一セッションで2回目以降に追加したファイルはゲームを再起動するまで見つからない（ゲーム本体のファイルシステムが登録済みフォルダーを再走査しないため。ModItemExplorer で実機確認済み）。この場合は認識確認で失敗し、`status=registered` は返さない。
- Mod 配下に同名の menu が複数ある場合は、検索順を変えないよう登録を中止する。
- 応答を短く保つため、`inspect_clothing` の装備一覧は「MPN → menu」の形で空スロット（`_del`）を省き、一時装備があるときだけ併記する。`reload_clothing` の `before` / `after` には装備一覧を含めず、対象外装備の比較結果は `equipmentChanged` で返す。
- `reload_clothing` の `normalLoadCompleted=true` は、再読み込み要求の成功、busy／未処理状態の解消、対象装備と Mesh の存在、対象外 menu の保持を確認したことを示す。
- `visualVerified` と `geometryVerified` は常に `false`。Mesh ID・頂点数・材質枠数やテクスチャ寸法だけではファイル内容の完全一致を証明しない。`meshIdsChanged=false` の場合も自動で再ロードを繰り返さず、キャッシュ・検索順・menu 命令を調べる。
- 対象外装備の比較範囲は通常／一時 menu 名。対象外の全 Mesh・材質・モーフ・ポーズの完全一致までは保証しない。
- SceneEditor の単独モデル・Prefab・ステージ、初回装備、別 menu への着替えは対象外。一時装備は一時装備のまま再処理する。シーン再ロード、ゲーム再起動、セーブは行わない。
- 読み込み開始後に失敗しても、自動で衣装やファイルを復元・再送しない。現在の状態とログを調べ、導入の退避記録から必要な復元を判断する。
- 完了待機は `timeoutMs` で制限するが、各 HTTP 呼び出しの所要時間は既存ブリッジの応答時間に依存する。

## 検証

2026-09-21: TypeScript ビルド成功、`npx vitest run` 全86件成功。再読み込みを `SetProp` 方式から `boDut`／`boTempDut` 方式へ変更し、一時装備・参照先ファイルの事前確認・同名 menu 重複検出を COM3D2.ModItemExplorer.Plugin `0fb1051` から移植した。完了判定は `IsAllProcPropBusy`（`IsBusy` は `IsAllProcPropBusy && Visible` のため非表示時に完了前でも false になる）。

2026-09-20: MCP ハンドラーの正常系・異常系、SHA-256・パス逸脱・ジャンクション拒否を検証。stdio で MCP に接続し、追加3ツールの公開と `inspect_clothing` による実機の状態取得も確認した。装備以外の数値プロパティに通常残る更新フラグは、未処理の衣装変更として扱わない。

実機検証は未実施。ゲーム起動中に `eval_csharp` で `refresh_mod_files` の正常系・異常系、実衣装の再読み込み、一時装備の再処理、参照先欠落時の中止、画面の変化を確認すること。
