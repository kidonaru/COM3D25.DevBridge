using System;
using System.Collections.Generic;
using System.Reflection;

namespace COM3D25.DevBridge.Eval
{
    /// <summary>
    /// Evaluator に ReferenceAssembly すべきアセンブリかの判定（CS0433 根治の核、2026-06-06 spike で実証）。
    /// 除外対象:
    /// (1) corlib 本体 — Evaluator が intrinsic に import 済みのため、再参照すると全 BCL 型が二重定義になる
    /// (2) System.Object を type forward する pure facade（netstandard / System.Runtime 等）—
    ///     forwarder が「定義」として import され重複源になる
    /// (3) 動的アセンブリ（REPL の eval-N 等）
    /// (4) AssemblyName.Name が重複する assembly の 2 個目以降（<see cref="Filter"/> で適用）。
    ///     UnityEngine.CoreModule.dll が AppDomain に複数パスからロードされているケース等で
    ///     `UnityEngine.MeshRenderer` 等の Unity 型が CS0433 二重定義になるのを防ぐ。
    /// </summary>
    internal static class ReferencePolicy
    {
        internal static bool ShouldReference(Assembly asm, Assembly corlib)
        {
            if (asm.IsDynamic || asm == corlib) return false;
            Type forwarded;
            // facade は GetType が forwarder を follow して非 null を返す（定義元は corlib 側になる）。
            // System.Object を sentinel として facade を代表検出する（全 forwarder の網羅判定ではない）＝
            // System.Object を forward しない facade は素通りする。現実機の除外集合は
            // {mscorlib, netstandard, System.Runtime} と照合済（2026-06-06）。環境変更で CS0433 が再発したらここを疑う。
            // 設計判断: 判定不能（例外）時は「参照する」にフォールバック＝万一 facade で例外が出ると
            // CS0433 が再発しうるが、従来は facade も無条件参照していたので退行ではない。
            // 実機 Mono で例外が出ないことはデプロイ後の除外集合照合で確認する。
            try { forwarded = asm.GetType("System.Object", false); }
            catch { return true; } // 判定不能でも参照は試みる（従来の best effort を維持）
            // forwarded.Assembly == asm は「forward 先が自分自身＝定義元」（通常 corlib のみで上の除外済み。保険）
            return forwarded == null || forwarded.Assembly == asm;
        }

        /// <summary>
        /// 与えられた assemblies から Evaluator が参照すべき集合を抽出する pipeline。
        /// 1. 各 assembly を <see cref="ShouldReference"/> で個別判定（BCL facade / corlib / 動的を除外）。
        /// 2. AssemblyName.Name が重複する assembly は **最初の 1 個だけ** 採用。
        ///    例: UnityEngine.CoreModule.dll が AppDomain に複数パスからロードされていると、両方を
        ///    ReferenceAssembly すると `UnityEngine.MeshRenderer` 等が CS0433 で曖昧解決 fail する。
        ///    GetAssemblies の順は基本的に load 順なので、本体 Managed 配下が後から追加コピーされた版
        ///    （BepInEx plugins 下の Private=true コピー等）より先に出る前提（実害が出たら採用基準を変更する）。
        /// </summary>
        internal static IEnumerable<Assembly> Filter(IEnumerable<Assembly> assemblies, Assembly corlib)
        {
            if (assemblies == null) yield break;
            var seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var asm in assemblies)
            {
                if (asm == null) continue;
                if (!ShouldReference(asm, corlib)) continue;
                string name;
                try { name = asm.GetName().Name ?? asm.FullName ?? string.Empty; }
                catch { name = asm.FullName ?? string.Empty; }
                if (string.IsNullOrEmpty(name)) continue; // 名前不明＝重複検知不能なので安全側で skip
                if (!seenNames.Add(name)) continue;
                yield return asm;
            }
        }
    }
}
