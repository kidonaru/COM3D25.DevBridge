using System;
using System.Collections.Generic;
using System.Globalization;

namespace COM3D25.DevBridge.Profile
{
    /// <summary>Event.current.type 別の累計（呼び出し数と所要 ms）。</summary>
    public sealed class EventTypeStat
    {
        public long Calls;
        public double Ms;
    }

    /// <summary>プロファイル 1 件の状態。registry 経由でのみ触る（メインスレッド専有）。</summary>
    public sealed class ProfileEntry
    {
        public int Id;
        public string Name;                  // "Type:Method" のスペック文字列
        public int PatchedMethodCount;       // パッチしたオーバーロード数（MethodProfiler が設定）
        public int FramesRemaining;
        public bool Done;
        public string Error;

        // 集計値（Tick で確定）
        public int FramesObserved;
        public long TotalCalls;
        public double TotalMs;
        public double MaxFrameMs;
        public int MaxCallsPerFrame;
        public long TotalAllocBytes;
        public readonly Dictionary<string, EventTypeStat> EventTypes = new Dictionary<string, EventTypeStat>();
        public readonly List<string> FrameRows = new List<string>();

        // フレーム内アキュムレータ（RecordSample が積み、Tick が畳む）
        internal int CallsThisFrame;
        internal double MsThisFrame;
        internal long AllocThisFrame;
    }

    /// <summary>
    /// プロファイル群の台帳（Unity/Harmony 非依存・純粋ロジック）。メインスレッド専有前提で lock しない。
    /// 自動 cleanup 規約は WatchRegistry と同じ: frames 消化 / 行上限 / パッチ内例外 → Done。
    /// パッチ解除は呼び出し側（MethodProfiler）の責務で、Tick の戻り値（Done 遷移 id）が解除タイミングを伝える。
    /// </summary>
    public sealed class ProfileRegistry
    {
        public const int MaxProfiles = 8;      // 同時プロファイル数（パッチ暴走ガード）
        public const int MaxFrameRows = 10000; // 1 件のフレーム行上限
        private const int MaxFrames = 36000;   // 72Hz ≒ 8 分強

        private readonly Dictionary<int, ProfileEntry> _entries = new Dictionary<int, ProfileEntry>();
        private readonly List<int> _order = new List<int>();
        // Tick の外で Done になった id（MarkError 経由）。次の Tick で呼び出し側へ解除させる
        private readonly List<int> _pendingDone = new List<int>();
        private int _nextId = 1;

        public int ActiveCount => _entries.Count;

        public static int ClampFrames(int frames)
        {
            if (frames < 1) return 1;
            if (frames > MaxFrames) return MaxFrames;
            return frames;
        }

        /// <summary>登録して正の id を返す。同時数上限超えは -1。</summary>
        public int Create(string name, int frames)
        {
            if (_entries.Count >= MaxProfiles) return -1;
            var e = new ProfileEntry
            {
                Id = _nextId++,
                Name = name,
                FramesRemaining = ClampFrames(frames),
            };
            _entries[e.Id] = e;
            _order.Add(e.Id);
            return e.Id;
        }

        /// <summary>Harmony finalizer から 1 呼び出しぶんのサンプルを積む。Done 済みは無視。</summary>
        public void RecordSample(int id, double ms, long allocBytes, string eventType)
        {
            if (!_entries.TryGetValue(id, out var e) || e.Done) return;
            e.CallsThisFrame++;
            e.MsThisFrame += ms;
            if (allocBytes > 0) e.AllocThisFrame += allocBytes; // GC 発生時の負値はノイズとして捨てる
            if (!e.EventTypes.TryGetValue(eventType, out var stat))
                e.EventTypes[eventType] = stat = new EventTypeStat();
            stat.Calls++;
            stat.Ms += ms;
        }

        /// <summary>毎フレーム呼ぶ。フレーム内アキュムレータを集計へ畳み、Done に遷移した id 一覧を返す。</summary>
        public List<int> Tick(int frameCount)
        {
            var newlyDone = new List<int>();
            if (_pendingDone.Count > 0)
            {
                newlyDone.AddRange(_pendingDone); // MarkError で停止したぶんもここで解除させる
                _pendingDone.Clear();
            }
            foreach (int id in _order)
            {
                if (!_entries.TryGetValue(id, out var e) || e.Done) continue;

                e.FramesObserved++;
                if (e.CallsThisFrame > 0)
                {
                    e.TotalCalls += e.CallsThisFrame;
                    e.TotalMs += e.MsThisFrame;
                    e.TotalAllocBytes += e.AllocThisFrame;
                    if (e.MsThisFrame > e.MaxFrameMs) e.MaxFrameMs = e.MsThisFrame;
                    if (e.CallsThisFrame > e.MaxCallsPerFrame) e.MaxCallsPerFrame = e.CallsThisFrame;
                    e.FrameRows.Add("f" + frameCount +
                        ":calls=" + e.CallsThisFrame +
                        " ms=" + e.MsThisFrame.ToString("0.000", CultureInfo.InvariantCulture) +
                        " alloc=" + e.AllocThisFrame);
                    e.CallsThisFrame = 0;
                    e.MsThisFrame = 0;
                    e.AllocThisFrame = 0;
                    if (e.FrameRows.Count >= MaxFrameRows)
                    {
                        e.Error = "フレーム行が上限 " + MaxFrameRows + " 行に達したため打ち切り";
                        e.Done = true;
                        newlyDone.Add(id);
                        continue;
                    }
                }

                if (--e.FramesRemaining <= 0)
                {
                    e.Done = true;
                    newlyDone.Add(id);
                }
            }
            return newlyDone;
        }

        /// <summary>取得のみ（削除しない）。無ければ null。削除は MethodProfiler がパッチ解除とセットで行う。</summary>
        public ProfileEntry TryRead(int id)
        {
            _entries.TryGetValue(id, out var e);
            return e;
        }

        /// <summary>パッチ内例外などでエラー停止させる。パッチ解除は次の Tick が呼び出し側へ伝える。</summary>
        public void MarkError(int id, string error)
        {
            if (!_entries.TryGetValue(id, out var e) || e.Done) return;
            e.Error = error;
            e.Done = true;
            _pendingDone.Add(id);
        }

        public bool Remove(int id)
        {
            if (!_entries.ContainsKey(id)) return false;
            _entries.Remove(id);
            _order.Remove(id);
            _pendingDone.Remove(id);
            return true;
        }

        public void Clear()
        {
            _entries.Clear();
            _order.Clear();
            _pendingDone.Clear();
        }
    }
}
