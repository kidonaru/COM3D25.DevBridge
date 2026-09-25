using BepInEx;
#if BIE6
using BepInEx.Unity.Mono;
#endif
using BepInEx.Logging;
using UnityEngine;
using COM3D25.DevBridge.Http;
using COM3D25.DevBridge.Runtime;

namespace COM3D25.DevBridge
{
    /// <summary>
    /// COM3D25.DevBridge エントリ（dev 専用）。稼働中ゲームに localhost C# REPL を公開する。
    /// runner GO（DontDestroyOnLoad）に MainThreadPump を載せ、loopback HTTP サーバを起動する。
    /// </summary>
    [BepInPlugin(MyPluginInfo.PLUGIN_GUID, MyPluginInfo.PLUGIN_NAME, MyPluginInfo.PLUGIN_VERSION)]
    public class Plugin : BaseUnityPlugin
    {
        internal static ManualLogSource Log;
        private BridgeServer _server;

        // dev 専用のため固定既定ポート（ハードコード許容＝一時/dev ツール）。
        private const int Port = 18650;

        private void Awake()
        {
            Log = Logger;

            var go = new GameObject("COM3D25.DevBridge_Runtime");
            go.hideFlags = HideFlags.HideAndDontSave;
            DontDestroyOnLoad(go);
            var pump = go.AddComponent<MainThreadPump>();

            Capture.ImGuiWindowRegistry.Install(); // /capture target=imgui: 用の IMGUI ウィンドウ追跡
            _server = new BridgeServer(Port, pump, Paths.GameRootPath);
            _server.Start();
            Log.LogInfo($"COM3D25.DevBridge listening on http://127.0.0.1:{Port}/ (/ping, /eval, /reset, /capture, /imgui_windows, /dump, /watch, /profile)");
        }

        private void OnDestroy()
        {
            _server?.Stop();
            Capture.ImGuiWindowRegistry.Uninstall();
        }
    }
}
