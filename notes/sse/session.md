# SSE 学习 - 沟通过程记录

> 日期：2026-07-05
> 对话人：糖哥 & Claude

## 对话内容

### Q1: SSE 是什么？流式输出是怎么样的？

**回答要点：**
- SSE（Server-Sent Events）是服务器主动向客户端推送数据的 HTTP 技术
- 流式输出就是边生成边推送，客户端边接收边渲染（打字机效果）
- 对比了传统请求 vs 流式输出的时间线差异

### Q2: SSE 有什么限制？

**8 大限制总结：**
1. 单向通信（服务端→客户端）
2. 浏览器连接数限制（HTTP/1.1 下 6 个）
3. 不支持二进制数据
4. 浏览器兼容性（IE 不支持）
5. 跨域限制（但 Cookie 可通过 `{ withCredentials: true }` 跨域携带）
6. 只能 GET 请求（EventSource API）
7. 连接稳定性（移动端网络切换）
8. 代理服务器缓冲问题（Nginx 需关 buffering）

### Q3: EventSource 能否携带自定义请求头？如何鉴权？

**回答要点：**
- `EventSource` 不能自定义请求头（如 `Authorization`）
- 鉴权方式有三种：
  1. **URL Query 传 Token** — `new EventSource('/events?token=xxx')`，最简单但 Token 暴露在 URL
  2. **Cookie 鉴权** — 同域自动带，跨域需 `{ withCredentials: true }`
  3. **fetch + ReadableStream** — 最灵活，支持任意请求头

### Q4: 跨域 Cookie 到底能不能带？（纠错环节）

- ✅ **能带**！`EventSource` 支持 `withCredentials` 参数
- 写法：`new EventSource('https://api.example.com/events', { withCredentials: true })`
- 服务端要求：`Access-Control-Allow-Origin` 必须是具体域名（不能是 `*`）+ `Access-Control-Allow-Credentials: true`
- 笔记中先写"不支持"后写"支持"造成矛盾，已修正 ✅

### Q5: SSE 必须 \n\n 结尾吗？多行 data 是后端发多次吗？

**回答要点：**
- **必须 `\n\n` 结尾**，这是协议规定的消息边界，缺了浏览器不触发事件
- 多行 data 的 `\n` 只是行继续，`\n\n` 才是消息结束
- 多行 data **可以分多次 `res.write()` 发送**，也可以一次发完，效果一样
- 关键规律：浏览器只看流里 `\n\n` 的位置来切分消息，不关心分几次 `res.write()`

```javascript
// ✅ 正确：分 3 次发，1 条消息
res.write(`data: {\n`)
res.write(`data: "msg":"hi"\n`)
res.write(`data: }\n\n`)  // ← \n\n 消息结束

// ❌ 错误：变成 3 条独立消息
res.write(`data: {\n\n`)
res.write(`data: "msg":"hi"\n\n`)
res.write(`data: }\n\n`)
```

- 已补充到 README 协议格式章节 ✅

### 动手 Demo

在 `leran-ai-note` 项目中创建了 SSE 笔记目录，包含：

| 文件 | 说明 |
|------|------|
| `notes/sse/README.md` | SSE 完整学习笔记 |
| `notes/sse/demo/server.mjs` | 三种模式的 SSE 服务端 |
| `notes/sse/demo/index.html` | 带 UI 的 Demo 页面 |
| `notes/sse/session.md` | 本对话记录 |

### 三个 Demo

1. **标准 SSE** — 使用 `EventSource` API，定时推送 10 条消息
2. **LLM 流式输出** — 模拟 AI 逐字输出，打字机效果
3. **Fetch SSE** — 用 `fetch` + `ReadableStream` 实现，支持自定义请求头

### 启动方式

```bash
cd /Users/sugar/Documents/fe/leran-ai-note/notes/sse/demo
node server.mjs
# 浏览器打开 http://localhost:3456
```
