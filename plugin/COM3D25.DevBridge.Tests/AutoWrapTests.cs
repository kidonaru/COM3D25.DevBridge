using COM3D25.DevBridge.Eval;
using Xunit;

public class AutoWrapTests
{
    [Fact]
    public void forOnceでラップする()
    {
        Assert.Equal(
            "for (int __autoWrap = 0; __autoWrap < 1; __autoWrap++) { Debug.Log(\"a\"); Debug.Log(\"b\"); }",
            AutoWrap.Wrap("Debug.Log(\"a\"); Debug.Log(\"b\");"));
    }

    [Fact]
    public void 末尾セミコロン無しは補完する()
    {
        // "文1; 文2"（末尾 ; 欠け）をそのままブロックに入れると CS1002 になるため補完する
        Assert.Equal(
            "for (int __autoWrap = 0; __autoWrap < 1; __autoWrap++) { int a = 1; int b = 2; }",
            AutoWrap.Wrap("int a = 1; int b = 2"));
    }

    [Fact]
    public void 波括弧終端にはセミコロンを補完しない()
    {
        // ブロック文終端（if/for 等）は ; 不要。一方 "new[]{1,2}" のような } 終端**式**は
        // 補完されず inner compile が CS0201 で落ちる → 元エラーへフォールバック（既知の限界・設計どおり）
        Assert.Equal(
            "for (int __autoWrap = 0; __autoWrap < 1; __autoWrap++) { if (true) { Debug.Log(\"x\"); } }",
            AutoWrap.Wrap("if (true) { Debug.Log(\"x\"); }"));
    }
}
