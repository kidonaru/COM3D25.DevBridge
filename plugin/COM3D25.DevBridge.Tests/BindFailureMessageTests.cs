using System.Net.Sockets;
using COM3D25.DevBridge.Http;
using Xunit;

namespace COM3D25.DevBridge.Tests
{
    public class BindFailureMessageTests
    {
        private const string Cfg = @"C:\Game\BepInEx\config\COM3D25.DevBridge.cfg";

        [Fact]
        public void 使用中なら別プロセスとの衝突を案内する()
        {
            var msg = BindFailureMessage.Build(24574, SocketError.AddressAlreadyInUse, Cfg);
            Assert.Contains("24574", msg);
            Assert.Contains("使用中", msg);
            Assert.Contains(Cfg, msg);
            Assert.Contains("BRIDGE_URL", msg);
        }

        [Fact]
        public void アクセス拒否なら予約範囲の確認方法を案内する()
        {
            var msg = BindFailureMessage.Build(24574, SocketError.AccessDenied, Cfg);
            Assert.Contains("excludedportrange", msg);
            Assert.Contains(Cfg, msg);
            Assert.Contains("BRIDGE_URL", msg);
        }

        [Fact]
        public void その他のエラーはエラー種別を含める()
        {
            var msg = BindFailureMessage.Build(24574, SocketError.NetworkDown, Cfg);
            Assert.Contains("NetworkDown", msg);
            Assert.Contains(Cfg, msg);
        }
    }
}
