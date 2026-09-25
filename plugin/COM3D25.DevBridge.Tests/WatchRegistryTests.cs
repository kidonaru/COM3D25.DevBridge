using System;
using COM3D25.DevBridge.Watch;
using Xunit;

public class WatchRegistryTests
{
    [Fact]
    public void logモードは毎フレーム記録しframes消化でdoneになる()
    {
        var reg = new WatchRegistry();
        int n = 0;
        int id = reg.Create(() => n++, frames: 3, diff: false);
        reg.Tick(100); reg.Tick(101); reg.Tick(102);
        var e = reg.TryRead(id, removeIfDone: false);
        Assert.True(e.Done);
        Assert.Equal(new[] { "f100:0", "f101:1", "f102:2" }, e.Results.ToArray());
        reg.Tick(103); // done 後は記録されない
        Assert.Equal(3, e.Results.Count);
    }

    [Fact]
    public void diffモードは変化したフレームのみ記録する()
    {
        var reg = new WatchRegistry();
        int[] seq = { 5, 5, 7, 7, 5 };
        int i = 0;
        int id = reg.Create(() => seq[i++], frames: 5, diff: true);
        for (int f = 0; f < 5; f++) reg.Tick(f);
        var e = reg.TryRead(id, removeIfDone: false);
        Assert.Equal(new[] { "f0:5", "f2:7", "f4:5" }, e.Results.ToArray());
    }

    [Fact]
    public void doneをreadすると自動解除される()
    {
        var reg = new WatchRegistry();
        int id = reg.Create(() => 1, frames: 1, diff: false);
        reg.Tick(0);
        Assert.NotNull(reg.TryRead(id, removeIfDone: true));  // done を返しつつ解除
        Assert.Null(reg.TryRead(id, removeIfDone: true));     // 2 回目は消えている
    }

    [Fact]
    public void 進行中のreadは解除しない()
    {
        var reg = new WatchRegistry();
        int id = reg.Create(() => 1, frames: 10, diff: false);
        reg.Tick(0);
        Assert.NotNull(reg.TryRead(id, removeIfDone: true)); // 未完了 → 解除されない
        Assert.NotNull(reg.TryRead(id, removeIfDone: true));
    }

    [Fact]
    public void sampler例外はerrorを記録してdoneにする()
    {
        var reg = new WatchRegistry();
        int id = reg.Create(() => throw new InvalidOperationException("boom"), frames: 100, diff: false);
        reg.Tick(0);
        var e = reg.TryRead(id, removeIfDone: false);
        Assert.True(e.Done);
        Assert.Contains("boom", e.Error);
        reg.Tick(1); // 以降サンプルされない（例外スパム防止）
        Assert.Empty(e.Results);
    }

    [Fact]
    public void Removeで解除Clearで全解除()
    {
        var reg = new WatchRegistry();
        int a = reg.Create(() => 1, frames: 10, diff: false);
        int b = reg.Create(() => 2, frames: 10, diff: false);
        Assert.True(reg.Remove(a));
        Assert.False(reg.Remove(a));      // 二重解除は false
        Assert.Equal(1, reg.ActiveCount);
        reg.Clear();
        Assert.Equal(0, reg.ActiveCount);
        Assert.Null(reg.TryRead(b, removeIfDone: false));
    }

    [Fact]
    public void framesと同時数はクランプされる()
    {
        var reg = new WatchRegistry();
        int id = reg.Create(() => 1, frames: 0, diff: false);          // 下限 1
        var e = reg.TryRead(id, removeIfDone: false);
        Assert.Equal(1, e.FramesRemaining);
        Assert.Equal(36000, WatchRegistry.ClampFrames(999999));         // 上限 36000
        for (int i = 0; i < WatchRegistry.MaxWatches + 5; i++) reg.Create(() => 1, 10, false);
        Assert.Equal(WatchRegistry.MaxWatches, reg.ActiveCount);        // 上限超過分は登録されない
    }

    [Fact]
    public void 同時数上限を超えるCreateは負のidを返す()
    {
        var reg = new WatchRegistry();
        for (int i = 0; i < WatchRegistry.MaxWatches; i++)
            Assert.True(reg.Create(() => 1, 10, false) > 0);
        Assert.True(reg.Create(() => 1, 10, false) < 0); // 上限超え
    }

    [Fact]
    public void 結果上限で打ち切りdoneになる()
    {
        var reg = new WatchRegistry();
        int id = reg.Create(() => 1, frames: WatchRegistry.MaxResults + 100, diff: false);
        for (int f = 0; f <= WatchRegistry.MaxResults; f++) reg.Tick(f);
        var e = reg.TryRead(id, removeIfDone: false);
        Assert.True(e.Done);
        Assert.Equal(WatchRegistry.MaxResults, e.Results.Count);
        Assert.Contains("上限", e.Error);
    }

    [Fact]
    public void null値はnull表記で記録される()
    {
        var reg = new WatchRegistry();
        int id = reg.Create(() => null, frames: 1, diff: false);
        reg.Tick(0);
        Assert.Equal(new[] { "f0:<null>" }, reg.TryRead(id, removeIfDone: false).Results.ToArray());
    }
}
