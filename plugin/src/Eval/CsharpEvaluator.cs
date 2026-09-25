using System;
using System.Diagnostics;
using System.IO;
using Mono.CSharp;

namespace COM3D25.DevBridge.Eval
{
    /// <summary>
    /// Mono.CSharp.Evaluator のラップ。状態を持つ REPL（using / 変数が後続 eval に継続）。
    /// 初期化でロード済み全アセンブリを参照し、ゲーム型（Assembly-CSharp）と UnityEngine を解決可能にする。
    /// compile error が mcs 内部 builder を半生成のまま残し、後続 eval が
    /// "builder already exists"（InternalErrorException）で brick する事象に対し、
    /// その例外を検出したら評価器を作り直して 1 回だけ透過再試行する。
    /// </summary>
    public sealed class CsharpEvaluator
    {
        private Evaluator _eval;                          // 破損時に作り直すため非 readonly
        private readonly StreamReportPrinter _printer;    // ErrorsCount は printer 上の単調累積カウンタ（rebuild を跨いでも維持）
        private readonly StringWriter _report = new StringWriter();
        private readonly CompilerSettings _settings = new CompilerSettings();

        private const string Preamble =
            "using System; using System.IO; using System.Linq; using System.Collections.Generic; using UnityEngine;";

        public CsharpEvaluator()
        {
            _printer = new StreamReportPrinter(_report);
            Rebuild();
        }

        /// <summary>
        /// 評価器を新規生成し、アセンブリ参照 + preamble using を張り直す。
        /// 初期化・破損(InternalErrorException)からの復旧・明示 Reset で共用。
        /// printer は再利用する（ErrorsCount デルタ判定を維持）。
        /// CS0433 根治（2026-06-06 spike）: corlib は Evaluator が intrinsic に import 済みのため
        /// 再参照しない。LoadDefaultReferences も false（loader 経由の mscorlib 再 import を防ぐ。
        /// System / System.Core 等はロード済みアセンブリとして下のループで参照される）。
        /// </summary>
        private void Rebuild()
        {
            _settings.LoadDefaultReferences = false;
            var ctx = new CompilerContext(_settings, _printer);
            _eval = new Evaluator(ctx);

            // ロード済みアセンブリを参照（Assembly-CSharp / UnityEngine.* / BepInEx / 本 dll 等）。
            // corlib 本体・System.Object forwarder facade・同名 assembly の重複は ReferencePolicy.Filter が除外する。
            var corlib = typeof(object).Assembly;
            foreach (var asm in ReferencePolicy.Filter(AppDomain.CurrentDomain.GetAssemblies(), corlib))
            {
                try { _eval.ReferenceAssembly(asm); }
                catch { /* 参照不可なアセンブリは無視 */ }
            }

            // プリアンブル using。
            try { _eval.Run(Preamble); }
            catch { /* preamble 失敗は致命でない */ }

            // 初期化（ReferenceAssembly / using）で出た report を捨て、以降の eval report と混ぜない。
            _report.GetStringBuilder().Clear();
        }

        /// <summary>評価器を作り直す（/reset 用の手動 escape hatch）。REPL 蓄積状態(using/変数)は失われる。</summary>
        public void Reset()
        {
            Rebuild();
        }

        /// <summary>
        /// 単一の式 or 文を eval。式なら値を Value に、文なら Value=null。
        /// InternalErrorException（builder 破損）を検出したら評価器を作り直して 1 回だけ再試行する。
        /// Rebuild 自体が失敗しても必ず非 null の EvalResult を返す（不変条件）。
        /// </summary>
        public EvalResult Eval(string code)
        {
            var sw = Stopwatch.StartNew();
            EvalResult result;
            try
            {
                result = EvalCore(code, allowReset: true);
            }
            catch (Exception ex)
            {
                // EvalCore 内の Rebuild 失敗等。Eval は必ず非 null を返す不変条件を守る。
                result = new EvalResult { Ok = false, Error = "evaluator rebuild failed: " + ex.GetType().Name + ": " + ex.Message };
            }
            sw.Stop();
            result.ElapsedMs = sw.ElapsedMilliseconds;
            return result;
        }

