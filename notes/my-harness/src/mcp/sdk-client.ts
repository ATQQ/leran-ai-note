/**
 * sdk · 官方 @modelcontextprotocol/sdk Client + StdioClientTransport
 *
 * 接入流程（对照页面「sdk」）：
 * 1. new StdioClientTransport({ command, args })  —— SDK 负责 spawn / 分帧
 * 2. new Client({ name, version })
 * 3. await client.connect(transport)  —— SDK 内完成 initialize 握手
 * 4. client.listTools() / client.callTool({ name, arguments })
 *
 * 对照 stdio-client.ts（raw）：业务结果应一致；差别在「谁写协议」。
 * 线缆日志为 logical（SDK 不暴露原文，按同样 JSON-RPC 形状复原便于学习）。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  formatMcpContent,
  type McpClientStatus,
  type McpHostClient,
  type McpToolInfo,
} from "./host.ts";
import { McpWireLog } from "./wire-log.ts";

export class McpSdkClient implements McpHostClient {
  readonly backend = "sdk" as const;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private lastError: string | null = null;
  private command: string | null = null;
  private args: string[] = [];
  private serverPath: string | null = null;
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
      pid: this.transport?.pid ?? null,
      command: this.command,
      args: [...this.args],
      serverPath: this.serverPath,
      lastError: this.lastError,
      toolCount: this.cachedTools.length,
      wireLog: this.wire.snapshot(),
    };
  }

  getToolsCache(): McpToolInfo[] {
    return [...this.cachedTools];
  }

  async connect(command: string, args: string[], serverPath?: string): Promise<void> {
    await this.close();
    this.wire.clear();
    this.nextLogicalId = 1;
    this.command = command;
    this.args = args;
    this.serverPath = serverPath ?? args[0] ?? null;
    this.lastError = null;
    this.cachedTools = [];

    const transport = new StdioClientTransport({
      command,
      args,
      stderr: "pipe",
    });
    const stderr = transport.stderr;
    if (stderr && typeof stderr.on === "function") {
      stderr.on("data", (chunk: Buffer | string) => {
        const text = String(chunk).trimEnd();
        if (text) console.error("[mcp-server:sdk]", text);
      });
    }

    const client = new Client({
      name: "my-harness-sdk",
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
            clientInfo: { name: "my-harness-sdk", version: "0.1.0" },
          },
          _note: "logical：SDK connect() 内部实际发送",
        },
        "logical",
      );
      await client.connect(transport);
      this.wire.pushIn(
        {
          jsonrpc: "2.0",
          id: initId,
          result: { note: "logical：initialize result（细节由 SDK 消化）" },
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
        this.lastError = this.lastError || "mcp_transport_closed";
      };
      transport.onerror = (err) => {
        this.lastError = "mcp_transport_error: " + err.message;
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
      throw new Error("mcp_sdk_connect_failed: " + message);
    }
  }

  async close(): Promise<void> {
    this.alive = false;
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
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
          : "mcp_unavailable: sdk client not connected",
      );
    }
    const id = this.nextLogicalId++;
    this.wire.pushOut(
      { jsonrpc: "2.0", id, method: "tools/list", params: {} },
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
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
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
          : "mcp_unavailable: sdk client not connected",
      );
    }
    const id = this.nextLogicalId++;
    this.wire.pushOut(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
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
        result: {
          content: result.content,
          isError,
        },
      },
      "logical",
    );
    const content = formatMcpContent(
      result.content as Array<{ type?: string; text?: string }> | undefined,
    );
    return { content, isError };
  }
}
