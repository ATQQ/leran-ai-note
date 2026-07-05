# SSE (Server-Sent Events) 学习笔记

> 糖哥的 SSE 学习记录，包含原理、限制、Demo 和最佳实践

***

## 目录

1. [什么是 SSE](#什么是-sse)
2. [SSE 的协议格式](#sse-的协议格式)
3. [SSE 的限制](#sse-的限制)
4. [与 WebSocket 对比](#与-websocket-对比)
5. [Demo 说明](#demo-说明)
6. [最佳实践](#最佳实践)
7. [常见问题](#常见问题)

***

## 什么是 SSE

**SSE (Server-Sent Events)** 是一种基于 HTTP 的服务器推送技术，允许服务器主动向客户端推送数据。它是 HTML5 标准的一部分，通过 `EventSource` API 在浏览器中使用。

### 核心特点

| 特性          | 说明                           |
| ----------- | ---------------------------- |
| **单向通信**    | 服务器 → 客户端（区别于 WebSocket 的双向） |
| **基于 HTTP** | 无需额外协议，复用现有 HTTP 连接          |
| **自动重连**    | 连接断开时浏览器会自动尝试重连              |
| **文本协议**    | 使用纯文本格式，UTF-8 编码             |

### 工作流程

客户端                         服务器

&#x20; │                              │

&#x20; ├────── HTTP GET /events ──────┤

&#x20; │                              │

&#x20; │◄──── 200 OK (text/event-stream)

&#x20; │◄──── data: 第1条消息\n\n      │

&#x20; │◄──── data: 第2条消息\n\n      │

&#x20; │◄──── data: 第3条消息\n\n      │

&#x20; │◄──── event: done\n\n         │

&#x20; │                              │

&#x20; └── 连接关闭 ──────────────────┘

***

## SSE 的协议格式

### 基本格式

```
data: 消息内容\n\n
```

每个字段以 `field: value` 形式，以两个换行符 `\n\n` 结束。

### 完整字段

```
event: 事件类型      ← 自定义事件名（可选）
id: 消息ID          ← 用于重连时断点续传（可选）
retry: 3000         ← 重连间隔（毫秒，可选）
data: JSON数据      ← 消息正文（必需）

```

### 关于 \n\n 的详细说明

**SSE 协议规定每条消息必须以两个换行符 `\n\n` 结尾**，这是浏览器判定消息结束的唯一边界。

```
收到流:  "data: hello\n\n"
                         ↑↑
              浏览器在这里触发 onmessage
```

常见问题：

```javascript
// ✅ 正确：带 \n\n 结尾
res.write(`data: hello\n\n`)  // 浏览器立即触发 onmessage

// ❌ 错误：只有一个 \n，浏览器会一直等
res.write(`data: hello\n`)    // 永不触发，卡住

// ✅ 也支持 \r\n\r\n（Windows 风格）
res.write(`data: hello\r\n\r\n`)
```

> **为什么 fetch 自实现 SSE 时用 `split('\n\n')` 切分消息？**
>
> 因为 TCP 流可能粘包，服务端多次 `res.write()` 可能合并成一次接收。用 `\n\n` 切割是最可靠的按消息边界切分的方式。

### 多行 data

多行 data 用于发送包含换行的 JSON 或长文本：

```
data: {\n
data: "message": "你好",\n
data: "count": 1\n
data: }\n\n
```

浏览器收到后会去掉每行的 `data: ` 前缀，拼接成一条完整消息：`{"message":"你好","count":1}`

**关键点：多行 data 的底层原理**

多行 data **不是**独立的多条消息，而是**一条消息跨多个 `res.write()` 分批发**：

```javascript
// ✅ 正确：分 3 次发送，浏览器拼成 1 条消息
res.write(`data: {\n`)           // ← 只有 \n，消息还没结束
res.write(`data: "msg":"hi"\n`)  // ← 只有 \n，继续等
res.write(`data: }\n\n`)         // ← \n\n 消息结束！
```

浏览器收到的完整字节流是：
```
data: {\ndata: "msg":"hi"\ndata: }\n\n
```

它在流里一直找 `\n\n`，找到后把前面的所有 `data:` 行拼起来，触发 **一次** `onmessage`。

**与之对比的错误用法：**

```javascript
// ❌ 错误：每条都带 \n\n，变成 3 条独立消息
res.write(`data: {\n\n`)           // 消息1: "{"
res.write(`data: "msg":"hi"\n\n`)  // 消息2: ""msg":"hi""
res.write(`data: }\n\n`)           // 消息3: "}"
```

**对比总结：**

| 写法 | 结果 | 说明 |
|------|------|------|
| `data: a\n` + `data: b\n\n` | **1 条消息** `a\nb` ✅ | 多行 data，分开写，浏览器拼起来 |
| `data: a\ndata: b\n\n` | **1 条消息** `a\nb` ✅ | 一次写完，结果一样 |
| `data: a\n\n` + `data: b\n\n` | **2 条消息** `a` 和 `b` ❌ | 每条独立，不是多行 |

> **核心规律：** `\n` 只表示行继续，`\n\n` 才表示消息结束。不管分几次 `res.write()`，浏览器只看流里 `\n\n` 的位置来切分消息。

### 注释

以冒号开头的行为注释行，被客户端忽略：

```
: 这是注释
```

常用于**心跳保活**：

```
: heartbeat\n\n
```

注意：注释行**也需要 `\n\n` 结尾**，但不会触发 `onmessage` 事件。

***

## SSE 的限制

### 1️⃣ 单向通信

- 只能服务器 → 客户端，客户端无法通过同一连接向服务器发数据
- 如果需要双向通信（如聊天），得另开接口或改用 WebSocket

### 2️⃣ 浏览器连接数限制

- HTTP/1.1 下，**同域名最多 6 个 SSE 连接**
- HTTP/2 下最多 **100 个并发流**
- 多标签页打开时，每个标签页都算独立连接

> 💡 解决方案：使用 HTTP/2，或在应用层做连接复用

### 3️⃣ 不支持二进制数据

- SSE 协议只支持 **UTF-8 文本**
- 无法直接传 ArrayBuffer、Blob
- 要传二进制得先 Base64 编码，体积增大约 33%

### 4️⃣ 浏览器兼容性

- **IE 全系不支持**
- Edge 旧版（非 Chromium 版）不支持
- 需要 polyfill：[eventsource-polyfill](https://github.com/EventSource/eventsource)

```
npm install eventsource-polyfill
```

```javascript
import 'eventsource-polyfill'
const es = new EventSource('/events')
```

### 5️⃣ 跨域限制

- 默认受同源策略限制
- 跨域需要服务端设置 CORS：

```
Access-Control-Allow-Origin: https://your-domain.com
Access-Control-Allow-Credentials: true
```

- **Cookie 可以跨域携带** ✅，但需要两端配合：
  - 客户端：`new EventSource(url, { withCredentials: true })`
  - 服务端：`Access-Control-Allow-Origin` 不能是 `*`，必须是具体域名 + `Access-Control-Allow-Credentials: true`
- **自定义请求头（如 Authorization）跨域也不支持** ❌，这是 EventSource API 的限制，和跨域无关

### 6️⃣ 只能 GET 请求

- `EventSource` API 只支持 **GET** 方法
- 不能带自定义请求头（如 `Authorization: Bearer xxx`）

> 💡 解决方案：用 `fetch` + `ReadableStream` 自己解析 SSE 流（详见 Demo）

### 7️⃣ 连接稳定性

- 移动端网络切换（WiFi → 4G）会导致连接断开
- 自动重连间隔由浏览器控制，默认 3 秒，不可自定义
- 可以用 `retry:` 字段建议重连间隔，但浏览器不一定遵守

### 8️⃣ 代理服务器问题

Nginx 默认会缓冲响应，导致 SSE 流式数据卡住。需要关掉：

```nginx
location /events {
    proxy_pass http://backend;
    proxy_buffering off;         # 关掉缓冲
    proxy_cache off;             # 关掉缓存
    proxy_read_timeout 86400s;   # 长超时
}
```

***

## 与 WebSocket 对比

| 特性        | SSE                           | WebSocket        |
| --------- | ----------------------------- | ---------------- |
| 方向        | 服务器 → 客户端（单向）                 | 双向               |
| 协议        | HTTP                          | ws\:// / wss\:// |
| 自动重连      | ✅ 内置                          | ❌ 需手动实现          |
| 二进制数据     | ❌ 仅文本                         | ✅ 支持             |
| 连接数限制     | 6 个/域名 (HTTP/1.1)             | 无限制              |
| 实现复杂度     | ⭐ 低                           | ⭐⭐⭐ 中高           |
| 浏览器支持     | 除 IE 外良好                      | 良好               |
| 自定义请求头    | ❌ 不支持                         | ✅ 支持             |
| 跨域 Cookie | ✅ `{ withCredentials: true }` | ✅                |
| 使用场景      | 通知、推送、流式输出                    | 实时游戏、聊天、协作       |

### 选型建议

- **选 SSE 的场景**：AI 流式输出、实时通知、数据看板、日志推送
- **选 WebSocket 的场景**：在线聊天、实时协作编辑、多人游戏

***

## Demo 说明

项目位置：`/Users/sugar/Documents/fe/leran-ai-note/notes/sse/demo/`

### 启动方式

```bash
cd /Users/sugar/Documents/fe/leran-ai-note/notes/sse/demo
node server.mjs
```

浏览器打开 `http://localhost:3456`

### 三个 Demo

| Demo          | 技术                         | 说明                 |
| ------------- | -------------------------- | ------------------ |
| **标准 SSE**    | `EventSource` API          | 最原生的 SSE，定时推送消息    |
| **LLM 流式输出**  | `fetch` + `ReadableStream` | 模拟 AI 打字机效果，逐字推送   |
| **Fetch SSE** | `fetch` + `ReadableStream` | 支持自定义请求头（Token 鉴权） |

### Demo 2 核心代码（LLM 流式输出）

**服务端：**

```javascript
// 模拟 AI 逐字输出
let index = 0
const intervalId = setInterval(() => {
  if (index < text.length) {
    const char = text[index]
    res.write(`data: ${JSON.stringify({ token: char, index })}\n\n`)
    index++
  } else {
    clearInterval(intervalId)
    res.write(`event: done\ndata: [DONE]\n\n`)
    res.end()
  }
}, 80) // 80ms 一个字
```

**客户端：**

```javascript
const response = await fetch('/chat?text=...')
const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const text = decoder.decode(value, { stream: true })
  // 解析 SSE data: 格式，逐字渲染
}
```

***

## 最佳实践

### 1. 心跳保活

服务端定期发送注释行保持连接：

```javascript
setInterval(() => {
  res.write(': heartbeat\n\n')
}, 15000) // 每 15 秒
```

### 2. 重连策略

利用 `id` 字段实现断点续传：

```javascript
// 服务端
res.write(`id: ${lastMessageId}\ndata: ...\n\n`)

// 客户端 EventSource 会自动发送 Last-Event-ID 头
// 服务端可以据此从断点继续推送
```

### 3. 连接池管理

服务端记录所有 SSE 连接，统一管理：

```javascript
const clients = new Set()

app.get('/events', (req, res) => {
  // ... 设置 SSE 头
  clients.add(res)
  req.on('close', () => clients.delete(res))
})

// 广播消息给所有客户端
function broadcast(data) {
  for (const client of clients) {
    client.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}
```

### 4. 错误处理

```javascript
eventSource.onerror = (err) => {
  // 浏览器会自动重连，不需要手动处理
  // 但可以展示 UI 提示
  showReconnecting()
}

eventSource.addEventListener('connected', () => {
  hideReconnecting()
})
```

### 5. Nginx 配置

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    location /events {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 86400s;
    }
}
```

***

## 常见问题

### Q: 如何传 POST 请求？

用 `fetch` 自己实现 SSE 解析，不要用 `EventSource`。

### Q: 如何带 Token 鉴权？

三种方式：

1. **URL 参数**：`new EventSource('/events?token=xxx')` — 最简单，但 Token 会暴露在 URL（可能被服务器日志记录）
2. **Cookie**：同域自动带；跨域用 `new EventSource(url, { withCredentials: true })` — 更安全，不暴露在 URL
3. **自定义请求头**：用 `fetch` 自己实现（详见 Demo 3）— 最灵活，支持 `Authorization: Bearer xxx`

### Q: 连接断了怎么续传？

SSE 协议支持 `Last-Event-ID` 机制，服务端通过 `id:` 字段标记消息序号，重连时客户端自动发送上次收到的 ID。

### Q: 如何判断连接是否存活？

服务端定时发送心跳（注释行 `: heartbeat`），客户端监听 `onerror` 事件。

### Q: 能拿到 HTTP 响应头吗？

不能。`EventSource` 不暴露响应头信息，这也是推荐用 `fetch` 实现 SSE 的原因之一。

***

## 参考链接

- [MDN: Server-Sent Events](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events)
- [MDN: EventSource](https://developer.mozilla.org/zh-CN/docs/Web/API/EventSource)
- [HTML Living Standard: SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [EventSource Polyfill](https://github.com/EventSource/eventsource)

