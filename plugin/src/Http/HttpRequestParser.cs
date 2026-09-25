using System;
using System.Globalization;

namespace COM3D25.DevBridge.Http
{
    /// <summary>HTTP リクエスト先頭（request-line + headers）の最小パーサ（純関数）。</summary>
    public struct ParsedRequest
    {
        public string Method;
        public string Path;
        public string Query;   // '?' より後（無ければ空文字）。デコードは QueryString.GetParam が行う
        public int ContentLength;
    }

    public static class HttpRequestParser
    {
        public static bool TryParse(string head, out ParsedRequest req)
        {
            req = default;
            if (string.IsNullOrEmpty(head)) return false;

            int firstLineEnd = head.IndexOf("\r\n", StringComparison.Ordinal);
            string requestLine = firstLineEnd < 0 ? head : head.Substring(0, firstLineEnd);
            string[] parts = requestLine.Split(' ');
            if (parts.Length < 3) return false; // METHOD PATH HTTP/x.y

            req.Method = parts[0];
            string path = parts[1];
            int q = path.IndexOf('?');
            req.Path = q >= 0 ? path.Substring(0, q) : path;
            req.Query = q >= 0 ? path.Substring(q + 1) : "";

            req.ContentLength = 0;
            foreach (var line in head.Split(new[] { "\r\n" }, StringSplitOptions.None))
            {
                int colon = line.IndexOf(':');
                if (colon <= 0) continue;
                string name = line.Substring(0, colon).Trim();
                if (string.Equals(name, "Content-Length", StringComparison.OrdinalIgnoreCase))
                {
                    string val = line.Substring(colon + 1).Trim();
                    int.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out req.ContentLength);
                }
            }
            return true;
        }
    }

    /// <summary>クエリ文字列の最小パース（純関数）。'&amp;' 区切り・最初の '=' で分割・%XX と '+' をデコード。</summary>
    public static class QueryString
    {
        /// <summary>name の値を返す（無ければ null）。値はパーセントデコード済み。</summary>
        public static string GetParam(string query, string name)
        {
            if (string.IsNullOrEmpty(query) || string.IsNullOrEmpty(name)) return null;
            foreach (var pair in query.Split('&'))
            {
                int eq = pair.IndexOf('=');
                if (eq <= 0) continue;
                if (pair.Substring(0, eq) != name) continue;
                return Decode(pair.Substring(eq + 1));
            }
            return null;
        }

        private static string Decode(string s)
        {
            // '+' → 空白、%XX → バイト列として収集し UTF-8 復元（日本語名対応）
            var bytes = new System.Collections.Generic.List<byte>(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '+') { bytes.Add((byte)' '); continue; }
                if (c == '%' && i + 2 < s.Length
                    && TryHex(s[i + 1], out int hi) && TryHex(s[i + 2], out int lo))
                {
                    bytes.Add((byte)((hi << 4) | lo));
                    i += 2;
                    continue;
                }
                // 非 ASCII がそのまま来た場合も UTF-8 でバイト化して合流
                var raw = System.Text.Encoding.UTF8.GetBytes(c.ToString());
                bytes.AddRange(raw);
            }
            return System.Text.Encoding.UTF8.GetString(bytes.ToArray());
        }

        private static bool TryHex(char c, out int v)
        {
            if (c >= '0' && c <= '9') { v = c - '0'; return true; }
            if (c >= 'a' && c <= 'f') { v = c - 'a' + 10; return true; }
            if (c >= 'A' && c <= 'F') { v = c - 'A' + 10; return true; }
            v = 0;
            return false;
        }
    }
}
