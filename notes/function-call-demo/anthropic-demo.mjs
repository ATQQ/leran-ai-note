/**
 * Anthropic Messages · Tool Use 演示
 * 结束后写入 traces/anthropic-latest.json，可用 viewer.html 回放。
 */
import { loadEnv } from "./load-env.mjs";
import { runTool, logSection, logJson } from "./tools.mjs";
import { TraceRecorder } from "./trace.mjs";

loadEnv();

const BASE = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const USER_AGENT = "claude-cli/2.1.170 (external, sdk-ts, agent-sdk/0.3.170)";

if (!KEY || KEY.includes("xxx")) {
  console.error("请先配置 .env：ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / ANTHROPIC_MODEL");
  process.exit(1);
}

const tools = [
  {
    name: "get_weather",
    description: "查询指定城市的当前天气（演示用本地假数据）",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名，如 北京、上海" },
      },
      required: ["city"],
      // JSON Schema：禁止声明之外的额外字段（Anthropic 侧对应 OpenAI 的 parameters）
      additionalProperties: false,
    },
  },
  {
    name: "add",
    description: "计算两个数字之和",
    input_schema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
  },
];

const SYSTEM = "你是助手。需要天气或加法时必须调用工具，不要编造工具结果。";

const trace = new TraceRecorder({
  provider: "anthropic",
  model: MODEL,
  baseUrl: BASE,
  userAgent: USER_AGENT,
  toolsSchema: tools,
});

async function messagesCreate(messages, roundLabel) {
  const url = `${BASE}/v1/messages`;
  const body = {
    model: MODEL,
    max_tokens: 1024,
    tools,
    messages,
    system: SYSTEM,
    // Anthropic 对应 OpenAI 的 tool_choice：
    // auto=模型自决；any=必须用工具；tool=强制某个工具；none=禁止
    // 省略时默认 auto
    tool_choice: { type: "auto" },
  };

  trace.addStep({
    phase: "request_model",
    title: `${roundLabel} · 请求模型`,
    summary: `POST ${url}，system + messages + tools(input_schema)`,
    actor: "harness",
    direction: "out",
    payload: {
      method: "POST",
      url,
      headers: {
        "x-api-key": "[REDACTED]",
        "anthropic-version": VERSION,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body,
    },
  });

  logJson(`REQUEST ${roundLabel}`, { url, model: MODEL, messageCount: messages.length });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": KEY,
      "anthropic-version": VERSION,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    trace.addStep({
      phase: "error",
      title: `${roundLabel} · 请求失败`,
      summary: `HTTP ${res.status}`,
      actor: "model",
      direction: "in",
      payload: data,
    });
    logJson("ERROR", data);
    throw new Error(`HTTP ${res.status}`);
  }

  const toolUses = (data.content || []).filter((b) => b.type === "tool_use");
  trace.addStep({
    phase: "model_response",
    title: `${roundLabel} · 模型响应`,
    summary: toolUses.length
      ? `stop_reason=${data.stop_reason}，含 ${toolUses.length} 个 tool_use`
      : `stop_reason=${data.stop_reason}，无 tool_use`,
    actor: "model",
    direction: "in",
    payload: {
      httpStatus: res.status,
      id: data.id,
      stop_reason: data.stop_reason,
      usage: data.usage ?? null, // token 用量，非敏感，回放页会完整展示
      content: data.content,
    },
    note: toolUses.length
      ? "Anthropic：调用意图在 content[] 的 tool_use 块中"
      : null,
  });

  return data;
}

async function main() {
  logSection("Anthropic Tool Use Demo");

  const messages = [
    {
      role: "user",
      content: "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。",
    },
  ];

  trace.addStep({
    phase: "init",
    title: "初始化 Context",
    summary: "Anthropic：system 为顶层字段；messages 从 user 开始",
    actor: "harness",
    direction: "local",
    payload: { system: SYSTEM, messages: structuredClone(messages), tools },
  });

  let data = await messagesCreate(messages, "ROUND1");
  const content = data.content || [];
  const toolUses = content.filter((b) => b.type === "tool_use");

  if (toolUses.length === 0) {
    const text = content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    trace.addStep({
      phase: "final_answer",
      title: "最终回答（未调工具）",
      summary: "模型直接文本回复",
      actor: "model",
      direction: "in",
      payload: { content: text },
    });
    trace.finish({ finalAnswer: text });
    const path = trace.write("anthropic");
    console.log("\n最终内容：", text);
    console.log("轨迹已写入：", path);
    return;
  }

  messages.push({ role: "assistant", content });

  const toolResults = [];
  for (const block of toolUses) {
    trace.addStep({
      phase: "execute_tool",
      title: `执行工具 · ${block.name}`,
      summary: `id=${block.id}`,
      actor: "tool",
      direction: "local",
      payload: { tool_use_id: block.id, name: block.name, input: block.input },
    });

    const result = await runTool(block.name, block.input || {});
    logJson(`EXECUTE ${block.name}`, { id: block.id, input: block.input, result });

    const toolResult = {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(result),
    };
    toolResults.push(toolResult);

    trace.addStep({
      phase: "append_tool_result",
      title: `组装 tool_result · ${block.name}`,
      summary: "将写入下一条 user.content[]（Anthropic 格式）",
      actor: "harness",
      direction: "local",
      payload: { toolResult, result },
    });
  }

  messages.push({ role: "user", content: toolResults });

  trace.addStep({
    phase: "append_tool_result",
    title: "回灌 user(tool_result[])",
    summary: "Anthropic：工具结果放在 user 消息的 content 数组中",
    actor: "harness",
    direction: "local",
    payload: { messagesTail: messages.slice(-2) },
    note: "与 OpenAI 的 role=tool 不同",
  });

  data = await messagesCreate(messages, "ROUND2");
  const finalText = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  trace.addStep({
    phase: "final_answer",
    title: "最终回答",
    summary: "基于 tool_result 生成自然语言回复",
    actor: "model",
    direction: "in",
    payload: {
      content: finalText,
      stop_reason: data.stop_reason,
      has_more_tool_use: (data.content || []).some((b) => b.type === "tool_use"),
    },
  });

  trace.finish({ finalAnswer: finalText });
  const path = trace.write("anthropic");

  logSection("FINAL ANSWER");
  console.log(finalText || "(empty)");
  console.log("\n轨迹 JSON：", path);
  console.log("回放：npm run viewer → http://127.0.0.1:8765/viewer.html");
}

main().catch((e) => {
  try {
    trace.addStep({
      phase: "error",
      title: "运行失败",
      summary: String(e?.message || e),
      actor: "harness",
      direction: "local",
      payload: { error: String(e) },
    });
    trace.finish({ error: String(e) });
    console.error("轨迹（含错误）已写入：", trace.write("anthropic"));
  } catch {
    /* ignore */
  }
  console.error(e);
  process.exit(1);
});
