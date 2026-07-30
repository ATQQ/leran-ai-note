/**
 * 多 MCP Server 注册表
 *
 * 对齐 Pi 同类冲突策略（extensions/skills）：同名保留先出现的，不改工具名。
 * Pi coding-agent 本身无内置 MCP；这里用同样的 first-wins 模拟多源聚合。
 *
 * 调用：resolve(name) → 按 catalog 顺序找第一个拥有该 tool 的 Client → callTool(name)。
 */
import { existsSync } from "node:fs";
import type { ToolCall, ToolDef, ToolResult } from "../types.ts";
import { executeMcpTool, mcpToolToDef } from "./bridge.ts";
import { createMcpHostClient } from "./factory.ts";
import type { McpBackend, McpHostClient, McpWireFrame } from "./host.ts";

export type McpServerConfig = {
  id: string;
  label: string;
  path: string;
  toolsHint?: string[];
};

/** 带路由元数据的 ToolDef；name 与 MCP 原名一致 */
export type RoutedToolDef = ToolDef & {
  mcpServerId: string;
};

type Session = {
  config: McpServerConfig;
  client: McpHostClient;
  backend: McpBackend;
  /** 该 Server list 到的原始工具（未去重） */
  tools: RoutedToolDef[];
  lastError: string | null;
};

export type ToolConflict = {
  name: string;
  winnerServerId: string;
  skippedServerId: string;
};

export class McpRegistry {
  private catalog = new Map<string, McpServerConfig>();
  /** 保持构造顺序 = 冲突时优先级（先者胜） */
  private catalogOrder: string[] = [];
  private sessions = new Map<string, Session>();

  constructor(configs: McpServerConfig[]) {
    for (const c of configs) {
      this.catalog.set(c.id, c);
      this.catalogOrder.push(c.id);
    }
  }

  listCatalog(): Array<McpServerConfig & { exists: boolean }> {
    return this.catalogOrder.map((id) => {
      const c = this.catalog.get(id)!;
      return { ...c, exists: existsSync(c.path) };
    });
  }

  connectedIds(): string[] {
    return this.catalogOrder.filter((id) => {
      const s = this.sessions.get(id);
      return Boolean(s?.client.connected);
    });
  }

  async connect(serverId: string, backend: McpBackend): Promise<RoutedToolDef[]> {
    const config = this.catalog.get(serverId);
    if (!config) {
      throw new Error("unknown_mcp_server: " + serverId);
    }
    if (!existsSync(config.path)) {
      throw new Error("mcp_server_missing: " + config.path);
    }

    const existing = this.sessions.get(serverId);
    if (existing?.client.connected && existing.backend === backend) {
      existing.tools = await this.refreshTools(existing);
      existing.lastError = null;
      return existing.tools;
    }

    if (existing) {
      await existing.client.close().catch(() => undefined);
      this.sessions.delete(serverId);
    }

    const client = createMcpHostClient(backend);
    try {
      await client.connect(process.execPath, [config.path], config.path);
      const session: Session = {
        config,
        client,
        backend,
        tools: [],
        lastError: null,
      };
      session.tools = await this.refreshTools(session);
      this.sessions.set(serverId, session);
      return session.tools;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      throw new Error("mcp_connect_failed[" + serverId + "]: " + message);
    }
  }

  async connectMany(
    serverIds: string[],
    backend: McpBackend,
  ): Promise<{
    ok: string[];
    failed: Array<{ id: string; error: string }>;
    tools: RoutedToolDef[];
    conflicts: ToolConflict[];
  }> {
    // 按 catalog 顺序连接，保证 first-wins 稳定
    const orderSet = new Set(serverIds);
    const ordered = this.catalogOrder.filter((id) => orderSet.has(id));
    for (const id of serverIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }

    const ok: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const id of ordered) {
      try {
        await this.connect(id, backend);
        ok.push(id);
      } catch (err) {
        failed.push({
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const { tools, conflicts } = this.aggregateTools(ok);
    return { ok, failed, tools, conflicts };
  }

  async disconnect(serverId?: string): Promise<void> {
    const ids = serverId ? [serverId] : [...this.sessions.keys()];
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (!s) continue;
      await s.client.close().catch(() => undefined);
      s.lastError = s.client.status().lastError || "disconnected";
    }
  }

  async shutdown(): Promise<void> {
    for (const s of this.sessions.values()) {
      await s.client.close().catch(() => undefined);
    }
    this.sessions.clear();
  }

  /**
   * 聚合后的工具表：原名不变；同名只保留 catalog 中更靠前的 Server。
   */
  getToolDefs(serverIds?: string[]): RoutedToolDef[] {
    return this.aggregateTools(serverIds).tools;
  }

  getConflicts(serverIds?: string[]): ToolConflict[] {
    return this.aggregateTools(serverIds).conflicts;
  }

  /**
   * 找 Client：按 catalog 顺序，第一个声明该 tool 名的会话。
   * （与 getToolDefs 的 first-wins 一致）
   */
  resolve(toolName: string): {
    serverId: string;
    client: McpHostClient;
    connected: boolean;
  } | null {
    for (const id of this.catalogOrder) {
      const s = this.sessions.get(id);
      if (!s) continue;
      if (!s.tools.some((t) => t.name === toolName)) continue;
      return {
        serverId: id,
        client: s.client,
        connected: s.client.connected,
      };
    }
    return null;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const hit = this.resolve(call.name);
    if (!hit) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify({
          error: "mcp_route_miss",
          message: "找不到拥有该工具的 MCP Client（或已被同名先者占用以外的源）。",
          known: this.getToolDefs().map((t) => t.name),
        }),
        isError: true,
      };
    }
    const result = await executeMcpTool(call, hit.client);
    return result;
  }

