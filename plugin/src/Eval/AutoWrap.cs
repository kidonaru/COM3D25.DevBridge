namespace COM3D25.DevBridge.Eval
{
    /// <summary>
    /// 複数文入力の for-once ラップ（純関数）。「未消費の入力が残りました」になる複数文を
    /// 1 文に畳んで透過再試行するための文字列変換。
    /// 制約: ブロック内に入るため top-level 変数宣言は永続しない（report で明示する）。
    /// 末尾が式の入力（"1+1; 2+2" 等）はブロック内で CS0201 になり再試行も失敗する → 元エラーへフォールバック。
    /// </summary>
    public static class AutoWrap
    {
        public const string ReportMarker =
            "[auto-wrapped] 複数文を for-once ラップで実行しました。top-level 変数宣言は永続しません（永続値は単文で宣言してください）。";

        public static string Wrap(string code)
        {
            string body = code.TrimEnd();
            if (!body.EndsWith(";") && !body.EndsWith("}")) body += ";";
            return "for (int __autoWrap = 0; __autoWrap < 1; __autoWrap++) { " + body + " }";
        }
    }
}
