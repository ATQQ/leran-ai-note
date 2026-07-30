/**
 * MCP → 统一工具类型桥
 *
 * - list：McpToolInfo → ToolDef（inputSchema 当 parameters）
 * - call：ToolCall → tools/call → ToolResult
 * - 进程不可用 / RPC 失败：明确 isError ToolResult，禁止静默
 * - 不区分 raw / sdk：只认 McpHostClient 接口
 *
 * 与本地 mock 的关系：同名工具以 MCP 为准（mergeToolsPreferMcp）。
 */
import type { ToolCall, ToolDef, ToolResult } from "../types.ts";
import type { McpHostClient, McpToolInfo } from "./host.ts";

/** MCP tool 描述 → 发给模型的 ToolDef */
export function mcpToolToDef(tool: McpToolInfo): ToolDef {
  const schema =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? tool.inputSchema
      : { type: "object", properties: {} };
  return {
    name: tool.name,
    description: tool.description || ("MCP tool: " + tool.name),
    parameters: schema as Record<string, unknown>,
  };
}

export function mcpToolsToDefs(tools: McpToolInfo[]): ToolDef[] {
  return tools.map(mcpToolToDef);
}

/**
 * 合并本地与 MCP：同名时 MCP 覆盖本地（例如两边都有 add）。
 * 本地独有（如 get_weather）保留。
 */
export function mergeToolsPreferMcp(
  local: ToolDef[],
  mcp: ToolDef[],
): ToolDef[] {
  const mcpNames = new Set(mcp.map((t) => t.name));
  return [...local.filter((t) => !mcpNames.has(t.name)), ...mcp];
}

/**
 * 经 MCP 执行一次 ToolCall。
 * 任何连接/协议错误都变成 isError ToolResult（供 loop 回写 Context）。
 */
export async function executeMcpTool(
  call: ToolCall,
  client: McpHostClient,
): Promise<ToolResult> {
  if (!client.connected) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: "mcp_unavailable",
        message:
          "MCP 进程未连接或已退出。请先 POST /api/mcp/connect，或在页面点「连接」。",
        detail: client.status().lastError,
        backend: client.backend,
      }),
      isError: true,
    };
  }

  try {
    const { content, isError } = await client.callTool(
      call.name,
      call.arguments ?? {},
    );
    return {
      toolCallId: call.id,
      name: call.name,
      content:
        content ||
        JSON.stringify({
          ok: true,
          note: "MCP 返回空 content",
        }),
      isError,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify({
        error: "mcp_call_failed",
        message,
        backend: client.backend,
      }),
      isError: true,
    };
  }
}

/** 判断某 name 是否应由 MCP 执行（在已列出的 MCP 工具集合里） */
export function isMcpToolName(name: string, mcpDefs: ToolDef[]): boolean {
  return mcpDefs.some((t) => t.name === name);
}
