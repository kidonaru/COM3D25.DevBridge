using COM3D25.DevBridge.Eval;
using Xunit;

public class DumpValidatorTests
{
    [Theory]
    [InlineData("__bytes", true)]
    [InlineData("x", true)]
    [InlineData("_a1", true)]
    [InlineData("Ab_9", true)]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("1x", false)]          // 数字始まり
    [InlineData("a.b", false)]         // メンバアクセス（式）は不可
    [InlineData("a()", false)]         // 呼び出しは不可
    [InlineData("a b", false)]
    public void 単純識別子のみ許可する(string name, bool expected)
    {
        Assert.Equal(expected, DumpValidator.IsSimpleIdentifier(name));
    }
}
