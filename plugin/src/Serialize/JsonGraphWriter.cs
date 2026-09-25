using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;

namespace COM3D25.DevBridge.Serialize
{
    /// <summary>
    /// 任意 object を JSON 文字列化する純関数。depth / コレクション件数 / 循環参照をガードし、
    /// 巨大グラフや循環でハングしない。UnityEngine 非依存（Unity 型整形は describeSpecial で外部注入）。
    /// </summary>
    public static class JsonGraphWriter
    {
        /// <param name="describeSpecial">特別扱いする型を辞書へ変換（非対象は null を返す）。null 可。</param>
        public static string Write(object value, int maxDepth, int maxItems, Func<object, IDictionary<string, object>> describeSpecial)
        {
            var sb = new StringBuilder();
            var seen = new HashSet<object>(ReferenceEqualityComparer.Instance);
            WriteValue(sb, value, maxDepth, maxItems, describeSpecial, seen);
            return sb.ToString();
        }

        private static void WriteValue(StringBuilder sb, object v, int depth, int maxItems,
            Func<object, IDictionary<string, object>> special, HashSet<object> seen)
        {
            if (v == null) { sb.Append("null"); return; }

            // プリミティブ系は depth/cycle 対象外
            switch (v)
            {
                case bool b: sb.Append(b ? "true" : "false"); return;
                case string s: WriteString(sb, s); return;
                case char c: WriteString(sb, c.ToString()); return;
                case Enum e: WriteString(sb, e.ToString()); return;
                case sbyte _: case byte _: case short _: case ushort _:
                case int _: case uint _: case long _: case ulong _:
                    sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture)); return;
                case float f: sb.Append(f.ToString("R", CultureInfo.InvariantCulture)); return;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); return;
                case decimal m: sb.Append(m.ToString(CultureInfo.InvariantCulture)); return;
            }

            // 特別扱い（Unity 型等）→ 辞書として書く
            var dict = special?.Invoke(v);
            if (dict != null) { WriteDict(sb, dict, depth, maxItems, special, seen); return; }

            if (!seen.Add(v)) { sb.Append("\"<cycle>\""); return; }
            try
            {
                if (depth <= 0) { sb.Append("\"<max-depth>\""); return; }

                if (v is IDictionary idict) { WriteIDictionary(sb, idict, depth, maxItems, special, seen); return; }
                if (v is IEnumerable en) { WriteEnumerable(sb, en, depth, maxItems, special, seen); return; }
                WriteObject(sb, v, depth, maxItems, special, seen);
            }
            finally { seen.Remove(v); }
        }

        private static void WriteDict(StringBuilder sb, IDictionary<string, object> dict, int depth, int maxItems,
            Func<object, IDictionary<string, object>> special, HashSet<object> seen)
        {
            sb.Append('{'); bool first = true;
            foreach (var kv in dict)
            {
                if (!first) sb.Append(','); first = false;
                WriteString(sb, kv.Key); sb.Append(':');
                WriteValue(sb, kv.Value, depth - 1, maxItems, special, seen);
            }
            sb.Append('}');
        }

        private static void WriteIDictionary(StringBuilder sb, IDictionary d, int depth, int maxItems,
            Func<object, IDictionary<string, object>> special, HashSet<object> seen)
        {
            sb.Append('{'); bool first = true; int n = 0;
            foreach (DictionaryEntry e in d)
            {
                if (n++ >= maxItems) { if (!first) sb.Append(','); sb.Append("\"…\":\"+").Append(CountRemaining(d, maxItems)).Append(" more\""); break; }
                if (!first) sb.Append(','); first = false;
                WriteString(sb, Convert.ToString(e.Key, CultureInfo.InvariantCulture)); sb.Append(':');
                WriteValue(sb, e.Value, depth - 1, maxItems, special, seen);
            }
            sb.Append('}');
        }

        private static void WriteEnumerable(StringBuilder sb, IEnumerable en, int depth, int maxItems,
            Func<object, IDictionary<string, object>> special, HashSet<object> seen)
        {
            sb.Append('['); bool first = true; int n = 0; int remaining = 0;
            foreach (var item in en)
            {
                if (n++ >= maxItems) { remaining++; continue; }
                if (!first) sb.Append(','); first = false;
                WriteValue(sb, item, depth - 1, maxItems, special, seen);
            }
            if (remaining > 0) { sb.Append(",\"+").Append(remaining).Append(" more\""); }
            sb.Append(']');
        }

        private static void WriteObject(StringBuilder sb, object v, int depth, int maxItems,
            Func<object, IDictionary<string, object>> special, HashSet<object> seen)
        {
            sb.Append('{');
            sb.Append("\"__type\":"); WriteString(sb, v.GetType().Name);
            var t = v.GetType();
            foreach (var p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (p.GetIndexParameters().Length > 0 || !p.CanRead) continue;
                object pv; try { pv = p.GetValue(v); } catch { pv = "<err>"; }
                sb.Append(','); WriteString(sb, p.Name); sb.Append(':');
                WriteValue(sb, pv, depth - 1, maxItems, special, seen);
            }
            foreach (var f in t.GetFields(BindingFlags.Public | BindingFlags.Instance))
            {
                object fv; try { fv = f.GetValue(v); } catch { fv = "<err>"; }
                sb.Append(','); WriteString(sb, f.Name); sb.Append(':');
                WriteValue(sb, fv, depth - 1, maxItems, special, seen);
            }
            sb.Append('}');
        }

        private static int CountRemaining(IDictionary d, int shown)
        {
            int total = d.Count; int r = total - shown; return r < 0 ? 0 : r;
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private sealed class ReferenceEqualityComparer : IEqualityComparer<object>
        {
            public static readonly ReferenceEqualityComparer Instance = new ReferenceEqualityComparer();
            public new bool Equals(object x, object y) => ReferenceEquals(x, y);
            public int GetHashCode(object obj) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(obj);
        }
    }
}
