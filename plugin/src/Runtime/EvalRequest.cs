using System;
using System.Threading;
using COM3D25.DevBridge.Eval;

namespace COM3D25.DevBridge.Runtime
{
    /// <summary>
    /// メインスレッドジョブ 1 件の受け渡し DTO。HTTP スレッドが enqueue し、メインスレッドが処理して Done を Set。
    /// Job 非 null なら eval でなく任意ジョブ（コルーチン継続する場合があるため Done の Set は Job 側の責務。
    /// 同期完了するジョブは Job 内で Result 代入 + Done.Set まで行う）。
    /// </summary>
    internal sealed class EvalRequest
    {
        public readonly string Code;
        public readonly bool IsReset;   // true = eval でなく評価器 reset 要求（Code 未使用）
        public readonly Action<MainThreadPump, EvalRequest> Job; // 非 null = 汎用メインスレッドジョブ
        public EvalResult Result;
        public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
        public EvalRequest(string code, bool isReset = false) { Code = code; IsReset = isReset; }
        public EvalRequest(Action<MainThreadPump, EvalRequest> job) { Job = job; }
    }
}
