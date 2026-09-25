using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using COM3D25.DevBridge.Eval;
using Xunit;

// 注意（net9 ⇄ 実機 Mono の前提差）: 本テストは net9 ランタイム上で走る
// （corlib=System.Private.CoreLib、facade=System.Runtime）。実機は Unity Mono
// （corlib=mscorlib、facade=netstandard/System.Runtime）。テストが担保するのは
// 判定ロジックの net9 上での正しさのみで、実機 Mono での等価性は実機バッテリー
// （除外集合照合）で担保する。Mono の GetType("System.Object") forwarder follow
// 挙動自体は 2026-06-06 spike の保有者列挙で実機検証済み。
public class ReferencePolicyTests
{
    private static readonly Assembly Corlib = typeof(object).Assembly;

    [Fact]
    public void Corlib自身は除外する()
    {
        // Evaluator が intrinsic に import 済みのため再参照すると CS0433 二重定義になる
        Assert.False(ReferencePolicy.ShouldReference(Corlib, Corlib));
    }

    [Fact]
    public void SystemObjectをforwardするfacadeは除外する()
    {
        // net9 ランタイムでは System.Runtime が S.P.CoreLib への pure forwarder facade
        // （ゲーム実機の netstandard / System.Runtime と同じ構造）
        var facade = Assembly.Load("System.Runtime");
        Assert.False(ReferencePolicy.ShouldReference(facade, Corlib));
    }

    [Fact]
    public void 通常のアセンブリは参照する()
    {
        // テストアセンブリ自身 = System.Object を定義も forward もしない通常アセンブリ
        var normal = typeof(ReferencePolicyTests).Assembly;
        Assert.True(ReferencePolicy.ShouldReference(normal, Corlib));
    }

    [Fact]
    public void 動的アセンブリは除外する()
    {
        // REPL の eval-N 等。IsDynamic は ShouldReference 内で判定する
        var dyn = System.Reflection.Emit.AssemblyBuilder.DefineDynamicAssembly(
            new AssemblyName("ReferencePolicyTests.Dynamic"),
            System.Reflection.Emit.AssemblyBuilderAccess.Run);
        Assert.False(ReferencePolicy.ShouldReference(dyn, Corlib));
    }

    [Fact]
    public void Filterは個別のShouldReferenceを尊重する()
    {
        // corlib + System.Runtime facade + 通常 assembly を渡し、通常 assembly だけが残ることを確認。
        var facade = Assembly.Load("System.Runtime");
        var normal = typeof(ReferencePolicyTests).Assembly;
        var input = new[] { Corlib, facade, normal };
        var result = ReferencePolicy.Filter(input, Corlib).ToArray();
        Assert.Single(result);
        Assert.Same(normal, result[0]);
    }

    [Fact]
    public void Filterは同名assemblyを最初の1個だけ採用する()
    {
        // 同じ assembly インスタンスを 2 回渡すケース（AssemblyName.Name が一致する典型）。
        // 実機では UnityEngine.CoreModule.dll が複数パスからロードされる状況の代用検証。
        var normal = typeof(ReferencePolicyTests).Assembly;
        var input = new[] { normal, normal };
        var result = ReferencePolicy.Filter(input, Corlib).ToArray();
        Assert.Single(result);
    }

    [Fact]
    public void Filterはnullや空入力を安全に処理する()
    {
        Assert.Empty(ReferencePolicy.Filter(null, Corlib));
        Assert.Empty(ReferencePolicy.Filter(new Assembly[0], Corlib));
        // null 要素を含む配列も skip するだけで例外を投げない。
        Assert.Empty(ReferencePolicy.Filter(new Assembly[] { null }, Corlib));
    }
}
