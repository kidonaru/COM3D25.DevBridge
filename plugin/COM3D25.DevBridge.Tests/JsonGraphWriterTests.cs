using System.Collections.Generic;
using COM3D25.DevBridge.Serialize;
using Xunit;

namespace COM3D25.DevBridge.Tests
{
    public class JsonGraphWriterTests
    {
        [Fact]
        public void プリミティブと文字列をエスケープして出力する()
        {
            Assert.Equal("42", JsonGraphWriter.Write(42, 3, 100, null));
            Assert.Equal("true", JsonGraphWriter.Write(true, 3, 100, null));
            Assert.Equal("null", JsonGraphWriter.Write(null, 3, 100, null));
            Assert.Equal("\"a\\\"b\\n\"", JsonGraphWriter.Write("a\"b\n", 3, 100, null));
        }

        [Fact]
        public void コレクションは件数上限で打ち切る()
        {
            var list = new List<int> { 1, 2, 3 };
            string json = JsonGraphWriter.Write(list, 3, 2, null);
            Assert.Contains("1", json);
            Assert.Contains("2", json);
            Assert.Contains("+1 more", json);
            Assert.DoesNotContain("3,", json);
        }

        [Fact]
        public void depthを超えたら省略マーカーを出す()
        {
            var nested = new Dictionary<string, object>
            {
                ["a"] = new Dictionary<string, object> { ["b"] = new Dictionary<string, object> { ["c"] = 1 } }
            };
            string json = JsonGraphWriter.Write(nested, 1, 100, null);
            Assert.Contains("\"a\"", json);
            Assert.Contains("<max-depth>", json);
        }

        [Fact]
        public void 循環参照を検出して無限ループしない()
        {
            var a = new Dictionary<string, object>();
            a["self"] = a;
            string json = JsonGraphWriter.Write(a, 5, 100, null);
            Assert.Contains("<cycle>", json);
        }

        [Fact]
        public void describeSpecialが非nullを返す型はその辞書で表現する()
        {
            var marker = new object();
            System.Func<object, IDictionary<string, object>> special =
                o => ReferenceEquals(o, marker) ? new Dictionary<string, object> { ["__type"] = "Marker" } : null;
            string json = JsonGraphWriter.Write(marker, 3, 100, special);
            Assert.Contains("\"__type\"", json);
            Assert.Contains("\"Marker\"", json);
        }
    }
}
