// MCP ツールの戻り値型と共通ヘルパ。basic.ts / game.ts の両方から使う。

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = { content: ToolContent[]; isError?: boolean };

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * ブリッジの応答 JSON をツール結果にする。
 * ブリッジは失敗時も HTTP 200 で {"ok":false,...} を返すため、ok を isError に伝搬させないと
 * 評価エラーや watch 未検出が呼び出し側で成功として扱われてしまう。
 */
export function bridgeResult(res: { ok: boolean }): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }], isError: !res.ok };
}

/**
 * 例外を isError 付き結果へ変換する共通ラッパ。
 * MCP のツールは throw するとプロトコルエラーになり内容が伝わりにくいため、
 * ブリッジ接続不可などの想定内の失敗はツール結果として返す。
 */
export function wrap(fn: ToolHandler): ToolHandler {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e));
    }
  };
}
