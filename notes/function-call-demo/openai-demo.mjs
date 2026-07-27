/**
 * OpenAI Chat Completions · Function Calling 演示
 * 结束后写入 traces/openai-latest.json，可用 viewer.html 回放。
 */
import { loadEnv } from "./load-env.mjs";
import { runTool, logSection, logJson } from "./tools.mjs";
import { TraceRecorder } from "./trace.mjs";

loadEnv();

const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const USER_AGENT =
  "codex_sdk_ts/0.144.5 (Mac OS 14.5.0; arm64) vscode/3.13.10 (codex_exec; 0.144.5)";

if (!KEY || KEY.includes("xxx")) {
  console.error("请先配置 .env：OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL");
  process.exit(1);
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询指定城市的当前天气（演示用本地假数据）",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "城市名，如 北京、上海" },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add",
      description: "计算两个数字之和",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
        additionalProperties: false,
      },
    },
  },
];

const trace = new TraceRecorder({
  provider: "openai",
  model: MODEL,
  baseUrl: BASE,
  userAgent: USER_AGENT,
  toolsSchema: tools,
});

async function chatCompletions(messages, roundLabel) {
  const url = `${BASE}/chat/completions`;
  const body = {
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  };

  trace.addStep({
    phase: "request_model",
    title: `${roundLabel} · 请求模型`,
    summary: `POST ${url}，携带 messages + tools schema`,
    actor: "harness",
    direction: "out",
    payload: {
      method: "POST",
      url,
      headers: {
        Authorization: "Bearer [REDACTED]",
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
      Authorization: `Bearer ${KEY}`,
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

  const msg = data.choices?.[0]?.message;
  trace.addStep({
    phase: "model_response",
    title: `${roundLabel} · 模型响应`,
    summary: msg?.tool_calls?.length
      ? `返回 ${msg.tool_calls.length} 个 tool_calls`
      : "返回最终文本（无 tool_calls）",
    actor: "model",
    direction: "in",
    payload: {
      httpStatus: res.status,
      usage: data.usage ?? null,
      message: msg,
      rawChoice: data.choices?.[0] ?? null,
    },
    note: msg?.tool_calls?.length
      ? "执行依据是结构化 tool_calls，不是思考文本"
      : null,
  });

  return { data, msg };
}

async function main() {
  logSection("OpenAI Function Calling Demo");

  const userPrompt =
    "帮我查一下深圳的天气，再用工具算一下 12 加 30，最后用中文简短总结。";

  const messages = [
    {
      role: "system",
      content: "你是助手。需要天气或加法时必须调用工具，不要编造工具结果。",
    },
    { role: "user", content: userPrompt },
  ];

  trace.addStep({
    phase: "init",
    title: "初始化 Context",
    summary: "组装 system + user，并准备 tools schema",
    actor: "harness",
    direction: "local",
    payload: { messages: structuredClone(messages), tools },
  });

  let { msg } = await chatCompletions(messages, "ROUND1");
  logJson("ROUND1 assistant", msg);
  if (!msg) throw new Error("无 choices[0].message");

  messages.push({
    role: "assistant",
    content: msg.content ?? null,
    tool_calls: msg.tool_calls,
  });

  const toolCalls = msg.tool_calls || [];
  if (toolCalls.length === 0) {
    trace.addStep({
      phase: "final_answer",
      title: "最终回答（未调工具）",
      summary: "模型直接文本回复",
      actor: "model",
      direction: "in",
      payload: { content: msg.content },
    });
    trace.finish({ finalAnswer: msg.content });
    const path = trace.write("openai");
    console.log("\n最终内容：", msg.content);
    console.log("轨迹已写入：", path);
    return;
  }

  for (const call of toolCalls) {
    const name = call.function?.name;
    let args = {};
    try {
      args = JSON.parse(call.function?.arguments || "{}");
    } catch {
      args = {};
    }

    trace.addStep({
      phase: "execute_tool",
      title: `执行工具 · ${name}`,
      summary: `id=${call.id}`,
      actor: "tool",
      direction: "local",
      payload: { tool_call_id: call.id, name, arguments: args },
    });

    const result = await runTool(name, args);
    logJson(`EXECUTE ${name}`, { id: call.id, args, result });

    const toolMsg = {
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result),
    };
    messages.push(toolMsg);

    trace.addStep({
      phase: "append_tool_result",
      title: `回灌 tool 消息 · ${name}`,
      summary: "role=tool，绑定 tool_call_id，写入 messages",
      actor: "harness",
      direction: "local",
      payload: { appended: toolMsg, result },
    });
  }

  ({ msg } = await chatCompletions(messages, "ROUND2"));
  logJson("ROUND2 assistant", msg);

  const finalAnswer = msg?.content || "";
  trace.addStep({
    phase: "final_answer",
    title: "最终回答",
    summary: "基于工具结果生成自然语言回复",
    actor: "model",
    direction: "in",
    payload: {
      content: finalAnswer,
      extra_tool_calls: msg?.tool_calls ?? null,
    },
    note: msg?.tool_calls?.length
      ? "若仍有 tool_calls，生产环境应继续循环"
      : null,
  });

  trace.finish({ finalAnswer });
  const path = trace.write("openai");

  logSection("FINAL ANSWER");
  console.log(finalAnswer || "(empty)");
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
    console.error("轨迹（含错误）已写入：", trace.write("openai"));
  } catch {
    /* ignore */
  }
  console.error(e);
  process.exit(1);
});
