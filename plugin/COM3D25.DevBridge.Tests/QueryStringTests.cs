using COM3D25.DevBridge.Http;
using Xunit;

public class QueryStringTests
{
    [Fact]
    public void パラメータを取得できる()
    {
        Assert.Equal("screen", QueryString.GetParam("target=screen&downscale=512", "target"));
        Assert.Equal("512", QueryString.GetParam("target=screen&downscale=512", "downscale"));
    }

    [Fact]
    public void 無いパラメータはnull()
    {
        Assert.Null(QueryString.GetParam("target=screen", "missing"));
        Assert.Null(QueryString.GetParam("", "target"));
        Assert.Null(QueryString.GetParam(null, "target"));
    }

    [Fact]
    public void パーセントデコードとプラスを処理する()
    {
        // RT/カメラ名に空白・日本語が入るケース（curl --get --data-urlencode 相当）
        Assert.Equal("Main Camera", QueryString.GetParam("target=Main%20Camera", "target"));
        Assert.Equal("Main Camera", QueryString.GetParam("target=Main+Camera", "target"));
        Assert.Equal("カメラ", QueryString.GetParam("name=%E3%82%AB%E3%83%A1%E3%83%A9", "name"));
    }

    [Fact]
    public void 値に等号を含められる()
    {
        Assert.Equal("a=b", QueryString.GetParam("x=a=b", "x"));
    }

    [Fact]
    public void ParsedRequestがQueryを保持する()
    {
        Assert.True(HttpRequestParser.TryParse("GET /capture?target=screen HTTP/1.1\r\n\r\n", out var req));
        Assert.Equal("/capture", req.Path);
        Assert.Equal("target=screen", req.Query);
    }

    [Fact]
    public void クエリ無しはQueryが空文字()
    {
        Assert.True(HttpRequestParser.TryParse("GET /ping HTTP/1.1\r\n\r\n", out var req));
        Assert.Equal("", req.Query);
    }
}
