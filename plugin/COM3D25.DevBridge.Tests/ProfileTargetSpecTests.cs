using COM3D25.DevBridge.Profile;
using Xunit;

public class ProfileTargetSpecTests
{
    [Theory]
    [InlineData("COM3D2.SceneEditor.Plugin.HierarchyWindow:DrawContent",
                "COM3D2.SceneEditor.Plugin.HierarchyWindow", "DrawContent")]
    [InlineData("Maid:SetProp", "Maid", "SetProp")]
    [InlineData("Outer+Nested:Run", "Outer+Nested", "Run")] // ネスト型は + 区切り
    [InlineData("  Maid:SetProp  ", "Maid", "SetProp")]     // 前後空白は許容
    public void TryParse_正常系(string input, string type, string method)
    {
        Assert.True(ProfileTargetSpec.TryParse(input, out var spec));
        Assert.Equal(type, spec.TypeName);
        Assert.Equal(method, spec.MethodName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("NoSeparator")]
    [InlineData(":MethodOnly")]
    [InlineData("TypeOnly:")]
    [InlineData("A:B:C")]          // 区切りが 2 個
    [InlineData("Type:Meth od")]   // メソッド名に空白
    public void TryParse_異常系(string input)
    {
        Assert.False(ProfileTargetSpec.TryParse(input, out _));
    }
}
