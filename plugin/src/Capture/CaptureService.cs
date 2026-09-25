using System;
using System.Collections;
using COM3D25.DevBridge.Eval;
using COM3D25.DevBridge.Runtime;
using UnityEngine;

namespace COM3D25.DevBridge.Capture
{
    /// <summary>
    /// /capture の実体。メインスレッド（pump job）で開始し、WaitForEndOfFrame 後に
    /// ReadPixels → EncodeToPNG して EvalResult.Binary に詰める（spike 2026-06-06 で REPL 実証済みの手順）。
    /// 失敗しても必ず Result 非 null + Done.Set（pump 不変条件）。
    /// 注意: timeout 意味論が /eval と異なる — メインスレッド生存でも**レンダリングが止まっていると**
    /// WaitForEndOfFrame が再開せず 15s timeout になる（/ping の mainThreadAlive では検出できない固着）。
    /// </summary>
    internal static class CaptureService
    {
        /// <summary>pump job 入口。コルーチンを開始して end-of-frame まで Done を遅延する。</summary>
        /// <param name="rect">切り抜き矩形（左上原点・px）。null なら切り抜きなし。imgui: との同時指定は呼び出し元で拒否済み（imgui: はウィンドウ矩形で切り抜く）</param>
        public static void Start(MainThreadPump pump, EvalRequest req, CaptureTargetSpec spec, int downscale, CaptureRect? rect)
        {
            pump.StartCoroutine(CaptureAtEndOfFrame(req, spec, downscale, rect));
        }

        private static IEnumerator CaptureAtEndOfFrame(EvalRequest req, CaptureTargetSpec spec, int downscale, CaptureRect? rect)
        {
            // 画面/カメラの内容が確定する end-of-frame で読む（Update 中の ReadPixels は不定内容）
            yield return new WaitForEndOfFrame();
            try
            {
                req.Result = Capture(spec, downscale, rect);
            }
            catch (Exception ex)
            {
                req.Result = new EvalResult { Ok = false, Error = "capture: " + ex.GetType().Name + ": " + ex.Message };
            }
            finally
            {
                req.Done.Set();
            }
        }

        private static EvalResult Capture(CaptureTargetSpec spec, int downscale, CaptureRect? rect)
        {
            Texture2D tex = null;
            CaptureRect? cropRect = rect;
            try
            {
                switch (spec.Kind)
                {
                    case CaptureTargetKind.Screen:
                        tex = ScreenCapture.CaptureScreenshotAsTexture();
                        break;
                    case CaptureTargetKind.ImGuiWindow:
                        // IMGUI はカメラ描画に乗らないため画面全体を撮ってウィンドウ矩形で切り抜く
                        if (!ImGuiWindowRegistry.TryFind(spec.Name, out var win, out string winError))
                            return new EvalResult { Ok = false, Error = winError };
                        var r = win.ScreenRect;
                        cropRect = new CaptureRect
                        {
                            X = Mathf.FloorToInt(r.x),
                            Y = Mathf.FloorToInt(r.y),
                            Width = Mathf.CeilToInt(r.width),
                            Height = Mathf.CeilToInt(r.height),
                        };
                        tex = ScreenCapture.CaptureScreenshotAsTexture();
                        break;
                    case CaptureTargetKind.RtByName:
                    case CaptureTargetKind.RtBySize:
                        var rt = FindRenderTexture(spec, out string rtError);
                        if (rt == null) return new EvalResult { Ok = false, Error = rtError };
                        tex = ReadRenderTexture(rt);
                        break;
                    case CaptureTargetKind.Camera:
                        var cam = FindCamera(spec.Name);
                        if (cam == null) return new EvalResult { Ok = false, Error = "camera が見つかりません: " + spec.Name };
                        tex = RenderCameraToTexture(cam);
                        break;
                    default:
                        return new EvalResult { Ok = false, Error = "未対応の capture target" };
                }

                if (cropRect.HasValue)
                {
                    if (!cropRect.Value.TryClamp(tex.width, tex.height, out var clamped))
                        return new EvalResult { Ok = false, Error = $"rect が画像範囲外です（画像 {tex.width}x{tex.height}）" };
                    tex = Crop(tex, clamped);
                }
                if (downscale > 0) tex = Downscale(tex, downscale);
                byte[] png = ImageConversion.EncodeToPNG(tex);
                if (png == null || png.Length == 0)
                    return new EvalResult { Ok = false, Error = "PNG エンコードに失敗しました（フォーマット非対応の可能性）" };
                return new EvalResult { Ok = true, Binary = png, BinaryContentType = "image/png" };
            }
            finally
            {
                if (tex != null) UnityEngine.Object.Destroy(tex);
            }
        }

