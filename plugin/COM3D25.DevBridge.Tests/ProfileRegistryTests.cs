using COM3D25.DevBridge.Profile;
using Xunit;

public class ProfileRegistryTests
{
    [Fact]
    public void Create_上限まで登録でき_超過はマイナス1()
    {
        var r = new ProfileRegistry();
        for (int i = 0; i < ProfileRegistry.MaxProfiles; i++)
            Assert.True(r.Create("t:m", 10) > 0);
        Assert.Equal(-1, r.Create("t:m", 10));
    }

    [Fact]
    public void RecordSampleとTickで集計される()
    {
        var r = new ProfileRegistry();
        int id = r.Create("t:m", 2);
        r.RecordSample(id, 1.5, 100, "Repaint");
        r.RecordSample(id, 0.5, 50, "Layout");
        var done1 = r.Tick(100);
        Assert.Empty(done1);

        var e = r.TryRead(id);
        Assert.Equal(1, e.FramesObserved);
        Assert.Equal(2, e.TotalCalls);
        Assert.Equal(2.0, e.TotalMs, 3);
        Assert.Equal(2.0, e.MaxFrameMs, 3);
        Assert.Equal(2, e.MaxCallsPerFrame);
        Assert.Equal(150, e.TotalAllocBytes);
        Assert.Equal(1, e.EventTypes["Repaint"].Calls);
        Assert.Equal(0.5, e.EventTypes["Layout"].Ms, 3);
        Assert.Single(e.FrameRows); // 呼び出しの無いフレームは行を作らない
        Assert.StartsWith("f100:", e.FrameRows[0]);

        // 2 フレーム目消化で Done に遷移し、Tick が id を返す
        var done2 = r.Tick(101);
        Assert.Contains(id, done2);
        Assert.True(r.TryRead(id).Done);
    }

    [Fact]
    public void 呼び出しゼロのフレームは行を作らないが集計フレーム数には数える()
    {
        var r = new ProfileRegistry();
        int id = r.Create("t:m", 5);
        r.Tick(1);
        r.Tick(2);
        var e = r.TryRead(id);
        Assert.Equal(2, e.FramesObserved);
        Assert.Empty(e.FrameRows);
        Assert.Equal(0, e.TotalCalls);
    }

    [Fact]
    public void MarkErrorで停止する()
    {
        var r = new ProfileRegistry();
        int id = r.Create("t:m", 100);
        r.MarkError(id, "patch 内例外");
        var e = r.TryRead(id);
        Assert.True(e.Done);
        Assert.Equal("patch 内例外", e.Error);
        // Done 後の RecordSample / Tick は無視される
        r.RecordSample(id, 1, 1, "None");
        r.Tick(1);
        Assert.Equal(0, r.TryRead(id).TotalCalls);
    }

    [Fact]
    public void MarkErrorした_idは次のTickで解除対象として返る()
    {
        var r = new ProfileRegistry();
        int id = r.Create("t:m", 100);
        r.MarkError(id, "patch 内例外");
        // Done 済みでも呼び出し側にパッチ解除させる必要がある（迷子パッチ防止）
        Assert.Contains(id, r.Tick(1));
        Assert.Empty(r.Tick(2)); // 2 回目は返らない
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(1, 1)]
    [InlineData(36000, 36000)]
    [InlineData(36001, 36000)]
    public void ClampFramesは範囲外を丸める(int input, int expected)
    {
        Assert.Equal(expected, ProfileRegistry.ClampFrames(input));
    }

    [Fact]
    public void RemoveとClear()
    {
        var r = new ProfileRegistry();
        int id = r.Create("t:m", 10);
        Assert.True(r.Remove(id));
        Assert.False(r.Remove(id));
        Assert.Null(r.TryRead(id));
        r.Create("t:m", 10);
        r.Clear();
        Assert.Equal(0, r.ActiveCount);
    }

    [Fact]
    public void FrameRows上限で打ち切りDoneになる()
    {
        var r = new ProfileRegistry();
        int id = r.Create("t:m", ProfileRegistry.ClampFrames(int.MaxValue));
        for (int f = 0; f < ProfileRegistry.MaxFrameRows; f++)
        {
            r.RecordSample(id, 0.1, 0, "None");
            r.Tick(f);
        }
        var e = r.TryRead(id);
        Assert.True(e.Done);
        Assert.NotNull(e.Error);
    }
}
