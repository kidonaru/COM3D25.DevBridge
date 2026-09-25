using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using COM3D25.DevBridge.Eval;
using COM3D25.DevBridge.Runtime;
using COM3D25.DevBridge.Serialize;

namespace COM3D25.DevBridge.Http
{
    /// <summary>
    /// loopback 限定の最小 HTTP サーバ。接続を 1 本ずつ捌き、/ping・/eval を処理する。
    /// /eval は MainThreadPump へ委譲しメインスレッド実行を待つ（timeout 付き）。
    /// </summary>
    public sealed class BridgeServer
    {
        private readonly int _port;
        private readonly MainThreadPump _pump;
        private readonly string _gameDir;
        private TcpListener _listener;
        private Thread _thread;
        private volatile bool _running;

        private const int EvalTimeoutMs = 15000;

        public BridgeServer(int port, MainThreadPump pump, string gameDir)
        {
            _port = port;
            _pump = pump;
            _gameDir = gameDir ?? "";
        }

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Loopback, _port); // 127.0.0.1 限定（LAN 露出しない）
            _listener.Start();
            _running = true;
            _thread = new Thread(AcceptLoop) { IsBackground = true, Name = "COM3D25.DevBridge" };
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            try { _listener?.Stop(); } catch { }
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                TcpClient client = null;
                try
                {
                    client = _listener.AcceptTcpClient();
                    HandleClient(client);
                }
                catch (Exception ex)
                {
                    if (_running) Plugin.Log?.LogWarning("COM3D25.DevBridge accept 例外: " + ex.Message);
                }
                finally { try { client?.Close(); } catch { } }
            }
        }

        private void HandleClient(TcpClient client)
        {
            using (var stream = client.GetStream())
            {
                // 不完全リクエストで listener スレッドが無限ブロックしないよう read timeout を設定。
                stream.ReadTimeout = 5000;
                const int MaxHeaderBytes = 16384; // ヘッダ肥大の打ち切り（DoS/暴走防止）

                // ヘッダ終端（\r\n\r\n）まで読む
                var headBytes = new MemoryStream();
                var buf = new byte[1];
                int matched = 0; // \r\n\r\n の一致数
                while (matched < 4)
                {
                    if (headBytes.Length >= MaxHeaderBytes) { WriteJson(stream, "{\"ok\":false,\"error\":\"header too large\"}"); return; }
                    int read;
                    try { read = stream.Read(buf, 0, 1); }
                    catch (IOException) { return; } // timeout 等 → 接続破棄
                    if (read <= 0) break;
                    headBytes.WriteByte(buf[0]);
                    char c = (char)buf[0];
                    if ((matched == 0 && c == '\r') || (matched == 1 && c == '\n') ||
                        (matched == 2 && c == '\r') || (matched == 3 && c == '\n')) matched++;
                    else matched = (c == '\r') ? 1 : 0;
                }
                string head = Encoding.ASCII.GetString(headBytes.ToArray());

                if (!HttpRequestParser.TryParse(head, out var req))
                {
                    WriteJson(stream, "{\"ok\":false,\"error\":\"bad request\"}");
                    return;
                }

                string body = "";
                if (req.ContentLength > 0)
                {
                    var bodyBuf = new byte[req.ContentLength];
                    int got = 0;
                    while (got < req.ContentLength)
                    {
                        int r;
                        try { r = stream.Read(bodyBuf, got, req.ContentLength - got); }
                        catch (IOException) { break; }
                        if (r <= 0) break;
                        got += r;
                    }
                    body = Encoding.UTF8.GetString(bodyBuf, 0, got);
                }

                // Route は JSON 文字列（従来）または EvalResult（バイナリ対応）を返す
                object routed = Route(req, body);
                if (routed is EvalResult er && er.Ok && er.Binary != null)
                    WriteRaw(stream, er.BinaryContentType ?? "application/octet-stream", er.Binary);
                else if (routed is EvalResult er2)
                    WriteJson(stream, ResultSerializer.ToJson(er2));
                else
                    WriteJson(stream, (string)routed);
            }
        }

        private object Route(ParsedRequest req, string body)
        {
            if (req.Path == "/ping")
            {
                double stalled = StalledSecs();
                // gameDir はクライアント（MCP）がログパス解決に使う（GAME_DIR 環境変数を不要にする）
                return "{\"ok\":true,\"version\":\"" + MyPluginInfo.PLUGIN_VERSION + "\",\"mainThreadAlive\":" + AliveJson(stalled) +
                       ",\"stalledSecs\":" + stalled.ToString("0.0", CultureInfo.InvariantCulture) +
                       ",\"gameDir\":" + JsonGraphWriter.Write(_gameDir, 1, 1, null) + "}";
            }
            if (req.Path == "/eval" && req.Method == "POST")
            {
                var pending = _pump.Enqueue(body);
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            if (req.Path == "/reset" && req.Method == "POST")
            {
                // 評価器を作り直す手動 escape hatch（builder 破損で auto-reset が取りこぼした場合等）。
                // 注意: メインスレッドが in-flight eval で hard block 中は /reset も同じ queue で詰まり
                // 届かない（その場合の復旧はゲーム再起動。/ping の mainThreadAlive:false で固着検出のみ可）。
                var pending = _pump.EnqueueReset();
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            if (req.Path == "/capture" && req.Method == "GET")
            {
                string target = QueryString.GetParam(req.Query, "target");
                if (!Capture.CaptureTargetSpec.TryParse(target, out var spec))
                    return "{\"ok\":false,\"error\":\"target= が不正です（screen / rt:<name> / rt:<W>x<H> / camera:<name> / imgui:<title>）\"}";
                int downscale = Capture.CaptureTargetSpec.ParseDownscale(QueryString.GetParam(req.Query, "downscale"));
                Capture.CaptureRect? rect = null;
                string rectRaw = QueryString.GetParam(req.Query, "rect");
                if (rectRaw != null)
                {
                    if (spec.Kind == Capture.CaptureTargetKind.ImGuiWindow)
                        return "{\"ok\":false,\"error\":\"imgui: と rect= は同時に指定できません\"}";
                    if (!Capture.CaptureRect.TryParse(rectRaw, out var parsedRect))
                        return "{\"ok\":false,\"error\":\"rect= が不正です（x,y,w,h の整数 4 つ・左上原点）\"}";
                    rect = parsedRect;
                }
                var pending = _pump.EnqueueJob((pump, r) => Capture.CaptureService.Start(pump, r, spec, downscale, rect));
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return pending.Result; // EvalResult 経路（PNG バイナリ or エラー JSON）
            }
            if (req.Path == "/imgui_windows" && req.Method == "GET")
            {
                // 台帳は OnGUI（メインスレッド）で書かれるため、読み出しもメインスレッドジョブで行う
                var pending = _pump.EnqueueJob((pump, r) =>
                {
                    try { r.Result = new EvalResult { Ok = true, Value = Capture.ImGuiWindowRegistry.LiveAsJsonObjects() }; }
                    catch (Exception ex) { r.Result = new EvalResult { Ok = false, Error = "imgui_windows: " + ex.Message }; }
                    finally { r.Done.Set(); }
                });
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            if (req.Path == "/dump" && req.Method == "GET")
            {
                // 既知の残リスク（許容）: typo は単純識別子の eval で CS0103 になる。compile error は低確率で
                // builder を破損させ次 eval の auto-reset（REPL 変数全消し）を誘発しうるが、名前解決エラーは
                // emit 前に止まるため確率は低い。brick が実際に観測されたら GetVars ベースの存在チェックへ切替。
                string var = QueryString.GetParam(req.Query, "var");
                if (!Eval.DumpValidator.IsSimpleIdentifier(var))
                    return "{\"ok\":false,\"error\":\"var= は REPL 変数名（単純識別子）のみ指定できます\"}";
                var pending = _pump.Enqueue(var); // 識別子 1 個の eval = 変数値の取得
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                var r = pending.Result;
                if (r.Ok && r.Value is byte[] bytes)
                    return new EvalResult { Ok = true, Binary = bytes, BinaryContentType = "application/octet-stream" };
                if (r.Ok && r.Value is string s)
                    return new EvalResult { Ok = true, Binary = Encoding.UTF8.GetBytes(s), BinaryContentType = "text/plain; charset=utf-8" };
                if (r.Ok && r.Value == null)
                    return "{\"ok\":false,\"error\":\"var は定義済みですが null です（byte[]/string を期待）\"}";
                if (r.Ok)
                    return "{\"ok\":false,\"error\":\"var の型が byte[]/string ではありません: " + r.Value.GetType().Name + "\"}";
                return ResultSerializer.ToJson(r); // 未定義変数等のエラーをそのまま返す
            }
            if (req.Path == "/watch" && req.Method == "POST")
            {
                // 設計変更（spec は JSON body）: bridge に JSON パーサが無いため
                // query パラメータ + raw body=式（/eval と同形式）にする
                string expr = body;
                if (string.IsNullOrWhiteSpace(expr))
                    return "{\"ok\":false,\"error\":\"body に監視する C# 式を入れてください\"}";
                int frames = Watch.WatchRegistry.ClampFrames(
                    int.TryParse(QueryString.GetParam(req.Query, "frames"), out int f) ? f : 600);
                bool diff = QueryString.GetParam(req.Query, "mode") == "diff";
                var pending = _pump.EnqueueJob((pump, r) =>
                {
                    var compiled = pump.Evaluator.CompileForWatch(expr, out var sampler);
                    if (!compiled.Ok)
                    {
                        r.Result = compiled;
                    }
                    else
                    {
                        int id = pump.Watches.Create(sampler, frames, diff);
                        r.Result = id > 0
                            ? new EvalResult { Ok = true, Value = new Dictionary<string, object> { ["id"] = id, ["frames"] = frames, ["mode"] = diff ? "diff" : "log" } }
                            : new EvalResult { Ok = false, Error = "watch 同時数が上限です（GET/DELETE で解放してください）" };
                    }
                    r.Done.Set();
                });
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            if (req.Path.StartsWith("/watch/") && (req.Method == "GET" || req.Method == "DELETE"))
            {
                if (!int.TryParse(req.Path.Substring("/watch/".Length), out int watchId))
                    return "{\"ok\":false,\"error\":\"watch id が不正です\"}";
                bool isDelete = req.Method == "DELETE";
                var pending = _pump.EnqueueJob((pump, r) =>
                {
                    if (isDelete)
                    {
                        r.Result = pump.Watches.Remove(watchId)
                            ? new EvalResult { Ok = true, Value = "removed" }
                            : new EvalResult { Ok = false, Error = "watch が見つかりません: " + watchId };
                    }
                    else
                    {
                        var e = pump.Watches.TryRead(watchId, removeIfDone: true); // done は返却と同時に自動解除
                        r.Result = e == null
                            ? new EvalResult { Ok = false, Error = "watch が見つかりません: " + watchId }
                            : new EvalResult
                            {
                                Ok = true,
                                Value = new Dictionary<string, object>
                                {
                                    ["id"] = e.Id,
                                    ["done"] = e.Done,
                                    ["framesRemaining"] = e.FramesRemaining,
                                    ["count"] = e.Results.Count,
                                    ["error"] = e.Error,
                                    // 配列は ResultSerializer の MaxItems=100 で打ち切られるため "\n" 結合の単一文字列で返す
                                    ["results"] = string.Join("\n", e.Results.ToArray()),
                                },
                            };
                    }
                    r.Done.Set();
                });
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            if (req.Path == "/profile" && req.Method == "POST")
            {
                // /watch と同形式: query パラメータ + raw body = "Full.Type.Name:MethodName"
                string spec = body;
                if (string.IsNullOrWhiteSpace(spec))
                    return "{\"ok\":false,\"error\":\"body に対象を \\\"Full.Type.Name:MethodName\\\" 形式で入れてください\"}";
                int frames = Profile.ProfileRegistry.ClampFrames(
                    int.TryParse(QueryString.GetParam(req.Query, "frames"), out int f) ? f : 600);
                var pending = _pump.EnqueueJob((pump, r) =>
                {
                    string err = pump.Profiler.Add(spec, frames, out int id, out int patchedCount);
                    r.Result = err == null
                        ? new EvalResult { Ok = true, Value = new Dictionary<string, object> { ["id"] = id, ["frames"] = frames, ["patchedMethods"] = patchedCount } }
                        : new EvalResult { Ok = false, Error = err };
                    r.Done.Set();
                });
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            if (req.Path.StartsWith("/profile/") && (req.Method == "GET" || req.Method == "DELETE"))
            {
                if (!int.TryParse(req.Path.Substring("/profile/".Length), out int profileId))
                    return "{\"ok\":false,\"error\":\"profile id が不正です\"}";
                bool isDelete = req.Method == "DELETE";
                var pending = _pump.EnqueueJob((pump, r) =>
                {
                    if (isDelete)
                    {
                        r.Result = pump.Profiler.Remove(profileId)
                            ? new EvalResult { Ok = true, Value = "removed" }
                            : new EvalResult { Ok = false, Error = "profile が見つかりません: " + profileId };
                    }
                    else
                    {
                        var e = pump.Profiler.ReadAndAutoRemove(profileId); // done は返却と同時に自動解除
                        r.Result = e == null
                            ? new EvalResult { Ok = false, Error = "profile が見つかりません: " + profileId }
                            : new EvalResult { Ok = true, Value = ProfileSummary(e) };
                    }
                    r.Done.Set();
                });
                if (!pending.Done.Wait(EvalTimeoutMs))
                    return "{\"ok\":false,\"error\":\"timeout (main thread stalled?)\"}";
                return ResultSerializer.ToJson(pending.Result);
            }
            return "{\"ok\":false,\"error\":\"not found\"}";
        }

        /// <summary>ProfileEntry を read 応答用の dict に整形する（フレーム行は "\n" 結合の単一文字列）。</summary>
        private static Dictionary<string, object> ProfileSummary(Profile.ProfileEntry e)
        {
            var eventTypes = new Dictionary<string, object>();
            foreach (var kv in e.EventTypes)
                eventTypes[kv.Key] = "calls=" + kv.Value.Calls + " ms=" + kv.Value.Ms.ToString("0.000", CultureInfo.InvariantCulture);
            double avgMsPerFrame = e.FramesObserved > 0 ? e.TotalMs / e.FramesObserved : 0;
            double avgCallsPerFrame = e.FramesObserved > 0 ? (double)e.TotalCalls / e.FramesObserved : 0;
            return new Dictionary<string, object>
            {
                ["id"] = e.Id,
                ["target"] = e.Name,
                ["patchedMethods"] = e.PatchedMethodCount,
                ["done"] = e.Done,
                ["framesRemaining"] = e.FramesRemaining,
                ["framesObserved"] = e.FramesObserved,
                ["error"] = e.Error,
                ["totalCalls"] = e.TotalCalls,
                ["avgCallsPerFrame"] = avgCallsPerFrame.ToString("0.00", CultureInfo.InvariantCulture),
                ["maxCallsPerFrame"] = e.MaxCallsPerFrame,
                ["totalMs"] = e.TotalMs.ToString("0.000", CultureInfo.InvariantCulture),
                ["avgMsPerFrame"] = avgMsPerFrame.ToString("0.000", CultureInfo.InvariantCulture),
                ["maxFrameMs"] = e.MaxFrameMs.ToString("0.000", CultureInfo.InvariantCulture),
                ["totalAllocBytes"] = e.TotalAllocBytes,
                ["eventTypes"] = eventTypes,
                // 配列は ResultSerializer の MaxItems=100 で打ち切られるため "\n" 結合の単一文字列で返す
                ["frameRows"] = string.Join("\n", e.FrameRows.ToArray()),
            };
        }

        /// <summary>最後の main thread tick からの経過秒（wall-clock 基準。フリーズ中も進む）。</summary>
        private double StalledSecs() => (DateTime.UtcNow - _pump.LastTickUtc).TotalSeconds;

        /// <summary>mainThreadAlive 判定（直近 2 秒以内に tick があるか）の JSON リテラル。</summary>
        private static string AliveJson(double stalledSecs) => stalledSecs < 2.0 ? "true" : "false";

        private static void WriteRaw(NetworkStream stream, string contentType, byte[] payload)
        {
            var header = "HTTP/1.1 200 OK\r\n" +
                         "Content-Type: " + contentType + "\r\n" +
                         "Content-Length: " + payload.Length + "\r\n" +
                         "Connection: close\r\n\r\n";
            byte[] head = Encoding.ASCII.GetBytes(header);
            try
            {
                stream.Write(head, 0, head.Length);
                stream.Write(payload, 0, payload.Length);
                stream.Flush();
            }
            catch (IOException) { /* timeout 後にクライアントが切断済み等。静かに破棄（警告ログのノイズ防止） */ }
        }

        private static void WriteJson(NetworkStream stream, string json)
        {
            WriteRaw(stream, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
        }
    }
}
