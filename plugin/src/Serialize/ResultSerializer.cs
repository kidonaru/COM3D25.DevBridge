using System.Collections.Generic;
using System.Text;
using COM3D25.DevBridge.Eval;
using UnityEngine;

namespace COM3D25.DevBridge.Serialize
{
    /// <summary>
    /// EvalResult を HTTP 応答 JSON 文字列へ。Unity 型は describeSpecial で辞書化してから
    /// JsonGraphWriter（純関数）へ委譲する。
    /// </summary>
    public static class ResultSerializer
    {
        private const int MaxDepth = 3;
        private const int MaxItems = 100;

        public static string ToJson(EvalResult r)
        {
            var sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"ok\":").Append(r.Ok ? "true" : "false");
            if (r.Ok)
            {
                sb.Append(",\"result\":").Append(JsonGraphWriter.Write(r.Value, MaxDepth, MaxItems, DescribeUnity));
            }
            else
            {
                sb.Append(",\"error\":").Append(JsonGraphWriter.Write(r.Error ?? "", 1, 1, null));
            }
            sb.Append(",\"report\":").Append(JsonGraphWriter.Write(r.Report ?? "", 1, 1, null));
            sb.Append(",\"elapsedMs\":").Append(r.ElapsedMs);
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>Unity 型を有用フィールドの辞書に。非対象は null。</summary>
        private static IDictionary<string, object> DescribeUnity(object o)
        {
            if (o is GameObject go)
            {
                return new Dictionary<string, object>
                {
                    ["__type"] = "GameObject",
                    ["name"] = go.name,
                    ["activeInHierarchy"] = go.activeInHierarchy,
                    ["activeSelf"] = go.activeSelf,
                    ["path"] = HierarchyPath(go.transform),
                    ["instanceID"] = go.GetInstanceID(),
                    ["scene"] = go.scene.name,
                };
            }
            if (o is Component comp)
            {
                return new Dictionary<string, object>
                {
                    ["__type"] = comp.GetType().Name,
                    ["name"] = comp.name,
                    ["path"] = HierarchyPath(comp.transform),
                    ["instanceID"] = comp.GetInstanceID(),
                };
            }
            if (o is UnityEngine.Object uo) // その他 UnityEngine.Object（Mesh/Material 等）
            {
                return new Dictionary<string, object>
                {
                    ["__type"] = uo.GetType().Name,
                    ["name"] = uo.name,
                    ["instanceID"] = uo.GetInstanceID(),
                };
            }
            return null;
        }

        private static string HierarchyPath(Transform t)
        {
            if (t == null) return "";
            var stack = new System.Collections.Generic.Stack<string>();
            for (var cur = t; cur != null; cur = cur.parent) stack.Push(cur.name);
            return string.Join("/", stack.ToArray());
        }
    }
}
