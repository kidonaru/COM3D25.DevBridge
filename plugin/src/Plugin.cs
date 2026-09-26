using System.Net.Sockets;
using BepInEx;
using BepInEx.Configuration;
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

        // 既定ポート。IANA 未割り当て範囲（24555〜24576）から選んだ。衝突時は cfg で変えられる
        private const int DefaultPort = 24574;

        private void Awake()
        {
            Log = Logger;

            var go = new GameObject("COM3D25.DevBridge_Runtime");
            go.hideFlags = HideFlags.HideAndDontSave;
            DontDestroyOnLoad(go);
            var pump = go.AddComponent<MainThreadPump>();

            var port = Config.Bind("Server", "Port", DefaultPort,
                new ConfigDescription(
                    "ブリッジが 127.0.0.1 で待ち受けるポート。変えたら MCP サーバー側の BRIDGE_URL も合わせる",
                    new AcceptableValueRange<int>(1024, 65535))).Value;

            Capture.ImGuiWindowRegistry.Install(); // /capture target=imgui: 用の IMGUI ウィンドウ追跡
            _server = new BridgeServer(port, pump, Paths.GameRootPath);
            try
            {
                _server.Start();
            }
            catch (SocketException ex)
            {
                // ポート衝突でプラグインごと落とさず、変更方法をログで案内する
                _server = null;
                Log.LogError(BindFailureMessage.Build(port, ex.SocketErrorCode, Config.ConfigFilePath));
                return;
            }
            Log.LogInfo($"COM3D25.DevBridge listening on http://127.0.0.1:{port}/ (/ping, /eval, /reset, /capture, /imgui_windows, /dump, /watch, /profile)");
        }

        private void OnDestroy()
        {
            _server?.Stop();
            Capture.ImGuiWindowRegistry.Uninstall();
        }
    }
}
