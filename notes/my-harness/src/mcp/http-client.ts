/**
 * sdk · Streamable HTTP Client（远程 MCP）
 *
 * 接入：
 * 1. new StreamableHTTPClientTransport(new URL(url))
 * 2. new Client → client.connect(transport)  —— 内部 POST initialize，拿 mcp-session-id
 * 3. listTools / callTool —— 后续请求带同一 session
 *
 * 与 stdio 对照：协议仍是 JSON-RPC；传输从管道换成 HTTP。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  formatMcpContent,
  type McpClientStatus,
  type McpHostClient,
  type McpToolInfo,
} from "./host.ts";
import { McpWireLog } from "./wire-log.ts";

export class McpHttpClient implements McpHostClient {
  /** 页面上仍显示为 sdk 族；实际传输是 http */
  readonly backend = "sdk" as const;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private lastError: string | null = null;
  private url: string | null = null;
  private cachedTools: McpToolInfo[] = [];
  private alive = false;
  private wire = new McpWireLog();
  private nextLogicalId = 1;

  get connected(): boolean {
    return this.alive && this.client !== null && this.transport !== null;
  }

  status(): McpClientStatus {
    return {
      backend: this.backend,
      connected: this.connected,
      pid: null,
      command: null,
      args: [],
      serverPath: this.url,
      lastError: this.lastError,
      toolCount: this.cachedTools.length,
      wireLog: this.wire.snapshot(),
      transport: "http",
      url: this.url,
      sessionId: this.transport?.sessionId ?? null,
    };
  }

  getToolsCache(): McpToolInfo[] {
    return [...this.cachedTools];
  }

  /**
   * 兼容 McpHostClient：第一个参数当作 URL（registry 对 http 配置这样调）。
   */
  async connect(url: string, _args: string[] = [], _serverPath?: string): Promise<void> {
    await this.close();
    this.wire.clear();
    this.nextLogicalId = 1;
    this.url = url;
    this.lastError = null;
    this.cachedTools = [];

    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({
      name: "my-harness-http",
      version: "0.1.0",
    });

    try {
      const initId = this.nextLogicalId++;
      this.wire.pushOut(
        {
          jsonrpc: "2.0",
          id: initId,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "my-harness-http", version: "0.1.0" },
          },
          _note: "logical：HTTP POST /mcp · SDK 发送；响应头带 mcp-session-id",
        },
        "logical",
      );
      await client.connect(transport);
      this.wire.pushIn(
        {
          jsonrpc: "2.0",
          id: initId,
          result: {
            note: "logical：initialize ok",
            sessionId: transport.sessionId,
          },
        },
        "logical",
      );
      this.wire.pushOut(
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        "logical",
      );

      this.client = client;
      this.transport = transport;
      this.alive = true;
      transport.onclose = () => {
        this.alive = false;
        this.lastError = this.lastError || "mcp_http_closed";
      };
      transport.onerror = (err) => {
        this.lastError = "mcp_http_error: " + err.message;
        this.alive = false;
      };
      this.cachedTools = await this.listTools();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.alive = false;
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.transport = null;
      throw new Error("mcp_http_connect_failed: " + message);
    }
  }

  async close(): Promise<void> {
    this.alive = false;
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (transport) {
      try {
        await transport.terminateSession();
      } catch {
        /* 服务端可返回 405 */
      }
    }
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    } else if (transport) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    if (!this.client || !this.connected) {
      throw new Error(
        this.lastError
          ? "mcp_unavailable: " + this.lastError
          : "mcp_unavailable: http client not connected",
      );
    }
    const id = this.nextLogicalId++;
    this.wire.pushOut(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/list",
        params: {},
        _note: "HTTP POST + header mcp-session-id=" + (this.transport?.sessionId ?? "?"),
      },
      "logical",
    );
    const result = await this.client.listTools();
    const tools: McpToolInfo[] = (result.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
    this.wire.pushIn(
      {
        jsonrpc: "2.0",
        id,
        result: { tools: tools.map((t) => ({ name: t.name })) },
      },
      "logical",
    );
    this.cachedTools = tools;
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    if (!this.client || !this.connected) {
      throw new Error(
        this.lastError
          ? "mcp_unavailable: " + this.lastError
          : "mcp_unavailable: http client not connected",
      );
    }
    const id = this.nextLogicalId++;
    this.wire.pushOut(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
        _note: "session=" + (this.transport?.sessionId ?? "?"),
      },
      "logical",
    );
    const result = await this.client.callTool({
      name,
      arguments: args,
    });
    const isError = Boolean((result as { isError?: boolean }).isError);
    this.wire.pushIn(
      {
        jsonrpc: "2.0",
        id,
        result: { content: result.content, isError },
      },
      "logical",
    );
    return {
      content: formatMcpContent(
        result.content as Array<{ type?: string; text?: string }> | undefined,
      ),
      isError,
    };
  }
}
