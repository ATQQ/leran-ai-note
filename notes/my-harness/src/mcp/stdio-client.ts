/**
 * raw · 手写 MCP stdio Client（不依赖 SDK）
 *
 * 接入流程（对照页面「raw」）：
 * 1. spawn(node, server.mjs) 拿到 stdin/stdout
 * 2. 自写 JSON-RPC：initialize → notifications/initialized
 * 3. tools/list / tools/call 按行读写
 *
 * 对照 sdk-client.ts：同样结果，但握手与分帧由官方 Client 完成。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
  formatMcpContent,
  type McpClientStatus,
  type McpHostClient,
  type McpToolInfo,
} from "./host.ts";
import { McpWireLog } from "./wire-log.ts";

export type { McpToolInfo, McpClientStatus } from "./host.ts";
export { formatMcpContent } from "./host.ts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

/**
 * 一行一条 JSON-RPC 的 stdio Client。
 * 同一时刻可挂起多个 id；子进程退出时全部 reject。
 */
export class McpStdioClient implements McpHostClient {
  readonly backend = "raw" as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private lastError: string | null = null;
  private command: string | null = null;
  private args: string[] = [];
  private serverPath: string | null = null;
  private cachedTools: McpToolInfo[] = [];
  private wire = new McpWireLog();

  get connected(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  status(): McpClientStatus {
    return {
      backend: this.backend,
      connected: this.connected,
      pid: this.child?.pid ?? null,
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
    this.command = command;
    this.args = args;
    this.serverPath = serverPath ?? args[0] ?? null;
    this.lastError = null;
    this.cachedTools = [];

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = "spawn_failed: " + message;
      throw new Error(this.lastError);
    }

    this.child = child;

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trimEnd();
      if (text) console.error("[mcp-server:raw]", text);
    });

    this.rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => this.onLine(line));

    const failAll = (reason: string) => {
      this.lastError = reason;
      for (const [, p] of this.pending) {
        p.reject(new Error(reason));
      }
      this.pending.clear();
    };

    child.on("error", (err) => {
      failAll("mcp_process_error: " + err.message);
    });

    child.on("exit", (code, signal) => {
      const reason =
        "mcp_process_exited: code=" +
        String(code) +
        " signal=" +
        String(signal);
      failAll(reason);
      this.child = null;
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }
    });

    try {
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "my-harness-raw", version: "0.1.0" },
      });
      this.notify("notifications/initialized");
      this.cachedTools = await this.listTools();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      await this.close();
      throw new Error("mcp_handshake_failed: " + message);
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("mcp_client_closed"));
    }
    this.pending.clear();
    if (!child) return;
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        resolve();
      }, 800);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request("tools/list", {})) as {
      tools?: McpToolInfo[];
    };
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    this.cachedTools = tools;
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    if (!this.connected) {
      throw new Error(
        this.lastError
          ? "mcp_unavailable: " + this.lastError
          : "mcp_unavailable: client not connected",
      );
    }
    const result = (await this.request("tools/call", {
      name,
      arguments: args,
    })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    return {
      content: formatMcpContent(result?.content),
      isError: Boolean(result?.isError),
    };
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.wire.push("in", trimmed, "wire");
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      console.error("[mcp-client:raw] bad json line:", trimmed.slice(0, 200));
      return;
    }
    if (msg.id === undefined || msg.id === null) return;
    const id = Number(msg.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (msg.error) {
      pending.reject(
        new Error(
          "mcp_rpc_error: " +
            (msg.error.message || "unknown") +
            (msg.error.code != null ? " (code " + msg.error.code + ")" : ""),
        ),
      );
      return;
    }
    pending.resolve(msg.result);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(
        new Error(
          this.lastError
            ? "mcp_unavailable: " + this.lastError
            : "mcp_unavailable: stdin not writable",
        ),
      );
    }
    const id = this.nextId++;
    const obj = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };
    const payload = JSON.stringify(obj);
    this.wire.push("out", payload, "wire");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child!.stdin.write(payload + "\n");
      } catch (err) {
        this.pending.delete(id);
        reject(
          new Error(
            "mcp_write_failed: " +
              (err instanceof Error ? err.message : String(err)),
          ),
        );
      }
    });
  }

  private notify(method: string, params?: unknown): void {
    if (!this.child?.stdin.writable) return;
    const obj = {
      jsonrpc: "2.0",
      method,
      params: params ?? {},
    };
    const payload = JSON.stringify(obj);
    this.wire.push("out", payload, "wire");
    try {
      this.child.stdin.write(payload + "\n");
    } catch (err) {
      console.error("[mcp-client:raw] notify failed", err);
    }
  }
}
