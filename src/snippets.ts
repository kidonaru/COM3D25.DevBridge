// ゲーム内で評価する C# テンプレート。戻り値は `|` 区切りの行指向テキスト（TS 側でパースする）。
// ゲーム側で JSON を手組みしないのは、Mono.CSharp 経由で評価する式の依存を最小に保つため。
// ロジックをここに置くことでゲームを再起動せずに改修できる。
// API 名は COM3D2.5 (Unity 2022.3.62f2) の Assembly-CSharp メタデータで確認済み:
//   GameMain.Instance.CharacterMgr / GetStockMaidCount() / GetStockMaid(int)
//   Maid.status(MaidStatus.Status).fullNameJpStyle / Maid.Visible / Maid.IsBusy
//   GameMain.Instance.SysDlg(SystemDialog).IsDecided
// ゲームのバージョン更新で名前がずれた場合は eval_csharp で探索して修正する。

export const LIST_MAIDS_CS = `
var _sb = new System.Text.StringBuilder();
var _mgr = GameMain.Instance.CharacterMgr;
int _n = _mgr.GetStockMaidCount();
for (int _i = 0; _i < _n; _i++) {
    var _m = _mgr.GetStockMaid(_i);
    if (_m == null) continue;
    _sb.Append(_i).Append("|")
       .Append(_m.status.fullNameJpStyle).Append("|")
       .Append(_m.Visible ? "visible" : "hidden").Append("|")
       .Append(_m.IsBusy ? "busy" : "idle").Append("\\n");
}
_sb.ToString()
`.trim();

export const SCENE_INFO_CS = `
var _sb = new System.Text.StringBuilder();
var _scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
_sb.Append("scene|").Append(_scene.name).Append("\\n");
_sb.Append("sysDialog|").Append(GameMain.Instance.SysDlg != null && GameMain.Instance.SysDlg.IsDecided ? "decided" : "-").Append("\\n");
var _roots = _scene.GetRootGameObjects();
_sb.Append("rootCount|").Append(_roots.Length).Append("\\n");
foreach (var _go in _roots) _sb.Append("root|").Append(_go.name).Append("|").Append(_go.activeSelf ? "active" : "inactive").Append("\\n");
_sb.ToString()
`.trim();
