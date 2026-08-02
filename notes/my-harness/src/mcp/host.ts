/**
 * MCP Host 侧公共类型与接口
 *
 * 两种后端实现同一契约，便于对照接入流程：
 * - raw：手写 JSON-RPC（stdio-client.ts）
 * - sdk：官方 @modelcontextprotocol/sdk Client（sdk-client.ts）
 *
 * 下游（bridge / server）只依赖本接口，不关心协议细节。
 */
import type { McpWireFrame } from "./wire-log.ts";

export type { McpWireFrame } from "./wire-log.ts";

export type McpBackend = "raw" | "sdk";

/** MCP tools/list 单项（字段按协议常用子集） */
export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpClientStatus = {
  backend: McpBackend;
  connected: boolean;
  pid: number | null;
  command: string | null;
  args: string[];
  serverPath: string | null;
  lastError: string | null;
  toolCount: number;
  /** 最近 JSON-RPC 帧（教学习） */
  wireLog?: McpWireFrame[];
  /** stdio | http；缺省按 stdio */
  transport?: "stdio" | "http";
  /** Streamable HTTP 的 URL */
  url?: string | null;
  /** 远程会话 id（mcp-session-id） */
  sessionId?: string | null;
};

/**
 * Host 对 MCP Server 的最小能力：连接、列工具、调用、关闭。
 * raw / sdk 都必须实现，方便页面切换对比。
 */
export type McpHostClient = {
  readonly backend: McpBackend;
  readonly connected: boolean;
  status(): McpClientStatus;
  getToolsCache(): McpToolInfo[];
  connect(command: string, args: string[], serverPath?: string): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<McpToolInfo[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }>;
};

/** 把 MCP content[] 压成单字符串（ToolResult 只需文本） */
export function formatMcpContent(
  content: Array<{ type?: string; text?: string }> | undefined,
): string {
  if (!Array.isArray(content) || !content.length) return "";
  return content
    .map((c) => {
      if (c && typeof c.text === "string") return c.text;
      return JSON.stringify(c);
    })
    .join("\n");
}
