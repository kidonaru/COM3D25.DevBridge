namespace COM3D25.DevBridge.Eval
{
    /// <summary>eval 1 件の結果。HTTP 応答 JSON（または Binary 非 null ならバイナリ直返し）の素になる。</summary>
    public sealed class EvalResult
    {
        public bool Ok;
        public object Value;     // 成功時の戻り値（ResultSerializer で JSON 化）
        public string Error;     // 実行時例外
        public string Report;    // mcs コンパイル時メッセージ
        public long ElapsedMs;
        public byte[] Binary;            // 非 null なら JSON でなく生バイト直返し（/capture の PNG 等）
        public string BinaryContentType; // Binary 用 Content-Type（例 image/png）
    }
}
