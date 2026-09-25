import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolContent = { type: string; text?: string; data?: string; mimeType?: string };
export type Handler = (args: Record<string, unknown>) => Promise<{ content: ToolContent[]; isError?: boolean }>;

/**
 * McpServer はツール登録の器でしかないため、登録内容だけを捕捉するスタブに差し替えて
 * ハンドラを直接呼び出す（MCP プロトコルを経由せずツールのロジックを検証する）。
 */
export function collectTools(): { server: McpServer; tools: Map<string, Handler> } {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => tools.set(name, handler),
  };
  return { server: server as unknown as McpServer, tools };
}
