/**
 * 远程 MCP Server 模拟 · Streamable HTTP（有状态 session）
 *
 * 与 stdio 的区别：
 * - 不 spawn 子进程管道，而是 HTTP 监听端口
 * - 请求体仍是 JSON-RPC；外层用 HTTP + 头 `mcp-session-id` 绑会话
 *
 * 与「常规 REST」的区别：
 * - REST：通常一请求一响应、无会话；路径/动词表达资源
 * - 本 Server：同一 /mcp 端点承载 initialize / tools/list / tools/call；
 *   有状态模式下必须先 initialize，后续带 session id；
 *   会话内可保留 remember/recall 等内存（演示「有状态」）
 *
 * 启动：node mcp-servers/remote-http/server.mjs
 * 默认：http://127.0.0.1:8790/mcp
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const HOST = process.env.MCP_REMOTE_HOST || "127.0.0.1";
const PORT = Number(process.env.MCP_REMOTE_PORT || 8790);
const PATH = "/mcp";

/** sessionId → { transport, server, memory, calls } */
const sessions = new Map();

function createSessionServer(sessionId) {
  const memory = new Map();
  let calls = 0;

  const server = new McpServer({
    name: "my-harness-remote-http",
    version: "0.1.0",
  });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "远程 MCP 探活：回显文本，并带上当前 sessionId。",
      inputSchema: {
        text: z.string().describe("要回显的文本").default("pong"),
      },
    },
    async ({ text }) => {
      calls += 1;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              echo: text ?? "pong",
              sessionId,
              calls,
              transport: "streamable-http",
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "session_info",
    {
      title: "Session info",
      description: "查看当前 MCP 会话：sessionId、调用次数、已 remember 的 key。",
      inputSchema: {
        note: z.string().optional().describe("可选备注，可忽略"),
      },
    },
    async () => {
      calls += 1;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              sessionId,
              calls,
              memoryKeys: [...memory.keys()],
              note: "有状态：同一 mcp-session-id 共享 memory；换 session 则清空",
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description: "把 key/value 写入本 MCP session 内存（演示有状态，非常规无状态 REST）。",
      inputSchema: {
        key: z.string().describe("键"),
        value: z.string().describe("值"),
      },
    },
    async ({ key, value }) => {
      calls += 1;
      memory.set(key, value);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, sessionId, key, value, size: memory.size }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "recall",
    {
      title: "Recall",
      description: "从本 MCP session 内存读取 key（需同一 session；断开会话后丢失）。",
      inputSchema: {
        key: z.string().describe("键"),
      },
    },
    async ({ key }) => {
      calls += 1;
      const hit = memory.has(key);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              sessionId,
              key,
              found: hit,
              value: hit ? memory.get(key) : null,
            }),
          },
        ],
        isError: !hit,
      };
    },
  );

  return { server, memory, getCalls: () => calls };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleMcp(req, res) {
  const sessionHeader = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;

  if (req.method === "DELETE") {
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId);
      sessions.delete(sessionId);
      await s.transport.close().catch(() => undefined);
      await s.server.close().catch(() => undefined);
      sendJson(res, 200, { ok: true, closed: sessionId });
      return;
    }
    sendJson(res, 404, { ok: false, error: "unknown_session" });
    return;
  }

  if (req.method === "GET") {
    // 教学简化：不启独立 SSE 订阅；工具调用走 POST JSON
    res.writeHead(405, { Allow: "POST, DELETE" });
    res.end("Method Not Allowed");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST, DELETE" });
    res.end("Method Not Allowed");
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error" },
      id: null,
    });
    return;
  }

  try {
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId);
      await s.transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      const newId = randomUUID();
      const created = createSessionServer(newId);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newId,
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          console.error("[remote-http] session initialized:", id);
        },
      });
      transport.onclose = () => {
        sessions.delete(newId);
        console.error("[remote-http] session closed:", newId);
      };
      await created.server.connect(transport);
      sessions.set(newId, {
        transport,
        server: created.server,
        memory: created.memory,
      });
      await transport.handleRequest(req, res, body);
      return;
    }

    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message:
          "Bad Request: 需要先 initialize（无 mcp-session-id），或带上有效的 mcp-session-id",
      },
      id: null,
    });
  } catch (err) {
    console.error("[remote-http] handle error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      transport: "streamable-http",
      stateful: true,
      endpoint: `http://${HOST}:${PORT}${PATH}`,
      sessions: sessions.size,
    });
    return;
  }

  if (url.pathname === PATH) {
    await handleMcp(req, res);
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
    hint: `MCP endpoint is POST ${PATH}; health is GET /health`,
  });
});

server.listen(PORT, HOST, () => {
  console.error(
    `remote-http MCP listening http://${HOST}:${PORT}${PATH} (stateful Streamable HTTP)`,
  );
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
