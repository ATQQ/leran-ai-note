# Function Calling Demo

分别演示 **OpenAI Chat Completions** 与 **Anthropic Messages** 的工具调用格式差异。  
密钥与 Base URL 放在本地 `.env`，不要提交、不要贴到聊天里。

## 准备

```bash
cd notes/function-call-demo
cp .env.example .env
# 编辑 .env：填入 BASE_URL / API_KEY / MODEL
# 无第三方依赖，Node 18+ 即可直接运行
```

### `.env` 字段

| 变量 | 用途 |
|------|------|
| `OPENAI_BASE_URL` | OpenAI 兼容根路径，需含 `/v1`（请求会打到 `{BASE}/chat/completions`） |
| `OPENAI_API_KEY` | Bearer Token |
| `OPENAI_MODEL` | 模型名 |
| `ANTHROPIC_BASE_URL` | Anthropic 根路径（请求打到 `{BASE}/v1/messages`） |
| `ANTHROPIC_API_KEY` | `x-api-key` |
| `ANTHROPIC_MODEL` | 模型名 |
| `ANTHROPIC_VERSION` | `anthropic-version` 头，默认 `2023-06-01` |

若你的中转站把 Claude 也封装成 OpenAI 兼容格式，只需跑 `npm run openai`，把 Claude 模型名填进 `OPENAI_MODEL` 即可。

## 运行

```bash
node openai-demo.mjs      # 或 npm run openai
node anthropic-demo.mjs   # 或 npm run anthropic
```

跑完后会在 `traces/` 生成：

- `openai-latest.json` / `anthropic-latest.json`
- 带时间戳的备份副本

密钥在轨迹里会被脱敏为 `[REDACTED]`。

## 步骤回放（动画）

```bash
cd notes/function-call-demo
npm run viewer
# 浏览器打开 http://127.0.0.1:8765/viewer.html
# 端口可用 PORT=9000 npm run viewer 覆盖
```

也可直接打开 `viewer.html`，用「选择文件」加载 `traces/*.json`，或点「加载示例」。

操作：

- **上一步 / 下一步**，或键盘 `←` `→`
- **播放 / 暂停**，或空格键
- 左侧步骤列表可任意跳转

每步会高亮 Harness / Model / Tool，并展示该步请求或响应 JSON。

## 协议对照

| | OpenAI-compatible | Anthropic Messages |
|--|-------------------|--------------------|
| 端点 | `POST {base}/chat/completions` | `POST {base}/v1/messages` |
| 鉴权 | `Authorization: Bearer …` | `x-api-key` + `anthropic-version` |
| 工具声明 | `tools[].type=function` + `function.{name,description,parameters}` | `tools[].{name,description,input_schema}` |
| 模型输出 | `message.tool_calls[]`（`id/name/arguments` 字符串） | `content[]` 中 `type=tool_use`（`id/name/input` 对象） |
| 结果回灌 | `role: tool` + `tool_call_id` + `content` | 下一条 `user.content[]` 里放 `type=tool_result` |
| system | `messages` 里 `role=system` | 顶层字段 `system` |

共同点（与复习笔记一致）：

```
带 schema 请求模型
  → 解析结构化调用（不是解析思考文本）
  → 本地/远端执行工具
  → 结果写回消息历史
  → 再请求模型得到最终回答
```

## User-Agent

| Demo | User-Agent |
|------|------------|
| `openai-demo.mjs` | `codex_sdk_ts/0.144.5 (Mac OS 14.5.0; arm64) vscode/3.13.10 (codex_exec; 0.144.5)` |
| `anthropic-demo.mjs` | `claude-cli/2.1.170 (external, sdk-ts, agent-sdk/0.3.170)` |

## 文件

| 文件 | 说明 |
|------|------|
| `openai-demo.mjs` | OpenAI Function Calling 双轮循环 + 轨迹录制 |
| `anthropic-demo.mjs` | Anthropic Tool Use 双轮循环 + 轨迹录制 |
| `tools.mjs` | 本地假工具 `get_weather` / `add` |
| `trace.mjs` | 轨迹录制与脱敏 |
| `viewer.html` | 步骤动画回放页 |
| `serve-viewer.mjs` | Node 静态服务（`npm run viewer`） |
| `traces/sample-openai.json` | 离线示例轨迹 |
| `.env.example` | 配置模板 |

## 安全

- `.env` 已在 `.gitignore` 中忽略
- 轨迹中的密钥会脱敏为 `[REDACTED]`
- 不要把真实 Key 写进代码或提交仓库
- 演示工具为本地 mock，无外网副作用