  isMcpToolName(name: string): boolean {
    return this.resolve(name) !== null;
  }

  statusPayload() {
    const { tools, conflicts } = this.aggregateTools();
    const servers = this.listCatalog().map((c) => {
      const s = this.sessions.get(c.id);
      return {
        id: c.id,
        label: c.label,
        path: c.path,
        exists: c.exists,
        toolsHint: c.toolsHint ?? [],
        connected: Boolean(s?.client.connected),
        backend: s?.backend ?? null,
        pid: s?.client.status().pid ?? null,
        lastError: s?.lastError ?? s?.client.status().lastError ?? null,
        tools: (s?.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      };
    });

    const wireLog: Array<McpWireFrame & { serverId: string }> = [];
    for (const id of this.catalogOrder) {
      const s = this.sessions.get(id);
      if (!s) continue;
      for (const frame of s.client.status().wireLog ?? []) {
        wireLog.push({ ...frame, serverId: id });
      }
    }
    wireLog.sort((a, b) => a.at.localeCompare(b.at));

    return {
      connected: this.connectedIds(),
      /** 冲突策略说明（对照 Pi extensions：keep first） */
      conflictPolicy: "first-wins（catalog 顺序；工具名不改）",
      conflicts,
      servers,
      tools,
      routeTable: tools.map((t) => ({
        name: t.name,
        serverId: t.mcpServerId,
      })),
      wireLog: wireLog.slice(-80),
      backends: {
        raw: {
          label: "手写 JSON-RPC",
          steps: [
            "spawn(node, server.mjs)",
            "自写 initialize + notifications/initialized",
            "按行 tools/list / tools/call",
          ],
          file: "src/mcp/stdio-client.ts",
        },
        sdk: {
          label: "官方 SDK Client",
          steps: [
            "new StdioClientTransport({ command, args })",
            "new Client → client.connect(transport)（内含握手）",
            "client.listTools() / client.callTool()",
          ],
          file: "src/mcp/sdk-client.ts",
          package: "@modelcontextprotocol/sdk",
        },
      },
    };
  }

  private aggregateTools(serverIds?: string[]): {
    tools: RoutedToolDef[];
    conflicts: ToolConflict[];
  } {
    const allow = serverIds ? new Set(serverIds) : null;
    const seen = new Map<string, string>(); // toolName → winner serverId
    const tools: RoutedToolDef[] = [];
    const conflicts: ToolConflict[] = [];

    for (const id of this.catalogOrder) {
      if (allow && !allow.has(id)) continue;
      const s = this.sessions.get(id);
      if (!s) continue;
      for (const t of s.tools) {
        const winner = seen.get(t.name);
        if (winner) {
          conflicts.push({
            name: t.name,
            winnerServerId: winner,
            skippedServerId: id,
          });
          continue;
        }
        seen.set(t.name, id);
        tools.push(t);
      }
    }
    return { tools, conflicts };
  }

  private async refreshTools(session: Session): Promise<RoutedToolDef[]> {
    const listed = await session.client.listTools();
    return listed.map((t) => {
      const base = mcpToolToDef(t);
      return {
        ...base,
        // 名称保持 MCP 原名；描述里标注来源便于人眼对照
        description:
          base.description ||
          ("MCP tool from " + session.config.id + ": " + base.name),
        mcpServerId: session.config.id,
      };
    });
  }
}

/** 本地 mock ∪ MCP：同名时 MCP 覆盖本地（单源）；多 MCP 内部已 first-wins */
export function mergeLocalAndMcpTools(
  local: ToolDef[],
  mcp: ToolDef[],
): ToolDef[] {
  const mcpNames = new Set(mcp.map((t) => t.name));
  return [...local.filter((t) => !mcpNames.has(t.name)), ...mcp];
}
