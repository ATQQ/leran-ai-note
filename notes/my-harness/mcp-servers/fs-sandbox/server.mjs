/**
 * fs-sandbox · 最小「文件读写」MCP Server（stdio）
 *
 * 注册位置：本文件 server.registerTool(...) —— 这就是「tools 在哪注册」。
 * Host（my-harness）只负责 spawn 本进程 + tools/list/call，不实现读写逻辑。
 *
 * 沙箱：所有路径限制在 ./workspace/ 下，禁止 .. 逃逸。
 * 日志只能 console.error（stdout 留给 JSON-RPC）。
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(__dirname, "workspace");
mkdirSync(WORKSPACE, { recursive: true });

/** 相对路径 → workspace 内绝对路径；拒绝逃逸 */
function resolveSafe(relPath) {
  const cleaned = String(relPath ?? "")
    .trim()
    .replace(/^[/\\]+/, "");
  if (!cleaned) throw new Error("path 不能为空");
  if (cleaned.split(/[/\\]/).includes("..")) {
    throw new Error("禁止使用 .. 逃出沙箱");
  }
  const full = resolve(WORKSPACE, cleaned);
  const root = WORKSPACE.endsWith(sep) ? WORKSPACE : WORKSPACE + sep;
  if (full !== WORKSPACE && !full.startsWith(root)) {
    throw new Error("路径超出 workspace 沙箱");
  }
  return full;
}

const server = new McpServer({
  name: "my-harness-fs-sandbox",
  version: "1.0.0",
});

// ---------- Tools 注册（Host list_tools 看到的就是这些）----------

server.registerTool(
  "list_files",
  {
    title: "List files",
    description:
      "列出沙箱 workspace 目录下的文件名（相对路径）。可选子目录 relativeDir。",
    inputSchema: {
      relativeDir: z
        .string()
        .optional()
        .describe("相对 workspace 的子目录，默认根目录"),
    },
  },
  async ({ relativeDir }) => {
    const dir = relativeDir ? resolveSafe(relativeDir) : WORKSPACE;
    if (!existsSync(dir)) {
      return {
        content: [{ type: "text", text: `目录不存在: ${relativeDir || "."}` }],
        isError: true,
      };
    }
    const names = readdirSync(dir, { withFileTypes: true }).map((d) =>
      d.isDirectory() ? d.name + "/" : d.name,
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { workspace: "mcp-servers/fs-sandbox/workspace", dir: relativeDir || ".", entries: names },
            null,
            2,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "read_file",
  {
    title: "Read file",
    description: "读取沙箱内文本文件。path 为相对 workspace 的路径，如 notes/hello.txt",
    inputSchema: {
      path: z.string().describe("相对 workspace 的文件路径"),
    },
  },
  async ({ path: rel }) => {
    try {
      const full = resolveSafe(rel);
      if (!existsSync(full)) {
        return {
          content: [{ type: "text", text: `文件不存在: ${rel}` }],
          isError: true,
        };
      }
      const text = readFileSync(full, "utf8");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ path: rel, bytes: Buffer.byteLength(text), content: text }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "write_file",
  {
    title: "Write file",
    description:
      "写入沙箱内文本文件（覆盖）。自动创建中间目录。path 相对 workspace。",
    inputSchema: {
      path: z.string().describe("相对 workspace 的文件路径"),
      content: z.string().describe("要写入的文本内容"),
    },
  },
  async ({ path: rel, content }) => {
    try {
      const full = resolveSafe(rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              path: rel,
              bytes: Buffer.byteLength(content, "utf8"),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: String(err instanceof Error ? err.message : err) }],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("fs-sandbox MCP server running · workspace=" + WORKSPACE);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
