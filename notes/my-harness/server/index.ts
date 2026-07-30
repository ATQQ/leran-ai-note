/**
 * my-harness HTTP 演示 Server
 *
 * 职责：
 * 1. 托管 web/ 静态资源（每阶段独立目录）
 * 2. POST /api/run：调用 kernel，以 SSE 推送 RunEvent
 * 3. 读取 .env 中的模型密钥（绝不下发到浏览器）
 * 4. 将脱敏后的 Trace 写入 traces/
 *
 * 启动：npm run demo → http://127.0.0.1:8787/web/index/index.html
 */
import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createOpenAIAdapter, openaiToolsSchemaForTrace } from "../src/adapters/openai.ts";
import { runAgent } from "../src/kernel/loop.ts";
import { MOCK_TOOLS, executeMockTool } from "../src/kernel/tools.ts";
import { loadEnv, packageRootFrom } from "../src/load-env.ts";
import { TraceRecorder } from "../src/trace.ts";
import type { RunEvent } from "../src/types.ts";

const ROOT = packageRootFrom(import.meta.url);
loadEnv(ROOT);

const PORT = Number(process.env.PORT || 8787);
const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
  /\/$/,
  "",
);
const KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

/** 写一条 SSE 帧：event 名 + JSON data（注意末尾空行） */
function writeSse(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 静态文件服务。
 * - `/` → 索引页
 * - 若 URL 指向目录，回落到该目录下的 index.html（避免 EISDIR 崩溃）
 * - 禁止 `..` 越出包根
 */
function serveStatic(urlPath: string, res: http.ServerResponse): boolean {
  let rel = urlPath === "/" ? "/web/index/index.html" : urlPath;
  if (rel.includes("..")) {
    sendJson(res, 400, { error: "invalid path" });
    return true;
  }
  let filePath = resolve(ROOT, rel.replace(/^\//, ""));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) return false;
  const st = statSync(filePath);
  if (st.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return false;
    filePath = indexPath;
  } else if (!st.isFile()) {
    return false;
  }
  const mime = MIME[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(filePath));
  return true;
}

// 外层包一层 catch：单次请求异常不应打崩整个进程
const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "internal error" });
    } else {
      res.end();
    }
  });
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  // CORS 预检（本地打开 file:// 或跨端口时可能用到）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // 健康检查：不回传 Key，只说明是否已配置
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      model: MODEL,
      baseUrl: BASE,
      hasKey: Boolean(KEY) && !KEY.includes("xxx"),
    });
    return;
  }

  // 供页面 Trace 回放区加载最近一次运行结果
  if (req.method === "GET" && pathname === "/api/trace/latest") {
    const p = join(ROOT, "traces", "openai-latest.json");
    if (!existsSync(p)) {
      sendJson(res, 404, { error: "no trace yet" });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(readFileSync(p));
    return;
  }

  // 主入口：流式跑一轮 Agent
  if (req.method === "POST" && pathname === "/api/run") {
    if (!KEY || KEY.includes("xxx")) {
      sendJson(res, 500, {
        error: "缺少 OPENAI_API_KEY。请复制 .env.example 为 .env 并填写。",
      });
      return;
    }

    // 默认固定演示 prompt（与 PLAN 回归用例一致）
    let prompt =
      "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。";
    let maxSteps = 8;
    try {
      const raw = await readBody(req);
      if (raw) {
        const parsed = JSON.parse(raw) as { prompt?: string; maxSteps?: number };
        if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
          prompt = parsed.prompt.trim();
        }
        if (typeof parsed.maxSteps === "number" && parsed.maxSteps > 0) {
          maxSteps = parsed.maxSteps;
        }
      }
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }

    // 先写 SSE 头，再边跑边推事件
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // 浏览器断开连接 → abort → loop / fetch 停止
    const ac = new AbortController();
    req.on("close", () => ac.abort());

    const adapter = createOpenAIAdapter({
      baseUrl: BASE,
      apiKey: KEY,
      model: MODEL,
    });
    const trace = new TraceRecorder({
      provider: "openai",
      model: MODEL,
      baseUrl: BASE,
      toolsSchema: openaiToolsSchemaForTrace(MOCK_TOOLS),
    });

    const onEvent = (event: RunEvent) => {
      // text_delta 只推前端，不写入 Trace；stream_detail 等其余事件落盘
      if (event.type !== "text_delta") {
        trace.addFromEvent(event);
      }
      writeSse(res, event.type, event);
    };

    writeSse(res, "meta", { model: MODEL, adapter: "openai" });

    try {
      const result = await runAgent({
        prompt,
        tools: MOCK_TOOLS,
        executeTool: executeMockTool,
        adapter,
        maxSteps,
        signal: ac.signal,
        onEvent,
      });
      trace.finish({
        finalAnswer: result.finalText,
        stopReason: result.stopReason,
      });
      const path = trace.write(join(ROOT, "traces"), "openai");
      // done：前端据此结束 UI 状态并加载 Trace
      writeSse(res, "done", {
        finalText: result.finalText,
        stopReason: result.stopReason,
        tracePath: path,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      if (name !== "AbortError") {
        onEvent({
          type: "error",
          phase: "error",
          title: "运行失败",
          summary: message,
          actor: "harness",
          direction: "local",
          payload: { error: message },
          at: new Date().toISOString(),
        });
        trace.finish({ error: message });
        try {
          trace.write(join(ROOT, "traces"), "openai");
        } catch {
          /* 写盘失败不影响响应结束 */
        }
        writeSse(res, "done", { error: message, stopReason: "error" });
      } else {
        writeSse(res, "done", { stopReason: "aborted" });
      }
    }

    res.end();
    return;
  }

  if (req.method === "GET" && serveStatic(pathname, res)) return;

  sendJson(res, 404, { error: "Not Found" });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`my-harness demo: http://127.0.0.1:${PORT}/web/index/index.html`);
  console.log(`health: http://127.0.0.1:${PORT}/api/health`);
  console.log(`model: ${MODEL} @ ${BASE}`);
});
