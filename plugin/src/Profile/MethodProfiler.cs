using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using HarmonyLib;

namespace COM3D25.DevBridge.Profile
{
    /// <summary>
    /// Harmony でメソッドを Prefix/Finalizer パッチし、実行コストを ProfileRegistry へ記録する。
    /// DevBridge で唯一ゲームの実行を書き換える層のため、パッチ解除の全経路
    /// （Done 遷移 / Remove / Clear(reset・OnDestroy)）をこのクラスに集約する。
    /// </summary>
    public sealed class MethodProfiler
    {
        /// <summary>パッチ済みメソッド 1 件の実行時状態（メインスレッド専有前提）。</summary>
        private sealed class PatchState
        {
            public int ProfileId;
            public int Depth;                 // 再帰の最外周判定
            public long StartTicks;
            public long StartAllocBytes;
            // 呼び出しごとに Stopwatch を new しない（高頻度メソッドでの GC 負荷回避）。ElapsedTicks の差分で経過時間を出す
            public readonly Stopwatch Watch = Stopwatch.StartNew();
        }

        // Harmony の static パッチから entry を引くための台帳。インスタンスは実質シングルトン
        // （MainThreadPump が 1 個だけ生成）だが、static 経由の結合を明示するため分離しておく。
        // ConcurrentDictionary: ワーカースレッドから対象メソッドが呼ばれても内部構造破損を起こさないため
        // （計測値の正確性はメインスレッド実行のみ保証）。
        private static readonly ConcurrentDictionary<MethodBase, PatchState> _states = new ConcurrentDictionary<MethodBase, PatchState>();
        private static ProfileRegistry _registryForPatch;

        private readonly ProfileRegistry _registry;
        private readonly Harmony _harmony = new Harmony("com3d25.devbridge.profiler");
        // id → パッチ済みメソッド一覧（解除用）
        private readonly Dictionary<int, List<MethodBase>> _patched = new Dictionary<int, List<MethodBase>>();
        // 解除に失敗して物理的にパッチが残っているメソッド。Clear で再試行する
        private readonly List<MethodBase> _leaked = new List<MethodBase>();

        public MethodProfiler(ProfileRegistry registry)
        {
            _registry = registry;
            _registryForPatch = registry;
        }

        /// <summary>
        /// spec を解決してパッチを当て、プロファイルを開始する。成功なら null、失敗ならエラーメッセージ。
        /// 同名オーバーロードは全件まとめて 1 エントリで計測する（patchedCount に件数が入る）。
        /// </summary>
        public string Add(string specText, int frames, out int id, out int patchedCount)
        {
            id = -1;
            patchedCount = 0;
            if (!ProfileTargetSpec.TryParse(specText, out var spec))
                return "指定が不正です。\"Full.Type.Name:MethodName\" 形式で指定してください（ネスト型は + 区切り）";

            var type = ResolveType(spec.TypeName, out string typeError);
            if (type == null) return typeError;

            // 指定型に宣言が無ければ基底クラスを順に遡る（基底で定義され override されていないメソッド対応）。
            // 最初に見つかった宣言階層のオーバーロード群だけを対象にする。
            var methods = new List<MethodBase>();
            for (var t = type; t != null && methods.Count == 0; t = t.BaseType)
            {
                foreach (var m in t.GetMethods(BindingFlags.Instance | BindingFlags.Static |
                                               BindingFlags.Public | BindingFlags.NonPublic |
                                               BindingFlags.DeclaredOnly))
                {
                    if (m.Name != spec.MethodName) continue;
                    if (m.IsGenericMethodDefinition || m.IsAbstract) continue; // Harmony で直接パッチ不能
                    methods.Add(m);
                }
            }
            if (methods.Count == 0)
                return "メソッドが見つかりません: " + spec.TypeName + ":" + spec.MethodName;

            foreach (var m in methods)
                if (_states.ContainsKey(m))
                    return "既に別のプロファイルがパッチ中です: " + spec.MethodName;

            id = _registry.Create(specText, frames);
            if (id < 0)
                return "プロファイル同時数が上限 " + ProfileRegistry.MaxProfiles + " です（read/remove で解放してください）";

            var prefix = new HarmonyMethod(typeof(MethodProfiler), nameof(ProfilePrefix));
            var finalizer = new HarmonyMethod(typeof(MethodProfiler), nameof(ProfileFinalizer));
            var done = new List<MethodBase>();
            foreach (var m in methods)
            {
                try
                {
                    // 後始末は Postfix ではなく Finalizer（理由は ProfileFinalizer の doc 参照）
                    _harmony.Patch(m, prefix: prefix, finalizer: finalizer);
                }
                catch (Exception ex)
                {
                    // 途中失敗は当てたぶんを巻き戻して全体を失敗させる（半端なパッチを残さない）
                    foreach (var d in done) ReleaseMethod(d);
                    _registry.Remove(id);
                    id = -1;
                    return "Harmony パッチに失敗しました: " + ex.Message;
                }
                _states[m] = new PatchState { ProfileId = id };
                done.Add(m);
            }
            _patched[id] = done;
            _registry.TryRead(id).PatchedMethodCount = done.Count;
            patchedCount = done.Count;
            return null;
        }

        /// <summary>毎フレーム呼ぶ。集計を畳み、Done に遷移したプロファイルのパッチを即時解除する。</summary>
        public void Tick(int frameCount)
        {
            var newlyDone = _registry.Tick(frameCount);
            for (int i = 0; i < newlyDone.Count; i++)
                UnpatchOnly(newlyDone[i]); // entry は read まで残す（結果閲覧用）
        }

