using COM3D25.DevBridge.Capture;
using Xunit;

public class CaptureTargetSpecTests
{
    [Fact]
    public void screenをパースできる()
    {
        Assert.True(CaptureTargetSpec.TryParse("screen", out var s));
        Assert.Equal(CaptureTargetKind.Screen, s.Kind);
    }

    [Fact]
    public void rt名前指定をパースできる()
    {
        Assert.True(CaptureTargetSpec.TryParse("rt:WorldUiRT", out var s));
        Assert.Equal(CaptureTargetKind.RtByName, s.Kind);
        Assert.Equal("WorldUiRT", s.Name);
    }

    [Fact]
    public void rtサイズ指定をパースできる()
    {
        Assert.True(CaptureTargetSpec.TryParse("rt:2232x2408", out var s));
        Assert.Equal(CaptureTargetKind.RtBySize, s.Kind);
        Assert.Equal(2232, s.Width);
        Assert.Equal(2408, s.Height);
    }

    [Fact]
    public void camera指定をパースできる()
    {
        Assert.True(CaptureTargetSpec.TryParse("camera:Main Camera", out var s));
        Assert.Equal(CaptureTargetKind.Camera, s.Kind);
        Assert.Equal("Main Camera", s.Name);
    }

    [Fact]
    public void imgui指定をパースできる()
    {
        Assert.True(CaptureTargetSpec.TryParse("imgui:Mod Item Explorer", out var s));
        Assert.Equal(CaptureTargetKind.ImGuiWindow, s.Kind);
        Assert.Equal("Mod Item Explorer", s.Name);
    }

    [Fact]
    public void 不正入力はfalse()
    {
        Assert.False(CaptureTargetSpec.TryParse(null, out _));
        Assert.False(CaptureTargetSpec.TryParse("", out _));
        Assert.False(CaptureTargetSpec.TryParse("rt:", out _));
        Assert.False(CaptureTargetSpec.TryParse("camera:", out _));
        Assert.False(CaptureTargetSpec.TryParse("imgui:", out _));
        Assert.False(CaptureTargetSpec.TryParse("unknown:x", out _));
    }

    [Fact]
    public void rectをパースできる()
    {
        Assert.True(CaptureRect.TryParse("10, 20,300,400", out var r));
        Assert.Equal(10, r.X);
        Assert.Equal(20, r.Y);
        Assert.Equal(300, r.Width);
        Assert.Equal(400, r.Height);
    }

    [Fact]
    public void rectの不正入力はfalse()
    {
        Assert.False(CaptureRect.TryParse(null, out _));
        Assert.False(CaptureRect.TryParse("", out _));
        Assert.False(CaptureRect.TryParse("1,2,3", out _));       // 要素数不足
        Assert.False(CaptureRect.TryParse("1,2,3,4,5", out _));   // 要素数過多
        Assert.False(CaptureRect.TryParse("a,2,3,4", out _));     // 数値でない
        Assert.False(CaptureRect.TryParse("-1,0,10,10", out _));  // 負の原点
        Assert.False(CaptureRect.TryParse("0,0,0,10", out _));    // 幅 0
    }

    [Fact]
    public void rectは画像範囲にクランプされる()
    {
        var r = new CaptureRect { X = 100, Y = 50, Width = 500, Height = 500 };
        Assert.True(r.TryClamp(300, 200, out var c));
        Assert.Equal(100, c.X);
        Assert.Equal(50, c.Y);
        Assert.Equal(200, c.Width);
        Assert.Equal(150, c.Height);
    }

    [Fact]
    public void rectが完全に範囲外ならfalse()
    {
        var r = new CaptureRect { X = 300, Y = 0, Width = 10, Height = 10 };
        Assert.False(r.TryClamp(300, 200, out _));
    }

    [Fact]
    public void downscaleはクランプされる()
    {
        Assert.Equal(0, CaptureTargetSpec.ParseDownscale(null));     // 無指定 = 縮小なし
        Assert.Equal(0, CaptureTargetSpec.ParseDownscale("abc"));    // 不正 = 縮小なし
        Assert.Equal(512, CaptureTargetSpec.ParseDownscale("512"));
        Assert.Equal(16, CaptureTargetSpec.ParseDownscale("1"));     // 下限 16
        Assert.Equal(4096, CaptureTargetSpec.ParseDownscale("99999")); // 上限 4096
    }
}
