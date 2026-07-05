/**
 * SSE Demo Server
 *
 * 糖哥的 SSE 学习 Demo
 * 演示三种场景：
 * 1. 基本 SSE 推送（定时事件）
 * 2. 模拟 LLM 流式输出（打字机效果）
 * 3. 通过 fetch API 实现 SSE（支持自定义请求头）
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3456

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const pathname = url.pathname

  // ---- 静态文件服务（HTML 页面） ----
  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'index.html')
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(fs.readFileSync(filePath))
    } else {
      res.writeHead(404)
      res.end('Not Found')
    }
    return
  }

  // =============================================
  // 1️⃣ 基本 SSE 端点 - 定时推送数字
  // =============================================
  if (pathname === '/events') {
    // 设置 SSE 必需的响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',    // SSE 专用 MIME 类型
      'Cache-Control': 'no-cache',            // 禁止缓存
      'Connection': 'keep-alive',             // 保持长连接
      'Access-Control-Allow-Origin': '*',     // 允许跨域
    })

    console.log(`[SSE] 客户端已连接`)

    // 发送一个初始连接成功事件
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE 连接成功！', time: new Date().toISOString() })}\n\n`)

    let count = 0
    const intervalId = setInterval(() => {
      count++
      const data = {
        id: count,
        message: `第 ${count} 条推送`,
        timestamp: new Date().toISOString(),
      }
      // SSE 格式: data: <json>\n\n
      res.write(`id: ${count}\ndata: ${JSON.stringify(data)}\n\n`)
      console.log(`[SSE] 推送消息 #${count}`)

      if (count >= 10) {
        clearInterval(intervalId)
        // 发送完成事件
        res.write(`event: done\ndata: 全部消息推送完成\n\n`)
        console.log(`[SSE] 推送完毕`)
        res.end()
      }
    }, 1000)

    // 客户端断开连接时清理资源
    req.on('close', () => {
      clearInterval(intervalId)
      console.log(`[SSE] 客户端断开连接`)
    })

    return
  }

  // =============================================
  // 2️⃣ 模拟 LLM 流式输出（打字机效果）
  // =============================================
  if (pathname === '/chat') {
    const text = url.searchParams.get('text') || '你好！我是 AI 助手，这是一段流式输出的演示文本。SSE 技术让服务器可以逐字推送内容，客户端收到后立即渲染，实现打字机效果。'

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    console.log(`[Chat] 开始流式输出，文本长度: ${text.length}`)

    let index = 0
    const speed = 80 // 每个字的间隔（毫秒）

    const intervalId = setInterval(() => {
      if (index < text.length) {
        // 模拟 LLM 逐字输出
        const char = text[index]
        res.write(`data: ${JSON.stringify({ token: char, index })}\n\n`)
        index++
      } else {
        clearInterval(intervalId)
        // 发送 [DONE] 标志，类似 OpenAI API 的结束标记
        res.write(`event: done\ndata: [DONE]\n\n`)
        console.log(`[Chat] 流式输出完成`)
        res.end()
      }
    }, speed)

    req.on('close', () => {
      clearInterval(intervalId)
      console.log(`[Chat] 客户端断开连接，已清理`)
    })

    return
  }

  // =============================================
  // 3️⃣ 通过 fetch API 实现的 SSE（支持自定义请求头）
  // =============================================
  if (pathname === '/fetch-sse') {
    // 这里演示如何通过请求头传递自定义参数
    const auth = req.headers['authorization'] || 'no-auth'
    const customHeader = req.headers['x-custom-header'] || 'no-custom-header'

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    console.log(`[Fetch-SSE] 收到自定义请求头: Authorization=${auth}, X-Custom-Header=${customHeader}`)

    // 先确认收到自定义头
    res.write(`event: auth\ndata: ${JSON.stringify({ auth, customHeader, message: '自定义请求头已收到！' })}\n\n`)

    // 然后正常推送
    const messages = [
      '使用 fetch API 也能实现 SSE！',
      '这样可以自定义请求头。',
      '比如传递 Token 进行鉴权。',
      '还可以传 POST 请求体。',
      '灵活性比 EventSource 高很多！',
    ]

    messages.forEach((msg, i) => {
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ index: i + 1, message: msg })}\n\n`)
        if (i === messages.length - 1) {
          setTimeout(() => {
            res.write(`event: done\ndata: 全部完成\n\n`)
            res.end()
          }, 300)
        }
      }, (i + 1) * 800)
    })

    req.on('close', () => {
      console.log(`[Fetch-SSE] 客户端断开连接`)
    })

    return
  }

  // ---- 404 ----
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not Found' }))
})

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║        SSE Demo Server 已启动         ║
╠═══════════════════════════════════════╣
║  浏览器打开:                          ║
║  http://localhost:${PORT}             ║
╚═══════════════════════════════════════╝
  `)
})