        /// <summary>
        /// watch 用に式を 1 回 compile して毎フレーム invoke 可能な sampler を返す（③ /watch）。
        /// 単一式のみ（複数文・top-level 宣言は不可）。**括弧で括って compile することで式コンテキストを強制**する
        /// （実機検証 2026-06-06: Compile は Evaluate と違い文/複数文も remainder なしで通してしまうため、
        /// remainder では検出できない。"(int a = 1;)" は cm==null、"(複数文)" は cm==null かつ
        /// ErrorsCount 増加なし＝ **cm == null が正規の reject 判定**）。
        /// InternalErrorException での auto-reset は行わない（Rebuild すると既存 watch の delegate と
        /// REPL universe が分離して整合が崩れるため。brick したらユーザーが /reset → watch 全解除）。
        /// </summary>
        public EvalResult CompileForWatch(string expr, out Func<object> sampler)
        {
            sampler = null;
            var result = new EvalResult();
            _report.GetStringBuilder().Clear();
            int errorsBefore = _printer.ErrorsCount;
            try
            {
                CompiledMethod cm;
                _eval.Compile("(" + expr + ")", out cm); // 括弧強制＝式以外を compile 失敗に落とす
                if (cm == null || _printer.ErrorsCount > errorsBefore)
                {
                    result.Ok = false;
                    result.Error = "watch は単一式のみ対応です（式として compile できません。複数文・宣言は不可）";
                }
                else
                {
                    var compiled = cm;
                    sampler = () => { object v = null; compiled(ref v); return v; };
                    result.Ok = true;
                }
            }
            catch (Exception ex)
            {
                result.Ok = false;
                result.Error = ex.GetType().Name + ": " + ex.Message;
            }
            result.Report = _report.ToString();
            return result;
        }

        /// <summary>
        /// 1 回の eval 本体。allowReset=true のとき InternalErrorException で評価器を作り直し
        /// allowReset=false で 1 回だけ再試行する（再帰深度 1 で有界＝無限再帰しない）。
        /// allowWrap=true のとき複数文（remainder 非空）を for-once ラップで 1 回だけ透過再試行する
        /// （⑤ auto-wrap。allowWrap: false で深度 1 に有界）。
        /// 成否は Evaluator.Evaluate の result_set と printer の ErrorsCount デルタで判定する
        /// （Evaluate の戻り値は「未消費入力」であって文/式フラグではない点に注意）。
        /// </summary>
        private EvalResult EvalCore(string code, bool allowReset, bool allowWrap = true)
        {
            var result = new EvalResult();
            _report.GetStringBuilder().Clear();
            int errorsBefore = _printer.ErrorsCount;   // 毎回サンプル＝rebuild を跨いでもデルタが正しい
            try
            {
                object value;
                bool valueSet;
                // 戻り値 = 未消費の残り入力（null/空 = 全消費）。複数文/不完全入力だと非空で返る。
                string remainder = _eval.Evaluate(code, out value, out valueSet);

                if (!string.IsNullOrWhiteSpace(remainder))
                {
                    // 複数文/不完全入力。for-once ラップで 1 文化して 1 回だけ透過再試行する（⑤ auto-wrap）。
                    // ラップでも失敗する入力（末尾が式・不完全な構文等）は元のエラーをそのまま返す。
                    if (allowWrap)
                    {
                        var wrapped = EvalCore(AutoWrap.Wrap(code), allowReset, allowWrap: false);
                        if (wrapped.Ok)
                        {
                            wrapped.Report = AutoWrap.ReportMarker + " " + wrapped.Report;
                            return wrapped;
                        }
                    }
                    result.Ok = false;
                    result.Error = "未消費の入力が残りました（単一の式/文のみ対応。auto-wrap も失敗）: " + remainder.Trim();
                }
                else
                {
                    result.Ok = true;
                    result.Value = valueSet ? value : null; // result_set が値取得の正規判定（文は false）
                }
            }
            catch (InternalErrorException) when (allowReset)
            {
                // compile error 等が mcs 内部 builder を半生成のまま残し "builder already exists" で
                // 落ちる brick。評価器を作り直して 1 回だけ再試行する（蓄積 REPL 状態は失われる）。
                Rebuild();
                var retried = EvalCore(code, allowReset: false);
                retried.Report = "[evaluator auto-reset] " + retried.Report;
                // 再試行も失敗した場合は Error 側にも文脈を残す（ok:false だけ見る呼出元に伝わるように）。
                if (!retried.Ok)
                    retried.Error = "(auto-reset 後も失敗) " + retried.Error;
                return retried;
            }
            catch (Exception ex)
            {
                // 通常のユーザーコード実行時例外（NRE 等）。評価器は健全なので Rebuild しない。
                result.Ok = false;
                result.Error = ex.GetType().Name + ": " + ex.Message;
            }
            result.Report = _report.ToString();
            // コンパイルエラーは printer の ErrorsCount 増分で判定（脆い文字列マッチを使わない）。
            if (result.Ok && _printer.ErrorsCount > errorsBefore)
            {
                result.Ok = false;
                result.Error = "compile error";
            }
            return result;
        }
    }
}
