/**
 * SSE Demo Server
 *
 * 糖哥的 SSE 学习 Demo
 * 演示三种场景：
 * 1. 基本 SSE 推送（定时事件）
 * 2. 模拟 LLM 流式输出（打字机效果）
 * 3. 通过 fetch API 实现 SSE（支持自定义请求头）
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3456;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ---- 静态文件服务（HTML 页面） ----
  if (pathname === "/" || pathname === "/index.html") {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
    return;
  }

  // =============================================
  // 1️⃣ 基本 SSE 端点 - 定时推送数字
  // =============================================
  if (pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const message = ["hello", "world", "sse", "demo"];
    res.write(`event: connect\ndata: 连接成功\n\n`);

    res.on("close", () => {
      console.log(`[SSE] 客户端断开连接`);
    });
    for (const msg of message) {
      res.write(
        `id: ${Date.now()}\ndata: ${JSON.stringify({
          message: msg,
        })}\n\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setTimeout(() => {
      res.write(`event: done\ndata: 完成\n\n`);
      res.end();
    }, 1000);
    return;
  }

  // ---- 404 ----
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║        SSE Demo Server 已启动         ║
╠═══════════════════════════════════════╣
║  浏览器打开:                          ║
║  http://localhost:${PORT}             ║
╚═══════════════════════════════════════╝
  `);
});
