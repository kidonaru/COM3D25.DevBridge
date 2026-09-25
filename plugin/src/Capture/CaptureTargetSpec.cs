using System.Globalization;

namespace COM3D25.DevBridge.Capture
{
    internal enum CaptureTargetKind { Screen, RtByName, RtBySize, Camera, ImGuiWindow }

    /// <summary>/capture の target= 指定のパース（純関数）。Unity 非依存。</summary>
    internal struct CaptureTargetSpec
    {
        public CaptureTargetKind Kind;
        public string Name;
        public int Width;
        public int Height;

        /// <summary>"screen" / "rt:&lt;name&gt;" / "rt:&lt;W&gt;x&lt;H&gt;" / "camera:&lt;name&gt;" / "imgui:&lt;title&gt;" をパース。</summary>
        public static bool TryParse(string target, out CaptureTargetSpec spec)
        {
            spec = default;
            if (string.IsNullOrEmpty(target)) return false;
            if (target == "screen") { spec.Kind = CaptureTargetKind.Screen; return true; }
            if (target.StartsWith("rt:"))
            {
                string rest = target.Substring(3);
                if (rest.Length == 0) return false;
                // "WxH"（数値x数値）なら size 指定、それ以外は名前指定。
                // 注: "123x456" という名前の RT は size 解釈が優先される（dev 割切り）
                int x = rest.IndexOf('x');
                if (x > 0
                    && int.TryParse(rest.Substring(0, x), NumberStyles.Integer, CultureInfo.InvariantCulture, out int w)
                    && int.TryParse(rest.Substring(x + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out int h)
                    && w > 0 && h > 0)
                {
                    spec.Kind = CaptureTargetKind.RtBySize;
                    spec.Width = w;
                    spec.Height = h;
                    return true;
                }
                spec.Kind = CaptureTargetKind.RtByName;
                spec.Name = rest;
                return true;
            }
            if (target.StartsWith("camera:"))
            {
                string rest = target.Substring(7);
                if (rest.Length == 0) return false;
                spec.Kind = CaptureTargetKind.Camera;
                spec.Name = rest;
                return true;
            }
            if (target.StartsWith("imgui:"))
            {
                string rest = target.Substring(6);
                if (rest.Length == 0) return false;
                spec.Kind = CaptureTargetKind.ImGuiWindow;
                spec.Name = rest;
                return true;
            }
            return false;
        }

        /// <summary>downscale=（長辺 px）。無指定/不正 = 0（縮小なし）。16..4096 にクランプ。</summary>
        public static int ParseDownscale(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return 0;
            if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out int v)) return 0;
            if (v < 16) return 16;
            if (v > 4096) return 4096;
            return v;
        }
    }

    /// <summary>rect=x,y,w,h（左上原点・px）のパースとクランプ。Unity 非依存。</summary>
    internal struct CaptureRect
    {
        public int X;
        public int Y;
        public int Width;
        public int Height;

        /// <summary>"x,y,w,h" をパース。x/y は 0 以上、w/h は 1 以上のみ受け付ける。</summary>
        public static bool TryParse(string raw, out CaptureRect rect)
        {
            rect = default;
            if (string.IsNullOrEmpty(raw)) return false;
            string[] parts = raw.Split(',');
            if (parts.Length != 4) return false;
            int[] v = new int[4];
            for (int i = 0; i < 4; i++)
                if (!int.TryParse(parts[i].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v[i])) return false;
            if (v[0] < 0 || v[1] < 0 || v[2] <= 0 || v[3] <= 0) return false;
            rect.X = v[0];
            rect.Y = v[1];
            rect.Width = v[2];
            rect.Height = v[3];
            return true;
        }

        /// <summary>矩形を [0,texWidth)×[0,texHeight) に収める。完全に外なら false。</summary>
        public bool TryClamp(int texWidth, int texHeight, out CaptureRect clamped)
        {
            clamped = default;
            int x0 = X < 0 ? 0 : X;
            int y0 = Y < 0 ? 0 : Y;
            int x1 = X + Width > texWidth ? texWidth : X + Width;
            int y1 = Y + Height > texHeight ? texHeight : Y + Height;
            if (x1 <= x0 || y1 <= y0) return false;
            clamped.X = x0;
            clamped.Y = y0;
            clamped.Width = x1 - x0;
            clamped.Height = y1 - y0;
            return true;
        }
    }
}
