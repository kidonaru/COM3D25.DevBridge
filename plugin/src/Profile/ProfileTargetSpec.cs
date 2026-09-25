using System;

namespace COM3D25.DevBridge.Profile
{
    /// <summary>
    /// プロファイル対象の指定 "Full.Type.Name:MethodName" のパース結果（純粋ロジック・Unity 非依存）。
    /// 型解決は実行時（MethodProfiler 側）で行い、ここは書式検証のみ担当する。
    /// </summary>
    public sealed class ProfileTargetSpec
    {
        public string TypeName { get; private set; }
        public string MethodName { get; private set; }

        public static bool TryParse(string input, out ProfileTargetSpec spec)
        {
            spec = null;
            if (string.IsNullOrWhiteSpace(input)) return false;
            string s = input.Trim();
            var parts = s.Split(':');
            if (parts.Length != 2) return false;
            string type = parts[0].Trim();
            string method = parts[1].Trim();
            if (type.Length == 0 || method.Length == 0) return false;
            // メソッド名は識別子相当のみ許容（空白等の混入を弾く）
            foreach (char c in method)
                if (!char.IsLetterOrDigit(c) && c != '_') return false;
            spec = new ProfileTargetSpec { TypeName = type, MethodName = method };
            return true;
        }
    }
}
