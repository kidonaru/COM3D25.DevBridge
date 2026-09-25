using System;
using System.Collections.Generic;

namespace COM3D25.DevBridge.Watch
{
    /// <summary>watch 1 件の状態。registry 経由でのみ触る（メインスレッド専有）。</summary>
    public sealed class WatchEntry
    {
        public int Id;
        public int FramesRemaining;
        public bool Diff;
        public bool Done;
        public string Error;                 // sampler 例外 / 結果上限で停止した理由
        public string LastValue;             // diff 用の直前値
        public readonly List<string> Results = new List<string>();
        public Func<object> Sampler;         // 実機では CompiledMethod のラップ。テストでは任意関数
    }

    /// <summary>
    /// watch 群の台帳（Unity 非依存・純粋ロジック）。メインスレッド専有を前提に lock しない
    /// （HTTP スレッドからは必ず pump job 経由で触る）。
    /// 自動 cleanup 規約（spec ③）: frames 消化 / 結果上限 / sampler 例外 → Done、
    /// Done を read で自動解除、DELETE/Clear(/reset) で即解除。
    /// </summary>
    public sealed class WatchRegistry
    {
        public const int MaxWatches = 16;     // 同時 watch 数（dev 用の暴走ガード）
        public const int MaxResults = 10000;  // 1 watch の蓄積行数上限
        private const int MaxFrames = 36000;  // 72Hz ≒ 8 分強

        private readonly Dictionary<int, WatchEntry> _entries = new Dictionary<int, WatchEntry>();
        private readonly List<int> _order = new List<int>(); // Tick の安定列挙用（Tick 中の追加/削除なし前提）
        private int _nextId = 1;

        public int ActiveCount => _entries.Count;

        public static int ClampFrames(int frames)
        {
            if (frames < 1) return 1;
            if (frames > MaxFrames) return MaxFrames;
            return frames;
        }

        /// <summary>登録して正の id を返す。同時数上限超えは -1。</summary>
        public int Create(Func<object> sampler, int frames, bool diff)
        {
            if (_entries.Count >= MaxWatches) return -1;
            var e = new WatchEntry
            {
                Id = _nextId++,
                FramesRemaining = ClampFrames(frames),
                Diff = diff,
                Sampler = sampler,
            };
            _entries[e.Id] = e;
            _order.Add(e.Id);
            return e.Id;
        }

        /// <summary>毎フレーム呼ぶ。frameCount はラベル用（Time.frameCount）。</summary>
        public void Tick(int frameCount)
        {
            foreach (int id in _order)
            {
                if (!_entries.TryGetValue(id, out var e) || e.Done) continue;
                string val;
                try
                {
                    object v = e.Sampler();
                    val = v == null ? "<null>" : v.ToString();
                }
                catch (Exception ex)
                {
                    e.Error = ex.GetType().Name + ": " + ex.Message;
                    e.Done = true; // 例外は 1 回で停止（毎フレームのエラースパム防止）
                    continue;
                }

                bool record = !e.Diff || e.LastValue != val;
                e.LastValue = val;
                if (record)
                {
                    e.Results.Add("f" + frameCount + ":" + val);
                    if (e.Results.Count >= MaxResults)
                    {
                        e.Error = "結果が上限 " + MaxResults + " 行に達したため打ち切り";
                        e.Done = true;
                        continue;
                    }
                }

                if (--e.FramesRemaining <= 0) e.Done = true;
            }
        }

        /// <summary>取得。removeIfDone=true かつ Done なら返却と同時に解除（spec の自動解除）。無ければ null。</summary>
        public WatchEntry TryRead(int id, bool removeIfDone)
        {
            if (!_entries.TryGetValue(id, out var e)) return null;
            if (removeIfDone && e.Done) RemoveInternal(id);
            return e;
        }

        public bool Remove(int id)
        {
            if (!_entries.ContainsKey(id)) return false;
            RemoveInternal(id);
            return true;
        }

        public void Clear()
        {
            _entries.Clear();
            _order.Clear();
        }

        private void RemoveInternal(int id)
        {
            _entries.Remove(id);
            _order.Remove(id);
        }
    }
}
