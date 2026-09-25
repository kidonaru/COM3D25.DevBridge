import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BridgeClient, BridgeUnreachableError } from "../src/bridge.js";

const BASE = "http://127.0.0.1:18650";

describe("BridgeClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("evalCs は body にコードをそのまま入れて POST し JSON を返す", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true,"result":"2"}'));
    const client = new BridgeClient(BASE);
    const res = await client.evalCs("1+1");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/eval`, expect.objectContaining({ method: "POST", body: "1+1" }));
    expect(res.ok).toBe(true);
    expect(res.result).toBe("2");
  });

  it("接続不可は BridgeUnreachableError（ゲーム未起動の案内文）に変換する", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const client = new BridgeClient(BASE);
    await expect(client.evalCs("1+1")).rejects.toThrow(BridgeUnreachableError);
    await expect(client.evalCs("1+1")).rejects.toThrow(/ゲーム未起動かプラグイン未ロード/);
  });

  it("captureRaw は target/downscale を query に載せ PNG バイナリを返す", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    fetchMock.mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }));
    const client = new BridgeClient(BASE);
    const buf = await client.captureRaw("screen", 1280);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/capture?target=screen&downscale=1280`, expect.anything());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from(png));
  });

  it("captureRaw は rect を query に載せる", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0x89]), { headers: { "content-type": "image/png" } }));
    const client = new BridgeClient(BASE);
    await client.captureRaw("imgui:Mod Item Explorer", undefined, "10,20,300,400");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/capture?target=imgui%3AMod+Item+Explorer&rect=10%2C20%2C300%2C400`,
      expect.anything(),
    );
  });

  it("listImGuiWindows は GET /imgui_windows", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true,"result":[]}'));
    const client = new BridgeClient(BASE);
    const res = await client.listImGuiWindows();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/imgui_windows`, expect.objectContaining({ method: "GET" }));
    expect(res.result).toEqual([]);
  });

  it("capture がエラー JSON を返したら Error として投げる", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"ok":false,"error":"target= が不正です"}', { headers: { "content-type": "application/json" } }),
    );
    const client = new BridgeClient(BASE);
    await expect(client.captureRaw("bogus")).rejects.toThrow(/target= が不正です/);
  });

  // /watch の実 API（src/Http/BridgeServer.cs）:
  //   POST /watch?frames=<N>&mode=diff  body=式  → {ok, result:{id, frames, mode}}
  //   GET  /watch/<id>  → 結果読み出し（done なら自動解除）
  //   DELETE /watch/<id> → 解除
  // 一覧取得エンドポイントは存在しない。
  it("watchAdd は frames/mode を query に、式を body に載せて POST する", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true,"result":{"id":1}}'));
    const client = new BridgeClient(BASE);
    await client.watchAdd("Time.frameCount", { frames: 120, mode: "diff" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/watch?frames=120&mode=diff`,
      expect.objectContaining({ method: "POST", body: "Time.frameCount" }),
    );
  });

  it("watchAdd はオプション省略時に query なしで POST する", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true,"result":{"id":1}}'));
    const client = new BridgeClient(BASE);
    await client.watchAdd("Time.frameCount");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/watch`, expect.objectContaining({ method: "POST", body: "Time.frameCount" }));
  });

  it("watchRead は GET /watch/<id>、watchRemove は DELETE /watch/<id>", async () => {
    // Response の body は 1 回しか読めないため、呼び出しごとに新しい Response を作る
    fetchMock.mockImplementation(async () => new Response('{"ok":true}'));
    const client = new BridgeClient(BASE);
    await client.watchRead(3);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/watch/3`, expect.objectContaining({ method: "GET" }));
    await client.watchRemove(3);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/watch/3`, expect.objectContaining({ method: "DELETE" }));
  });

  // /profile の実 API（src/Http/BridgeServer.cs）:
  //   POST /profile?frames=<N>  body="Full.Type.Name:MethodName" → {ok, result:{id, frames, patchedMethods}}
  //   GET  /profile/<id>  → 集計読み出し（done なら自動解除）
  //   DELETE /profile/<id> → 解除
  it("profileAdd は frames を query に、対象を body に載せて POST する", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true,"result":{"id":1}}'));
    const client = new BridgeClient(BASE);
    await client.profileAdd("Ns.Type:Method", 300);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/profile?frames=300`,
      expect.objectContaining({ method: "POST", body: "Ns.Type:Method" }),
    );
  });

  it("profileAdd は frames 省略時に query なしで POST する", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true,"result":{"id":1}}'));
    const client = new BridgeClient(BASE);
    await client.profileAdd("Ns.Type:Method");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/profile`, expect.objectContaining({ method: "POST", body: "Ns.Type:Method" }));
  });

  it("profileRead は GET /profile/<id>、profileRemove は DELETE /profile/<id>", async () => {
    fetchMock.mockImplementation(async () => new Response('{"ok":true}'));
    const client = new BridgeClient(BASE);
    await client.profileRead(3);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/profile/3`, expect.objectContaining({ method: "GET" }));
    await client.profileRemove(3);
    expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/profile/3`, expect.objectContaining({ method: "DELETE" }));
  });
});
