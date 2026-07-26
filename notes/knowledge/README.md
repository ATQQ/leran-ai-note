# 经验与结论库（knowledge）

放**可复用的结论、面试话术、踩坑经验**——不是原始聊天记录。

学习过程（Sigma session / roadmap）仍在 `sigma/`；这里只收「提炼后能直接拿去用」的东西。

## 目录

| 路径 | 内容 |
|------|------|
| [ai-app-interview/](./ai-app-interview/) | Context / Harness / SKILL / MCP / Agent 全章结论 + 复习页 |
| [../mcp-demo/](../mcp-demo/) | 最小 stdio MCP Server 实操 |
| [../agent/](../agent/) | Prompt / Tool Use 早期笔记 |
| [../sigma-lerna-skill-mcp/](../sigma-lerna-skill-mcp/) | SKILL + MCP 原理笔记（另一轮学习） |
| [../sse/](../sse/) | SSE 相关笔记 |

## 怎么用

- **考前扫结论**：打开对应专题下的 `review.html` 或 `conclusions.md`
- **动手验证**：进 `mcp-demo/` 跑 Inspector
- **补新专题**：在本目录新建子文件夹，放 `README.md` + `conclusions.md`（可选 `review.html`）

## 约定

- `conclusions.md`：终局结论（Markdown，方便改）
- `review.html`：浏览器友好复习页（可选）
- `README.md`：本专题索引与外链
- 不把 `node_modules`、完整 session 日志堆进 knowledge