        private static RenderTexture FindRenderTexture(CaptureTargetSpec spec, out string error)
        {
            error = null;
            var all = Resources.FindObjectsOfTypeAll<RenderTexture>();
            RenderTexture found = null;
            int matches = 0;
            foreach (var rt in all)
            {
                bool hit = spec.Kind == CaptureTargetKind.RtByName
                    ? rt.name == spec.Name
                    : rt.width == spec.Width && rt.height == spec.Height;
                if (!hit) continue;
                matches++;
                if (found == null) found = rt;
            }
            if (found == null)
            {
                error = "RenderTexture が見つかりません: "
                    + (spec.Kind == CaptureTargetKind.RtByName ? spec.Name : spec.Width + "x" + spec.Height);
                return null;
            }
            if (matches > 1)
                // 同サイズ複数時の選択は非決定的（FindObjectsOfTypeAll の列挙順は無保証。
                // VR eye RT 等の同サイズ・同名ペアは rt:<name> でも絞れない＝どちらの眼かは運次第）
                Plugin.Log?.LogWarning($"COM3D25.DevBridge /capture: RT が {matches} 件一致。最初の 1 件を使用（name={found.name}）");
            return found;
        }

        private static Camera FindCamera(string name)
        {
            // disabled なカメラも拾うため FindObjectsOfTypeAll。
            // 注意: VR stereo 構成の eye カメラを単独 Render() すると例外/歪みが出るケースがある
            // （camera: 経路は非 VR カメラ前提。VR eye の中身は rt:<W>x<H> 直読みを使う）
            foreach (var cam in Resources.FindObjectsOfTypeAll<Camera>())
                if (cam.name == name) return cam;
            return null;
        }

        private static Texture2D ReadRenderTexture(RenderTexture rt)
        {
            var prev = RenderTexture.active;
            try
            {
                RenderTexture.active = rt;
                var tex = new Texture2D(rt.width, rt.height, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                tex.Apply();
                return tex;
            }
            finally { RenderTexture.active = prev; }
        }

        private static Texture2D RenderCameraToTexture(Camera cam)
        {
            var rt = RenderTexture.GetTemporary(Screen.width, Screen.height, 24);
            var prevTarget = cam.targetTexture;
            try
            {
                cam.targetTexture = rt;
                cam.Render();
                return ReadRenderTexture(rt);
            }
            finally
            {
                cam.targetTexture = prevTarget;
                RenderTexture.ReleaseTemporary(rt);
            }
        }

        /// <summary>左上原点の矩形で切り抜く。Texture2D は左下原点なので y を反転する。</summary>
        private static Texture2D Crop(Texture2D src, CaptureRect r)
        {
            int yBottom = src.height - (r.Y + r.Height);
            var pixels = src.GetPixels(r.X, yBottom, r.Width, r.Height);
            var dst = new Texture2D(r.Width, r.Height, TextureFormat.RGBA32, false);
            dst.SetPixels(pixels);
            dst.Apply();
            UnityEngine.Object.Destroy(src);
            return dst;
        }

        private static Texture2D Downscale(Texture2D src, int maxEdge)
        {
            int w = src.width, h = src.height;
            if (w <= maxEdge && h <= maxEdge) return src;
            float scale = (float)maxEdge / (w > h ? w : h);
            int nw = Mathf.Max(1, Mathf.RoundToInt(w * scale));
            int nh = Mathf.Max(1, Mathf.RoundToInt(h * scale));
            var rt = RenderTexture.GetTemporary(nw, nh);
            try
            {
                Graphics.Blit(src, rt); // bilinear 縮小
                UnityEngine.Object.Destroy(src);
                return ReadRenderTexture(rt);
            }
            finally { RenderTexture.ReleaseTemporary(rt); }
        }
    }
}
