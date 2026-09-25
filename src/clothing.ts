// 衣装の通常再読み込みで使う入力と C# テンプレート。
import { z } from "zod";
import { csharpString, expression } from "./csharp.js";

export const clothingTargetSchema = z.object({
  // 上限を設けないと 1e21 のような値が指数表記のまま C# へ埋め込まれ、構文エラーになる。
  maidIndex: z.number().int().min(0).max(9999).describe("list_maids が返すストック番号"),
  mpn: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe("装備の MPN 名"),
  slot: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe("対応する TBody スロット名"),
});
export type ClothingTarget = z.infer<typeof clothingTargetSchema>;

// 衣装は Renderer → 材質 → テクスチャと入れ子が深く件数も多いため、
// ResultSerializer の既定（深さ 3 / 100 件）では末端が落ちる。ここだけ広げる。
const JSON_MAX_DEPTH = 12;
const JSON_MAX_ITEMS = 10000;

// MaidProp.type がファイル指定（menu）を表す値。AllProcProp はこの型だけを再処理する
// （Maid.AllProcProp）。
export const FILE_PROP_TYPE = 3;

/** 通常／一時のどちらかに menu が入っている（＝装備がある）かの C# 判定式。 */
function hasEquipmentExpression(prop: string): string {
  return `(!System.String.IsNullOrEmpty(${prop}.strFileName) || !System.String.IsNullOrEmpty(${prop}.strTempFileName))`;
}

/** 適用待ち（boDut）の装備変更が残っているかの C# 判定式。 */
function isDirtyExpression(prop: string): string {
  return `${hasEquipmentExpression(prop)} && (${prop}.boDut || ${prop}.boTempDut)`;
}

/** 対象メイド・MPN・スロットを解決し、揃わなければ例外で中断するガードを生成する。 */
function targetGuardCode(target: ClothingTarget): string {
  return `
var mgr = GameMain.Instance.CharacterMgr;
if (${target.maidIndex} >= mgr.GetStockMaidCount()) throw new System.Exception("メイド番号が範囲外です");
var maid = mgr.GetStockMaid(${target.maidIndex});
if (maid == null || maid.body0 == null) throw new System.Exception("対象メイドのボディがありません");
if (!System.Enum.IsDefined(typeof(MPN), ${csharpString(target.mpn)})) throw new System.Exception("未定義の MPN です");
var mpn = (MPN)System.Enum.Parse(typeof(MPN), ${csharpString(target.mpn)});
var prop = maid.GetProp(mpn);
if (prop == null) throw new System.Exception("対象の装備情報がありません");
var slot = maid.body0.GetSlot(${csharpString(target.slot)});
if (slot == null) throw new System.Exception("対象スロットがありません");
`;
}

