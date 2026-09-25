using COM3D25.DevBridge.Http;
using Xunit;

namespace COM3D25.DevBridge.Tests
{
    public class HttpRequestParserTests
    {
        [Fact]
        public void method_path_を取り出す()
        {
            var head = "POST /eval HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 5\r\n\r\n";
            Assert.True(HttpRequestParser.TryParse(head, out var req));
            Assert.Equal("POST", req.Method);
            Assert.Equal("/eval", req.Path);
            Assert.Equal(5, req.ContentLength);
        }

        [Fact]
        public void content_length_無しは0()
        {
            var head = "GET /ping HTTP/1.1\r\nHost: x\r\n\r\n";
            Assert.True(HttpRequestParser.TryParse(head, out var req));
            Assert.Equal("GET", req.Method);
            Assert.Equal("/ping", req.Path);
            Assert.Equal(0, req.ContentLength);
        }

        [Fact]
        public void クエリ文字列はパスから分離する()
        {
            var head = "GET /eval?x=1 HTTP/1.1\r\n\r\n";
            Assert.True(HttpRequestParser.TryParse(head, out var req));
            Assert.Equal("/eval", req.Path);
        }

        [Fact]
        public void 不正なrequest_lineはfalse()
        {
            Assert.False(HttpRequestParser.TryParse("garbage", out _));
        }
    }
}
