// COM3D25.DevBridge (HTTP) への薄いクライアント。
// 接続不可はゲーム未起動/プラグイン未ロードとして案内する。

/**
 * ブリッジの応答 JSON。フィールド名は plugin/src/Serialize/ResultSerializer.cs に対応する:
 * 成功時は result、失敗時は error のみが入り、report/elapsedMs は常に付く。
 */
export type EvalResponse = {
  ok: boolean;
  result?: unknown;
  error?: string;
  report?: string;
  elapsedMs?: number;
};

/** watch 登録オプション。ブリッジ側の query パラメータ名にそのまま対応する。 */
export type WatchOptions = {
  /** 監視するフレーム数（ブリッジ側の既定は 600、上限はブリッジ側で clamp）。 */
  frames?: number;
  /** log = 毎フレーム記録 / diff = 値が変化したときだけ記録。 */
  mode?: "log" | "diff";
};

/** /ping の応答 JSON のうち、ツール側で判断に使うフィールド。 */
export type PingInfo = { mainThreadAlive?: boolean; gameDir?: string };

/**
 * /ping を JSON として読む。
 * ブリッジが HTML エラーページ等を返したときに生の SyntaxError を見せないよう、
 * パース失敗はブリッジの応答不正として扱う。
 */
export async function pingInfo(bridge: Pick<BridgeClient, "pingRaw">): Promise<PingInfo> {
  const raw = await bridge.pingRaw();
  try {
    return JSON.parse(raw) as PingInfo;
  } catch {
    throw new Error("ブリッジの /ping 応答が JSON として読めません。ゲームとプラグインの状態を確認してください");
  }
}

export class BridgeUnreachableError extends Error {
  constructor(baseUrl: string) {
    super(
      `ブリッジ ${baseUrl} に接続できません。ゲーム未起動かプラグイン未ロードの可能性があります。` +
        `COM3D2.5 を起動し、BepInEx/LogOutput.log に "COM3D25.DevBridge listening" が出ているか確認してください。`,
    );
    this.name = "BridgeUnreachableError";
  }
}

export class BridgeClient {
  constructor(private readonly baseUrl: string) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch {
      throw new BridgeUnreachableError(this.baseUrl);
    }
  }

  private async requestJson(path: string, init: RequestInit): Promise<EvalResponse> {
    const res = await this.request(path, init);
    return (await res.json()) as EvalResponse;
  }

  async pingRaw(): Promise<string> {
    return (await this.request("/ping", { method: "GET" })).text();
  }

  /** /ping の gameDir フィールドを返す（旧バージョンのブリッジには無いので undefined になりうる）。 */
  async pingGameDir(): Promise<string | undefined> {
    const raw = await this.pingRaw();
    let info: { gameDir?: string };
    try {
      info = JSON.parse(raw) as { gameDir?: string };
    } catch {
      return undefined; // パース不能な応答は「gameDir 未対応の旧ブリッジ」と同じ扱いにする
    }
    return typeof info.gameDir === "string" && info.gameDir.length > 0 ? info.gameDir : undefined;
  }

  async evalCs(code: string): Promise<EvalResponse> {
    return this.requestJson("/eval", { method: "POST", body: code });
  }

  async reset(): Promise<EvalResponse> {
    return this.requestJson("/reset", { method: "POST" });
  }

  /**
   * PNG をキャプチャする。
   * maxSize は出力画像の長辺ピクセル数（ブリッジ側で 16..4096 にクランプ）。
   * 省略すると原寸。ブリッジの query 名は歴史的経緯で `downscale` だが縮小率ではない。
   * rect は "x,y,w,h"（左上原点・px）の切り抜き矩形。
   */
  async captureRaw(target: string, maxSize?: number, rect?: string): Promise<Buffer> {
    const q = new URLSearchParams({ target });
    if (maxSize !== undefined) q.set("downscale", String(maxSize));
    if (rect !== undefined) q.set("rect", rect);
    const res = await this.request(`/capture?${q}`, { method: "GET" });
    // 成功時は image/png、失敗時はエラー JSON が返る（ブリッジ側は失敗でも 200）
    if (!(res.headers.get("content-type") ?? "").includes("image/png")) {
      const body = await res.text();
      let msg = body;
      try {
        msg = (JSON.parse(body) as { error?: string }).error ?? body;
      } catch {
        /* JSON でなければ生のまま伝える */
      }
      throw new Error(`capture 失敗: ${msg}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** 表示中の IMGUI ウィンドウ一覧（id/title/x/y/w/h）。 */
  async listImGuiWindows(): Promise<EvalResponse> {
    return this.requestJson("/imgui_windows", { method: "GET" });
  }

  /** watch を登録する。式は body に入れる（/eval と同形式）。 */
  async watchAdd(expr: string, opts?: WatchOptions): Promise<EvalResponse> {
    const q = new URLSearchParams();
    if (opts?.frames !== undefined) q.set("frames", String(opts.frames));
    if (opts?.mode !== undefined) q.set("mode", opts.mode);
    const qs = q.size > 0 ? `?${q}` : "";
    return this.requestJson(`/watch${qs}`, { method: "POST", body: expr });
  }

  /** watch の結果を読み出す（完了済みならブリッジ側で自動解除される）。 */
  async watchRead(id: number): Promise<EvalResponse> {
    return this.requestJson(`/watch/${id}`, { method: "GET" });
  }

  /** watch を解除する。 */
  async watchRemove(id: number): Promise<EvalResponse> {
    return this.requestJson(`/watch/${id}`, { method: "DELETE" });
  }

  /** プロファイルを登録する。対象 "Full.Type.Name:MethodName" は body に入れる（/watch と同形式）。 */
  async profileAdd(target: string, frames?: number): Promise<EvalResponse> {
    const q = new URLSearchParams();
    if (frames !== undefined) q.set("frames", String(frames));
    const qs = q.size > 0 ? `?${q}` : "";
    return this.requestJson(`/profile${qs}`, { method: "POST", body: target });
  }

  /** プロファイル結果を読み出す（完了済みならブリッジ側でパッチ解除＋自動解除される）。 */
  async profileRead(id: number): Promise<EvalResponse> {
    return this.requestJson(`/profile/${id}`, { method: "GET" });
  }

  /** プロファイルを解除する（パッチも即時解除される）。 */
  async profileRemove(id: number): Promise<EvalResponse> {
    return this.requestJson(`/profile/${id}`, { method: "DELETE" });
  }
}
