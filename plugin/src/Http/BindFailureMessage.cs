using System.Net.Sockets;

namespace COM3D25.DevBridge.Http
{
    /// <summary>待受ポートを確保できなかったときにログへ出す案内文を作る。</summary>
    public static class BindFailureMessage
    {
        public static string Build(int port, SocketError error, string configPath)
        {
            string cause;
            switch (error)
            {
                case SocketError.AddressAlreadyInUse:
                    cause = $"ポート {port} は別のプロセスが使用中です（ゲームの二重起動や他のツール）。";
                    break;
                case SocketError.AccessDenied:
                    // Hyper-V / WSL2 / Docker が起動時にポートをまとめて予約すると bind が拒否される
                    cause = $"ポート {port} は OS に予約されています。" +
                            "予約範囲は netsh int ipv4 show excludedportrange protocol=tcp で確認できます。";
                    break;
                default:
                    cause = $"ポート {port} で待ち受けできませんでした（{error}）。";
                    break;
            }
            return "COM3D25.DevBridge を起動できません。" + cause +
                   $"\n{configPath} の [Server] Port を別の値に変え、ゲームを再起動してください。" +
                   "\nMCP サーバー側は環境変数 BRIDGE_URL を http://127.0.0.1:<新しいポート> に合わせてください。";
        }
    }
}