export function inspectClothingCode(target: ClothingTarget): string {
  // 返す辞書のキーは src/tools/clothing.ts の snapshotSchema と対応させること。
  return expression(targetGuardCode(target) + `
var renderers = new System.Collections.Generic.List<object>();
if (!maid.IsAllProcPropBusy && slot.obj != null) {
  foreach (var renderer in slot.obj.GetComponentsInChildren<UnityEngine.SkinnedMeshRenderer>(true)) {
    var mesh = renderer.sharedMesh;
    var materials = new System.Collections.Generic.List<object>();
    foreach (var material in renderer.sharedMaterials) {
      if (material == null) { materials.Add(null); continue; }
      var textures = new System.Collections.Generic.Dictionary<string, object>();
      foreach (var property in new string[] { "_MainTex", "_ToonRamp", "_ShadowRateToon" }) {
        if (!material.HasProperty(property)) continue;
        var texture = material.GetTexture(property);
        textures[property] = texture == null ? null : new System.Collections.Generic.Dictionary<string, object> {
          { "name", texture.name }, { "id", texture.GetInstanceID() }, { "width", texture.width }, { "height", texture.height }
        };
      }
      materials.Add(new System.Collections.Generic.Dictionary<string, object> {
        { "name", material.name }, { "shader", material.shader == null ? null : material.shader.name }, { "textures", textures }
      });
    }
    var triangles = new System.Collections.Generic.List<object>();
    if (mesh != null) for (int i = 0; i < mesh.subMeshCount; i++) triangles.Add(mesh.GetIndexCount(i) / 3);
    renderers.Add(new System.Collections.Generic.Dictionary<string, object> {
      { "rendererId", renderer.GetInstanceID() }, { "name", renderer.name },
      { "meshId", mesh == null ? 0 : mesh.GetInstanceID() }, { "vertexCount", mesh == null ? 0 : mesh.vertexCount },
      { "subMeshCount", mesh == null ? 0 : mesh.subMeshCount }, { "triangles", triangles }, { "materials", materials }
    });
  }
}
var equipment = new System.Collections.Generic.Dictionary<string, object>();
var dirtyEquipment = new System.Collections.Generic.List<string>();
foreach (MPN key in System.Enum.GetValues(typeof(MPN))) {
  var other = maid.GetProp(key);
  if (other != null && ${isDirtyExpression("other")}) dirtyEquipment.Add(key.ToString());
  if (other != null && ${hasEquipmentExpression("other")}) equipment[key.ToString()] = new string[] { other.strFileName ?? "", other.strTempFileName ?? "" };
}
var result = new System.Collections.Generic.Dictionary<string, object> {
  { "maidId", maid.GetInstanceID() }, { "name", maid.status.fullNameJpStyle }, { "visible", maid.Visible },
  { "busy", maid.IsAllProcPropBusy }, { "menu", prop.strFileName ?? "" }, { "temporaryMenu", prop.strTempFileName ?? "" },
  { "renderers", renderers }, { "equipment", equipment },
  { "dirtyEquipment", dirtyEquipment }, { "slotMpn", slot.m_ParentMPN.ToString() }, { "model", slot.m_strModelFileName }, { "noScale", prop.bNoScale },
  { "propType", prop.type }
};
return COM3D25.DevBridge.Serialize.JsonGraphWriter.Write(result, ${JSON_MAX_DEPTH}, ${JSON_MAX_ITEMS}, null);
`);
}

export function reloadClothingCode(target: ClothingTarget, maidId: number, activeMenu: string): string {
  // inspect からこの評価が届くまでの間に状態が変わりうるため、TypeScript 側の事前検証と
  // 同じ条件をゲーム内でも実行直前に再確認する（check-then-act のレース対策）。
  return expression(targetGuardCode(target) + `
if (maid.GetInstanceID() != ${maidId}) throw new System.Exception("対象メイドが変更されました");
if (!maid.Visible || maid.IsAllProcPropBusy) throw new System.Exception("対象メイドが非表示または処理中です");
if (prop.type != ${FILE_PROP_TYPE}) throw new System.Exception("ファイル指定の装備ではありません");
var active = System.String.IsNullOrEmpty(prop.strTempFileName) ? prop.strFileName : prop.strTempFileName;
if (!System.String.Equals(active, ${csharpString(activeMenu)}, System.StringComparison.OrdinalIgnoreCase)) throw new System.Exception("装備メニューが変更されました");
if (slot.m_ParentMPN != mpn) throw new System.Exception("MPN とスロットが対応していません");
foreach (MPN key in System.Enum.GetValues(typeof(MPN))) {
  var other = maid.GetProp(key);
  if (other != null && ${isDirtyExpression("other")}) throw new System.Exception("未処理の装備変更があるため中止しました");
}
// 装備の指定し直しは行わない。menu 名・RID・スケール設定を書き換えず、
// 現在有効な装備だけを再処理する（ゲーム本体の ProcItem と同じフラグを選ぶ）。
if (!System.String.IsNullOrEmpty(prop.strTempFileName)) prop.boTempDut = true; else prop.boDut = true;
maid.AllProcPropSeqStart();
return "started";
`);
}
