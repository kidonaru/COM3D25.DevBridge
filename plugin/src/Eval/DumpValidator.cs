namespace COM3D25.DevBridge.Eval
{
    /// <summary>
    /// /dump?var= の検証（純関数）。単純識別子のみ許可する。
    /// 任意式を許すと /dump が第 2 の /eval になるだけなので、意味論を「REPL 変数の取り出し」に限定する。
    /// </summary>
    public static class DumpValidator
    {
        public static bool IsSimpleIdentifier(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            for (int i = 0; i < name.Length; i++)
            {
                char c = name[i];
                bool ok = c == '_'
                    || (c >= 'a' && c <= 'z')
                    || (c >= 'A' && c <= 'Z')
                    || (i > 0 && c >= '0' && c <= '9');
                if (!ok) return false;
            }
            return true;
        }
    }
}
