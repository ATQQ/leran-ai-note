/**
 * 最小 MCP Server 演示（stdio）
 *
 * 演示三类能力：
 * - Tools:      echo / add（可调用动作）
 * - Resources:  demo://notes/welcome（可读参考内容）
 * - Prompts:    standup（一键提示模板）
 *
 * 重要：stdio 模式下不要用 console.log（会污染 JSON-RPC），
 * 日志只能打到 console.error。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "learn-ai-note-demo",
  version: "1.0.0",
});

// ---------- Tools：模型可通过 tool_call 调用 ----------
server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "把输入原样返回。用于验证 MCP tool 调用链路是否通。",
    inputSchema: {
      text: z.string().describe("要回显的文本"),
    },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo: ${text}` }],
  })
);

server.registerTool(
  "add",
  {
    title: "Add two numbers",
    description: "计算两个数字之和。",
    inputSchema: {
      a: z.number().describe("第一个加数"),
      b: z.number().describe("第二个加数"),
    },
  },
  async ({ a, b }) => {
    const sum = a + b;
    return {
      content: [{ type: "text", text: `${a} + ${b} = ${sum}` }],
    };
  }
);

// ---------- Resources：可读数据，不是工具说明书 ----------
server.registerResource(
  "welcome-note",
  "demo://notes/welcome",
  {
    title: "Welcome Note",
    description: "一份演示用参考笔记（Resource）",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: [
          "这是 MCP Resource 示例内容。",
          "它不是 Tool 的参数说明，而是给模型当 Context 原料的参考文本。",
          "面试一句话：Resources = 可读数据；Tools = 可执行动作。",
        ].join("\n"),
      },
    ],
  })
);

// ---------- Prompts：一键套用的提示模板 ----------
server.registerPrompt(
  "standup",
  {
    title: "Daily standup",
    description: "生成一段日报 standup 提示（带日期参数）",
    argsSchema: {
      date: z.string().describe("日期，例如 2026-07-24"),
    },
  },
  async ({ date }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `请按日报格式总结 ${date} 的工作：昨天完成、今天计划、阻塞项。简洁分点。`,
        },
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout 专给协议；日志走 stderr
  console.error("learn-ai-note-demo MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
