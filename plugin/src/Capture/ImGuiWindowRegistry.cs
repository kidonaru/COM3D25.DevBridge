using System;
using System.Collections.Generic;
using System.Text;
using HarmonyLib;
using UnityEngine;

namespace COM3D25.DevBridge.Capture
{
    /// <summary>
    /// IMGUI（OnGUI）ウィンドウの台帳。Unity は GUI.Window の矩形を公開しないため、
    /// GUI.DoWindow / DoModalWindow に Harmony postfix を当てて毎フレームの id・タイトル・画面矩形を記録する。
    /// 矩形は GUIToScreenRect で GUI.matrix（プラグイン独自のスケーリング）を折り込んだ画面 px（左上原点）。
    /// 記録はメインスレッド（OnGUI）、参照も capture のコルーチン（メインスレッド）なので lock 不要。
    /// </summary>
    internal static class ImGuiWindowRegistry
    {
        internal struct Entry
        {
            public int Id;
            public string Title;
            public Rect ScreenRect;
            public int Frame;
        }

        /// <summary>この範囲のフレームで描かれていないウィンドウは「閉じた」とみなす。</summary>
        private const int StaleFrames = 2;

        private static readonly Dictionary<int, Entry> _entries = new Dictionary<int, Entry>();
        private static Harmony _harmony;

        public static void Install()
        {
            if (_harmony != null) return;
            _harmony = new Harmony("com3d25.devbridge.imgui");
            var postfix = new HarmonyMethod(typeof(ImGuiWindowRegistry), nameof(DoWindowPostfix));
            foreach (var name in new[] { "DoWindow", "DoModalWindow" })
            {
                var m = AccessTools.Method(typeof(GUI), name);
                if (m == null)
                {
                    Plugin.Log?.LogWarning($"COM3D25.DevBridge: GUI.{name} が見つからず IMGUI ウィンドウ追跡をスキップしました");
                    continue;
                }
                _harmony.Patch(m, postfix: postfix);
            }
        }

        public static void Uninstall()
        {
            _harmony?.UnpatchSelf();
            _harmony = null;
            _entries.Clear();
        }

        // DoWindow / DoModalWindow はタイトル引数名が title / content で異なるため名前束縛は使わず、
        // __args から GUIContent を拾う。__result はレイアウト確定後の最終矩形（GUI 座標）
        private static void DoWindowPostfix(int id, object[] __args, Rect __result)
        {
            string title = null;
            foreach (var a in __args)
                if (a is GUIContent c) { title = c.text; break; }
            _entries[id] = new Entry
            {
                Id = id,
                Title = title ?? "",
                ScreenRect = GUIUtility.GUIToScreenRect(__result),
                Frame = Time.frameCount,
            };
        }

        /// <summary>直近フレームに描かれたウィンドウ一覧。閉じたウィンドウはここで台帳から捨てる（id が毎フレーム変わる実装でも肥大しない）。</summary>
        public static List<Entry> Live()
        {
            var list = new List<Entry>();
            List<int> stale = null;
            int now = Time.frameCount;
            foreach (var e in _entries.Values)
            {
                if (now - e.Frame <= StaleFrames) list.Add(e);
                else (stale ??= new List<int>()).Add(e.Id);
            }
            if (stale != null) foreach (var id in stale) _entries.Remove(id);
            return list;
        }

        /// <summary>/imgui_windows 用。JsonGraphWriter でそのまま JSON 化できる形（id/title/x/y/w/h、左上原点 px）。</summary>
        public static List<Dictionary<string, object>> LiveAsJsonObjects()
        {
            var list = new List<Dictionary<string, object>>();
            foreach (var e in Live())
            {
                var r = e.ScreenRect;
                list.Add(new Dictionary<string, object>
                {
                    { "id", e.Id },
                    { "title", e.Title },
                    { "x", Mathf.RoundToInt(r.x) },
                    { "y", Mathf.RoundToInt(r.y) },
                    { "w", Mathf.RoundToInt(r.width) },
                    { "h", Mathf.RoundToInt(r.height) },
                });
            }
            return list;
        }

        /// <summary>
        /// タイトルでウィンドウを探す。完全一致を優先し、無ければ部分一致（大文字小文字無視）。
        /// "#&lt;id&gt;" で id 指定も可。複数一致は最初の 1 件（警告ログ）。
        /// </summary>
        public static bool TryFind(string query, out Entry found, out string error)
        {
            found = default;
            error = null;
            var live = Live();
            if (query.Length > 1 && query[0] == '#' && int.TryParse(query.Substring(1), out int id))
            {
                foreach (var e in live) if (e.Id == id) { found = e; return true; }
                error = "id=" + id + " の IMGUI ウィンドウは表示されていません。" + Describe(live);
                return false;
            }
            var hits = new List<Entry>();
            foreach (var e in live) if (e.Title == query) hits.Add(e);
            if (hits.Count == 0)
                foreach (var e in live)
                    if (e.Title.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0) hits.Add(e);
            if (hits.Count == 0)
            {
                error = "IMGUI ウィンドウが見つかりません: " + query + "。" + Describe(live);
                return false;
            }
            if (hits.Count > 1)
                Plugin.Log?.LogWarning($"COM3D25.DevBridge /capture: imgui ウィンドウが {hits.Count} 件一致。最初の 1 件を使用（id={hits[0].Id} title={hits[0].Title}）");
            found = hits[0];
            return true;
        }

        private static string Describe(List<Entry> live)
        {
            if (live.Count == 0) return "現在表示中の IMGUI ウィンドウはありません";
            var sb = new StringBuilder("表示中: ");
            for (int i = 0; i < live.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                var r = live[i].ScreenRect;
                sb.Append('#').Append(live[i].Id).Append(" \"").Append(live[i].Title).Append("\"(")
                  .Append((int)r.x).Append(',').Append((int)r.y).Append(',').Append((int)r.width).Append(',').Append((int)r.height).Append(')');
            }
            return sb.ToString();
        }
    }
}