        /// <summary>取得。Done ならパッチ解除＋registry からも削除したうえで entry を返す（watch と同じ自動解除規約）。</summary>
        public ProfileEntry ReadAndAutoRemove(int id)
        {
            var e = _registry.TryRead(id);
            if (e == null) return null;
            if (e.Done)
            {
                UnpatchOnly(id); // Tick 側で解除済みなら no-op
                _registry.Remove(id);
            }
            return e;
        }

        public bool Remove(int id)
        {
            UnpatchOnly(id);
            return _registry.Remove(id);
        }

        /// <summary>全パッチ解除＋台帳全消し（/reset・プラグイン破棄時）。解除失敗ぶんもここで再試行する。</summary>
        public void Clear()
        {
            foreach (var kv in _patched)
                foreach (var m in kv.Value)
                    ReleaseMethod(m);
            _patched.Clear();
            // 過去に解除できなかったぶんを再試行（ReleaseMethod が _leaked を変更するのでコピーを回す）
            foreach (var m in _leaked.ToArray())
                ReleaseMethod(m);
            _registry.Clear();
        }

        private void UnpatchOnly(int id)
        {
            if (!_patched.TryGetValue(id, out var methods)) return;
            foreach (var m in methods)
                ReleaseMethod(m);
            _patched.Remove(id);
        }

        /// <summary>
        /// パッチを解除して台帳から外す。解除に失敗したメソッドは _states に残したまま _leaked へ退避する
        /// （_states から消すと、パッチが物理的に残っているのに二重パッチ検知をすり抜け、
        /// 以後どの経路でも解除を再試行できなくなるため）。
        /// </summary>
        private void ReleaseMethod(MethodBase m)
        {
            if (TryUnpatch(m))
            {
                _states.TryRemove(m, out _);
                _leaked.Remove(m);
            }
            else if (!_leaked.Contains(m))
            {
                _leaked.Add(m);
            }
        }

        private bool TryUnpatch(MethodBase m)
        {
            try
            {
                _harmony.Unpatch(m, HarmonyPatchType.All, _harmony.Id);
                return true;
            }
            catch (Exception ex)
            {
                Plugin.Log?.LogWarning("プロファイラのパッチ解除に失敗（次の解除機会に再試行します）: " + m.Name + " (" + ex.Message + ")");
                return false;
            }
        }

        /// <summary>全ロード済みアセンブリから型を解決する。曖昧なら候補付きエラー。</summary>
        private static Type ResolveType(string typeName, out string error)
        {
            error = null;
            var found = new List<Type>();
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type t;
                try { t = asm.GetType(typeName, throwOnError: false); }
                catch { continue; } // ReflectionTypeLoadException 等は候補なしとして続行
                if (t != null) found.Add(t);
            }
            if (found.Count == 0)
            {
                error = "型が見つかりません: " + typeName + "（名前空間込みの完全名で指定してください）";
                return null;
            }
            if (found.Count > 1)
            {
                var names = new List<string>();
                foreach (var t in found) names.Add(t.Assembly.GetName().Name);
                error = "型が複数のアセンブリに存在します: " + string.Join(", ", names.ToArray());
                return null;
            }
            return found[0];
        }

        // ---- Harmony パッチ本体（static 必須） ----

        private static void ProfilePrefix(MethodBase __originalMethod)
        {
            PatchState s = null;
            try
            {
                if (!_states.TryGetValue(__originalMethod, out s)) return;
                if (s.Depth++ > 0) return; // 再帰の内側は時間を積まない（最外周のみ計測）
                s.StartTicks = s.Watch.ElapsedTicks;
                s.StartAllocBytes = GC.GetTotalMemory(false);
            }
            catch (Exception ex) { MarkPatchError(s, ex); } // ゲームへは伝播させず profile 側を停止させる
        }

        /// <summary>
        /// パッチ内で起きた想定外の例外を profile のエラーとして記録し、計測を停止させる
        /// （黙って握り潰すとサンプルだけが欠落した不正確な集計値をユーザーへ返してしまう）。
        /// </summary>
        private static void MarkPatchError(PatchState s, Exception ex)
        {
            try
            {
                if (s != null) _registryForPatch?.MarkError(s.ProfileId, "プロファイラのパッチ内で例外: " + ex.Message);
            }
            catch { /* 通知自体の失敗は無視（ゲームへ伝播させない） */ }
        }

        /// <summary>
        /// Finalizer: 対象メソッドが例外を投げても必ず実行される（Postfix だと例外時に Depth が
        /// 食い違い、以後の全呼び出しが再帰の内側と誤判定されて計測不能になる）。
        /// __exception はそのまま return してゲームへ再伝播させる（null を返すと握り潰してしまう）。
        /// </summary>
        private static Exception ProfileFinalizer(MethodBase __originalMethod, Exception __exception)
        {
            PatchState s = null;
            try
            {
                if (!_states.TryGetValue(__originalMethod, out s)) return __exception;
                if (--s.Depth > 0) return __exception;
                if (s.Depth < 0) { s.Depth = 0; return __exception; } // prefix 前にパッチされた等の不整合ガード
                double ms = (s.Watch.ElapsedTicks - s.StartTicks) * 1000.0 / Stopwatch.Frequency;
                long alloc = GC.GetTotalMemory(false) - s.StartAllocBytes;
                string ev = "None";
                var cur = UnityEngine.Event.current; // OnGUI 外では null
                if (cur != null) ev = cur.type.ToString();
                _registryForPatch?.RecordSample(s.ProfileId, ms, alloc, ev);
            }
            catch (Exception ex) { MarkPatchError(s, ex); } // ゲームへは伝播させず profile 側を停止させる
            return __exception;
        }
    }
}
