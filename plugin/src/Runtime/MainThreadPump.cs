using System;
using System.Collections.Concurrent;
using COM3D25.DevBridge.Eval;
using COM3D25.DevBridge.Profile;
using COM3D25.DevBridge.Watch;
using UnityEngine;

namespace COM3D25.DevBridge.Runtime
{
    /// <summary>
    /// メインスレッドで eval を実行する pump。HTTP スレッドが Enqueue した EvalRequest を
    /// Update() で frame budget 内に処理する（Unity API はメインスレッド限定）。
    /// </summary>
    public sealed class MainThreadPump : MonoBehaviour
    {
        private readonly ConcurrentQueue<EvalRequest> _queue = new ConcurrentQueue<EvalRequest>();
        private CsharpEvaluator _evaluator;

        public DateTime LastTickUtc { get; private set; } = DateTime.UtcNow;

        private const int MaxPerFrame = 4; // 1 フレームで処理する最大件数（stall 回避）

        internal WatchRegistry Watches => _watches;
        private readonly WatchRegistry _watches = new WatchRegistry();

        internal MethodProfiler Profiler => _profiler;
        private MethodProfiler _profiler;

        private void Awake()
        {
            // 初回 eval のレイテンシを避けるため起動時に評価器を用意。
            _evaluator = new CsharpEvaluator();
            _profiler = new MethodProfiler(new ProfileRegistry());
            // watch は常時 1 本だけ購読（個別購読を排除＝解除漏れの構造的防止。entries 空なら実質 no-op）
            Application.onBeforeRender += OnBeforeRenderTick;
        }

        private void OnDestroy()
        {
            Application.onBeforeRender -= OnBeforeRenderTick;
            _profiler?.Clear(); // プラグイン破棄時にパッチを残さない（最重要の安全要件）
        }

        private void OnBeforeRenderTick()
        {
            _watches.Tick(Time.frameCount);
            _profiler.Tick(Time.frameCount);
        }

        internal EvalRequest Enqueue(string code)
        {
            var req = new EvalRequest(code);
            _queue.Enqueue(req);
            return req;
        }

        // 評価器 reset 要求を enqueue（破損からの手動 escape hatch）。eval と同じ queue で直列化。
        internal EvalRequest EnqueueReset()
        {
            var req = new EvalRequest(null, isReset: true);
            _queue.Enqueue(req);
            return req;
        }

        // 汎用メインスレッドジョブを enqueue（/capture・/watch 系で使用）。
        // Job は Result 代入 + Done.Set まで自前で行う（コルーチン継続可）。
        internal EvalRequest EnqueueJob(Action<MainThreadPump, EvalRequest> job)
        {
            var req = new EvalRequest(job);
            _queue.Enqueue(req);
            return req;
        }

        internal CsharpEvaluator Evaluator => _evaluator;

        private void Update()
        {
            LastTickUtc = DateTime.UtcNow;
            int processed = 0;
            while (processed < MaxPerFrame && _queue.TryDequeue(out var req))
            {
                processed++;
                try
                {
                    if (req.Job != null)
                    {
                        req.Job(this, req); // Done の Set は Job 側責務（コルーチン継続があるため）
                    }
                    else if (req.IsReset)
                    {
                        _watches.Clear(); // 評価器作り直しで compiled delegate が無効になるため全 watch 解除
                        _profiler.Clear(); // reset でパッチも全解除（迷子パッチ防止）
                        _evaluator.Reset();
                        req.Result = new EvalResult { Ok = true, Value = "evaluator reset" };
                        req.Done.Set();
                    }
                    else
                    {
                        req.Result = _evaluator.Eval(req.Code);
                        req.Done.Set();
                    }
                }
                catch (Exception ex)
                {
                    // catch 節でも必ず非 null を代入してから Done.Set（Route 側 ToJson の null 参照回避）。
                    // finally での無条件 Set はしない（Job のコルーチン継続中に先に Set してしまうため）。
                    req.Result = new EvalResult { Ok = false, Error = "pump: " + ex.Message };
                    req.Done.Set();
                }
            }
        }
    }
}
